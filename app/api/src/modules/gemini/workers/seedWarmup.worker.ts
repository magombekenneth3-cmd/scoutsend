import { Worker, Job } from "bullmq";
import { z } from "zod";
import { redis, redisConnectionOptions } from "../../../lib/ioredis";
import { QUEUE_POLICY } from "../queue-policy";
import { wireWorkerEvents, withHeartbeat, registerForShutdown } from "../worker-runtime";
import { logger } from "../../../lib/logger";
import { prisma } from "../../../lib/prisma";
import { Prisma } from "@prisma/client";
import { createMailProvider, MailboxCredentials } from "../../../lib/mail";
import { decryptMailboxCredentials, encryptJson } from "../../../lib/mail/crypto";
import { generateReplyText } from "../generate.agent";
import { seedWarmupQueue } from "../campaign.queue";
import { callGemini, MODELS, parseSafeJson } from "../gemini.client";
import { parseJobData } from "../../../lib/job-validation";
import { reserveDailyCapacity } from "../../../lib/daily-quota";
import { isWarmupFenced } from "../../../lib/warmup/warmup-fence";

const seedToSeedChatterSchema = z.object({
    fromSeedId: z.string().min(1),
    toSeedId: z.string().min(1),
});
const seedEngagementSchema = z.object({
    fromSeedId: z.string().min(1),
    toSeedId: z.string().min(1),
    messageId: z.string().min(1),
    threadId: z.string().nullable(),
});
const continueThreadSchema = z.object({
    senderMailboxId: z.string().min(1),
    seedMailboxId: z.string().min(1),
    interactionId: z.string().min(1),
    inReplyTo: z.string().min(1),
    threadId: z.string().nullable(),
    turnCount: z.number(),
});




function createMailboxProvider(mailbox: { id: string; credentials: unknown }) {
    const rawCreds = decryptMailboxCredentials<MailboxCredentials>(mailbox.credentials, `mailbox:${mailbox.id}`);
    return createMailProvider(rawCreds, {
        outlook: {
            mailboxId: mailbox.id,
            redis,
            onTokenRotation: async (newRefreshToken: string) => {
                if (rawCreds.type === "OUTLOOK" && newRefreshToken !== rawCreds.refreshToken) {
                    const rotated = { ...rawCreds, refreshToken: newRefreshToken };
                    await prisma.senderMailbox.update({
                        where: { id: mailbox.id },
                        data: { credentials: encryptJson(rotated) },
                        select: { id: true },
                    });
                }
            },
        },
    });
}

function createSeedProvider(seed: { id: string; credentials: unknown }) {
    const rawCreds = decryptMailboxCredentials<MailboxCredentials>(seed.credentials, `seed:${seed.id}`);
    return createMailProvider(rawCreds, {
        outlook: {
            mailboxId: seed.id,
            redis,
            onTokenRotation: async (newRefreshToken: string) => {
                if (rawCreds.type === "OUTLOOK" && newRefreshToken !== rawCreds.refreshToken) {
                    const rotated = { ...rawCreds, refreshToken: newRefreshToken };
                    await prisma.seedMailbox.update({
                        where: { id: seed.id },
                        data: { credentials: encryptJson(rotated) },
                    });
                }
            },
        },
    });
}

const policy = QUEUE_POLICY.seedWarmup;

async function handleSend(job: Job) {
    const { senderMailboxId, seedMailboxId } = job.data;

    const [customerMailbox, seed] = await Promise.all([
        prisma.senderMailbox.findUniqueOrThrow({
            where: { id: senderMailboxId },
            select: {
                id: true,
                credentials: true,
                warmupEnabled: true,
                health: true,
                dailyLimit: true,
                emailAddress: true,
            },
        }),
        prisma.seedMailbox.findUniqueOrThrow({ where: { id: seedMailboxId } }),
    ]);

    if (!customerMailbox.warmupEnabled || customerMailbox.health === "BLOCKED") {
        logger.info(
            { senderMailboxId, seedMailboxId, warmupEnabled: customerMailbox.warmupEnabled, health: customerMailbox.health },
            "[seedWarmup.worker] Mailbox paused since this send was scheduled — skipping",
        );
        return;
    }

    // Phase 3.3: Fence check — LAST SAFE POINT before provider interaction
    const domainName = customerMailbox.emailAddress.split("@")[1];
    const domainRecord = domainName
        ? await prisma.senderDomain.findFirst({
              where: { domain: domainName },
              select: { id: true },
          })
        : null;

    if (await isWarmupFenced(senderMailboxId, domainRecord?.id ?? null)) {
        logger.info(
            { senderMailboxId, seedMailboxId },
            "[seedWarmup.worker] Warmup fenced — skipping send",
        );
        return;
    }

    const reserved = await reserveDailyCapacity(prisma, "SenderMailbox", senderMailboxId, 1, customerMailbox.dailyLimit);
    if (!reserved) {
        logger.info({ senderMailboxId, seedMailboxId }, "[seedWarmup.worker] No remaining daily capacity — skipping");
        return;
    }

    const provider = createMailboxProvider(customerMailbox);
    const warmupContent = await generateWarmupEmailContent();

    const result = await provider.sendEmail({
        from: customerMailbox.emailAddress,
        to: seed.emailAddress,
        subject: warmupContent.subject,
        html: `<p>${warmupContent.body.replace(/\n/g, "<br>")}</p>`,
        text: warmupContent.body,
    });

    if (!result.success) {
        await prisma.senderMailbox.update({
            where: { id: senderMailboxId },
            data: { currentSent: { decrement: 1 } },
            select: { id: true },
        });
        logger.error({ senderMailboxId, seedMailboxId, error: result.error }, "[seedWarmup.worker] Send failed");
        throw new Error(result.error);
    }

    const interaction = await prisma.warmupInteraction.create({
        data: {
            senderMailboxId,
            seedMailboxId,
            direction: "OUTBOUND_TO_SEED",
            messageId: result.externalId,
        },
    });

    await prisma.$executeRaw(Prisma.sql`
        UPDATE "SeedMailbox"
        SET    "lastPairedAt" = COALESCE("lastPairedAt", '{}'::jsonb)
                                || jsonb_build_object(${senderMailboxId}::text, ${new Date().toISOString()}::text)
        WHERE  id = ${seedMailboxId}
    `);

    const engagementDelayMs = sampleLogNormalDelay({ medianMinutes: 40, tailMinutes: 480 });
    await seedWarmupQueue.add(
        "simulate-engagement",
        { interactionId: interaction.id },
        { delay: engagementDelayMs },
    );
}

/**
 * handleEngagement — OBSERVE ONLY (Rev 7).
 *
 * INV-7: handleEngagement is NEVER fenced — observation continues during PAUSE.
 *
 * Records delivery placement (inbox vs spam) without any manipulation:
 *   ✗ NO moveToInbox
 *   ✗ NO moveToPrimary
 *   ✗ NO markAsRead
 *   ✗ NO markAsImportant
 *   ✗ NO sendReplyInThread
 */
async function handleEngagement(job: Job) {
    const { interactionId } = job.data;

    const interaction = await prisma.warmupInteraction.findUniqueOrThrow({
        where: { id: interactionId },
        include: { seedMailbox: true },
    });

    if (interaction.openedAt !== null) {
        logger.info({ interactionId }, "[seedWarmup.worker] handleEngagement already completed — skipping (idempotent)");
        return;
    }

    const provider = createSeedProvider(interaction.seedMailbox);
    if (!provider.findMessageFolder) {
        logger.warn({ interactionId }, "[seedWarmup.worker] Provider lacks findMessageFolder — skipping");
        return;
    }

    // ── Observe delivery placement ──────────────────────────────────────
    const folder = await provider.findMessageFolder(interaction.messageId);
    const landedInSpam = folder === "SPAM";

    // ✗ NO manipulation — observe only
    // ✗ NO moveToInbox, moveToPrimary, markAsRead, markAsImportant

    await prisma.deliverabilityEvent.create({
        data: {
            type: landedInSpam ? "SEED_WARMUP_SPAM_LANDING" : "SEED_WARMUP_ENGAGED",
            severity: landedInSpam ? "WARNING" : "INFO",
            senderMailboxId: interaction.senderMailboxId,
            metadata: {
                seedMailboxId: interaction.seedMailboxId,
                seedEmail: interaction.seedMailbox.emailAddress,
                interactionId,
                deliveryFolder: folder ?? "UNKNOWN",
            },
        },
    });

    await adjustSeedHealth(interaction.seedMailboxId, landedInSpam ? -0.05 : 0.02);

    await prisma.warmupInteraction.update({
        where: { id: interactionId },
        data: {
            openedAt: new Date(),
            landedInSpam,
        },
    });

    // ✗ NO reply generation — engagement simulation removed

    logger.info(
        { interactionId, landedInSpam, folder },
        "[seedWarmup.worker] Delivery placement observed (no manipulation)",
    );
}

async function adjustSeedHealth(seedMailboxId: string, delta: number) {
    const updated = await prisma.$queryRaw<Array<{ healthScore: number; stage: string }>>(Prisma.sql`
        UPDATE "SeedMailbox"
        SET    "healthScore" = GREATEST(0.0, LEAST(1.0, "healthScore" + ${delta}::double precision)),
               "stage"       = CASE 
                                   WHEN (GREATEST(0.0, LEAST(1.0, "healthScore" + ${delta}::double precision))) < 0.25 
                                   THEN 'COOLING_DOWN'::"SeedStage"
                                   ELSE "stage"
                               END
        WHERE  id = ${seedMailboxId}
        RETURNING "healthScore", "stage"
    `);

    const next = updated[0]?.healthScore;
    if (next === undefined) return;

    if (next < 0.5) {
        const relatedInteractions = await prisma.warmupInteraction.findMany({
            where: { seedMailboxId },
            select: { senderMailboxId: true },
            distinct: ["senderMailboxId"],
        });
        for (const { senderMailboxId } of relatedInteractions) {
            const allSeeds = await prisma.seedMailbox.findMany({
                where: {
                    interactions: { some: { senderMailboxId } },
                },
                select: { healthScore: true },
            });
            if (allSeeds.length === 0) continue;
            const avgHealth = allSeeds.reduce((sum, s) => sum + s.healthScore, 0) / allSeeds.length;
            if (avgHealth < 0.5) {
                await prisma.senderMailbox.update({
                    where: { id: senderMailboxId },
                    data: { warmupEnabled: false },
                    select: { id: true },
                });
                logger.warn(
                    { senderMailboxId, avgHealth },
                    "[seedWarmup] Auto-paused warmup — average seed health below 0.5",
                );
            }
        }
    }
}

function sampleLogNormalDelay({ medianMinutes, tailMinutes }: { medianMinutes: number; tailMinutes: number }) {
    const mu = Math.log(medianMinutes);
    const sigma = Math.log(tailMinutes / medianMinutes) / 2;
    let u = 0, v = 0;
    while (u === 0) u = Math.random();
    while (v === 0) v = Math.random();
    const gaussian = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    const sample = Math.exp(mu + sigma * gaussian);
    return Math.round(Math.min(sample, tailMinutes * 2) * 60 * 1000);
}

async function generateWarmupEmailContent(): Promise<{ subject: string; body: string }> {
    try {
        const { text } = await callGemini({
            agentName: "seed-warmup.outbound-writer",
            model: MODELS.GENERATE,
            systemPrompt: `You are generating a short, natural B2B outreach email for an inbox warmup network.
Rules:
- Subject line: 3 to 6 words, casual and natural (e.g. "Quick question about product roadmap", "Follow up on your recent update").
- Body: 2 to 4 sentences, realistic and professional. No placeholder text, no brackets.
- Respond with a JSON object: {"subject": "...", "body": "..."}`,
            userPrompt: "Generate a unique, natural warmup email.",
            temperature: 0.9,
            responseMimeType: "application/json",
        });
        const parsed = parseSafeJson<{ subject: string; body: string }>(text);
        if (parsed.subject && parsed.body) return parsed;
    } catch (err) {
        logger.warn({ err }, "[seedWarmup.worker] Failed to generate dynamic warmup email — using fallback");
    }

    const fallbackSubjects = [
        "Quick question regarding your workflow",
        "Following up on our recent conversation",
        "Ideas for scaling team productivity",
        "Checking in on your current setup",
    ];
    const fallbackBodies = [
        "Hi there,\n\nI was reviewing our recent notes and wanted to see if you had 5 minutes to connect this week?\n\nBest,",
        "Hello,\n\nHope your week is going well. Did you get a chance to take a look at the details I sent over?\n\nRegards,",
        "Hi,\n\nReaching out to see if your team is open to exploring new approaches here.\n\nThanks,",
    ];
    const subject = fallbackSubjects[Math.floor(Math.random() * fallbackSubjects.length)];
    const body = fallbackBodies[Math.floor(Math.random() * fallbackBodies.length)];
    return { subject, body };
}

async function handleSeedToSeedChatter(job: Job) {
    const { fromSeedId, toSeedId } = parseJobData(seedToSeedChatterSchema, job);

    const [fromSeed, toSeed] = await Promise.all([
        prisma.seedMailbox.findUniqueOrThrow({ where: { id: fromSeedId } }),
        prisma.seedMailbox.findUniqueOrThrow({ where: { id: toSeedId } }),
    ]);

    const provider = createSeedProvider(fromSeed);
    const warmupContent = await generateWarmupEmailContent();

    const result = await provider.sendEmail({
        from: fromSeed.emailAddress,
        to: toSeed.emailAddress,
        subject: warmupContent.subject,
        html: `<p>${warmupContent.body.replace(/\n/g, "<br>")}</p>`,
        text: warmupContent.body,
    });

    if (!result.success) {
        logger.error({ fromSeedId, toSeedId, error: result.error }, "[seedWarmup.worker] Seed-to-seed send failed");
        throw new Error(result.error);
    }

    const engagementDelayMs = sampleLogNormalDelay({ medianMinutes: 45, tailMinutes: 360 });
    await seedWarmupQueue.add(
        "simulate-seed-engagement",
        { fromSeedId, toSeedId, messageId: result.externalId, threadId: null },
        { delay: engagementDelayMs },
    );
}

async function handleSeedEngagement(job: Job) {
    const { fromSeedId, toSeedId, messageId, threadId } = parseJobData(seedEngagementSchema, job);

    const claimKey = `seed-engagement:claimed:${messageId}`;
    const claimed = await redis.set(claimKey, "1", "EX", 86400, "NX");
    if (!claimed) {
        logger.info({ fromSeedId, toSeedId, messageId }, "[seedWarmup.worker] handleSeedEngagement already claimed — skipping (idempotent)");
        return;
    }

    try {
        const toSeed = await prisma.seedMailbox.findUniqueOrThrow({ where: { id: toSeedId } });
        const provider = createSeedProvider(toSeed);

        if (!provider.findMessageFolder || !provider.markAsRead) {
            logger.warn({ fromSeedId, toSeedId }, "[seedWarmup.worker] Seed provider lacks engagement methods — skipping");
            return;
        }

        const folder = await provider.findMessageFolder(messageId);
        const landedInSpam = folder === "SPAM";

        if (landedInSpam && provider.moveToInbox) {
            await provider.moveToInbox(messageId);
        }
        await provider.markAsRead(messageId);

        const healthDelta = landedInSpam ? -0.05 : 0.02;
        await Promise.all([
            adjustSeedHealth(fromSeedId, healthDelta * 0.5),
            adjustSeedHealth(toSeedId, healthDelta),
        ]);

        const REPLY_PROBABILITY = 0.6;
        if (Math.random() < REPLY_PROBABILITY && provider.sendReplyInThread) {
            const replyText = await generateReplyText({ context: "seed-to-seed-warmup", threadId });
            await provider.sendReplyInThread({
                to: "",
                subject: "",
                body: replyText,
                inReplyTo: messageId,
            });
        }

        logger.info(
            { fromSeedId, toSeedId, landedInSpam },
            "[seedWarmup.worker] Seed-to-seed engagement simulated",
        );
    } catch (err) {
        await redis.del(claimKey);
        throw err;
    }
}

async function handleContinueThread(job: Job) {
    const { senderMailboxId, seedMailboxId, interactionId, inReplyTo, threadId, turnCount } = parseJobData(continueThreadSchema, job);

    const claimKey = `continue-thread:claimed:${inReplyTo}`;
    const claimed = await redis.set(claimKey, "1", "EX", 86400, "NX");
    if (!claimed) {
        logger.info({ senderMailboxId, inReplyTo }, "[seedWarmup.worker] handleContinueThread already claimed — skipping");
        return;
    }

    try {
        const customerMailbox = await prisma.senderMailbox.findUniqueOrThrow({
            where: { id: senderMailboxId },
            select: { id: true, credentials: true, emailAddress: true },
        });

        // Phase 3.3: Fence check — LAST SAFE POINT before provider interaction
        const domainName = customerMailbox.emailAddress.split("@")[1];
        const domainRecord = domainName
            ? await prisma.senderDomain.findFirst({
                  where: { domain: domainName },
                  select: { id: true },
              })
            : null;

        if (await isWarmupFenced(senderMailboxId, domainRecord?.id ?? null)) {
            logger.info(
                { senderMailboxId, seedMailboxId, inReplyTo },
                "[seedWarmup.worker] Warmup fenced — skipping thread continuation",
            );
            return;
        }

        const provider = createMailboxProvider(customerMailbox);
        if (!provider.sendReplyInThread) return;

        const replyText = await generateReplyText({ context: "warmup-thread-continuation", threadId });
        const result = await provider.sendReplyInThread({
            to: "",
            subject: "",
            body: replyText,
            inReplyTo,
        });

        if (!result.success) {
            logger.error({ senderMailboxId, seedMailboxId, error: result.error }, "[seedWarmup.worker] Thread continuation send failed");
            throw new Error(result.error);
        }

        const MAX_TURNS = 4;
        if (turnCount < MAX_TURNS) {
            const engagementDelayMs = sampleLogNormalDelay({ medianMinutes: 60, tailMinutes: 480 });
            await seedWarmupQueue.add(
                "simulate-engagement",
                { interactionId, turnCount },
                { delay: engagementDelayMs },
            );
        }

        logger.info(
            { senderMailboxId, seedMailboxId, turnCount },
            "[seedWarmup.worker] Thread continuation sent",
        );
    } catch (err) {
        await redis.del(claimKey);
        throw err;
    }
}

export const seedWarmupWorker = new Worker(
    policy.queueName,
    async (job: Job) =>
        withHeartbeat(
            job,
            async () => {
                if (job.name === "send-warmup-email") return handleSend(job);
                if (job.name === "simulate-engagement") return handleEngagement(job);
                if (job.name === "seed-to-seed-chatter") return handleSeedToSeedChatter(job);
                if (job.name === "simulate-seed-engagement") return handleSeedEngagement(job);
                if (job.name === "continue-thread") return handleContinueThread(job);
            },
            policy.lockDuration,
        ),
    { connection: redisConnectionOptions, concurrency: policy.concurrency },
);

wireWorkerEvents(seedWarmupWorker, policy.queueName);
registerForShutdown(seedWarmupWorker);