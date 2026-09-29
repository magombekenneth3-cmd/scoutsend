import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { seedWarmupQueue } from "./campaign.queue";
import { Prisma } from "@prisma/client";
import { effectiveCurrentSent } from "../../lib/daily-quota";

const SEED_SHARE_OF_VOLUME = 0.3;
const MIN_SEED_INTERACTIONS_PER_DAY = 3;
const MAX_SEED_REUSE_COOLDOWN_HOURS = 18;

export async function runSeedWarmupScheduler(): Promise<void> {
    const mailboxes = await prisma.senderMailbox.findMany({
        where: { warmupEnabled: true, health: { not: "BLOCKED" } },
        select: { id: true, emailAddress: true, dailyLimit: true, providerType: true },
    });

    logger.info({ count: mailboxes.length }, "[seed-warmup.agent] Scheduling seed traffic");
    const reservedThisPass = new Map<string, number>();

    for (const mailbox of mailboxes) {
        try {
            const currentSent = await effectiveCurrentSent(prisma, "SenderMailbox", mailbox.id);
            const remainingBudget = Math.max(0, mailbox.dailyLimit - currentSent);

            const desiredSeedSlots = Math.max(
                MIN_SEED_INTERACTIONS_PER_DAY,
                Math.round(mailbox.dailyLimit * SEED_SHARE_OF_VOLUME),
            );
            const seedSlots = Math.min(desiredSeedSlots, remainingBudget);

            if (seedSlots === 0) {
                logger.info(
                    { mailboxId: mailbox.id, dailyLimit: mailbox.dailyLimit, currentSent },
                    "[seed-warmup.agent] No remaining budget — skipping seed scheduling for this mailbox",
                );
                continue;
            }

            const seeds = await pickHealthySeedsAndReserve(mailbox.id, mailbox.providerType, seedSlots, reservedThisPass);

            if (seeds.length < MIN_SEED_INTERACTIONS_PER_DAY) {
                logger.warn(
                    { mailboxId: mailbox.id, available: seeds.length, wanted: seedSlots },
                    "[seed-warmup.agent] Seed pool undersized for this mailbox today",
                );
            }

            if (seeds.length === 0) continue;

            for (const seed of seeds) {
                const delayMs = Math.floor(Math.random() * 6 * 60 * 60 * 1000);
                await seedWarmupQueue.add(
                    "send-warmup-email",
                    { senderMailboxId: mailbox.id, seedMailboxId: seed.id },
                    { delay: delayMs },
                );
            }
        } catch (err) {
            logger.error({ err, mailboxId: mailbox.id }, "[seed-warmup.agent] Failed to schedule mailbox");
        }
    }

    if (Math.random() < 0.15) {
        await scheduleSeedToSeedChatter();
    }
}


async function pickHealthySeedsAndReserve(
    senderMailboxId: string,
    providerType: string,
    count: number,
    reservedThisPass: Map<string, number>,
) {
    const cutoff = new Date(Date.now() - MAX_SEED_REUSE_COOLDOWN_HOURS * 60 * 60 * 1000);

    const candidates = await prisma.seedMailbox.findMany({
        where: { stage: "ACTIVE", healthScore: { gte: 0.5 } },
        orderBy: { healthScore: "desc" },
        take: count * 4,
    });

    const eligible = candidates.filter((s) => {
        const lastPaired = (s.lastPairedAt as Record<string, string> | null)?.[senderMailboxId];
        const reservedCount = reservedThisPass.get(s.id) ?? 0;
        const effectiveUsed = s.usedToday + reservedCount;
        return (!lastPaired || new Date(lastPaired) < cutoff) && effectiveUsed < s.dailyCapacity;
    });

    const sameProviderSeeds = eligible.filter((s) => s.provider === providerType);
    const otherProviderSeeds = eligible.filter((s) => s.provider !== providerType);

    const sameCountTarget = Math.ceil(count * 0.6);
    const selectedSame = shuffle(sameProviderSeeds).slice(0, sameCountTarget);
    const selectedOther = shuffle(otherProviderSeeds).slice(0, count - selectedSame.length);

    const combined = [...selectedSame, ...selectedOther];

    if (combined.length < count) {
        const remainingCandidates = eligible.filter((s) => !combined.includes(s));
        combined.push(...shuffle(remainingCandidates).slice(0, count - combined.length));
    }

    const shortlist = combined.slice(0, count);
    const reserved: typeof shortlist = [];
    for (const seed of shortlist) {
        const affected = await prisma.$executeRaw(Prisma.sql`
            UPDATE "SeedMailbox"
            SET    "usedToday" = "usedToday" + 1
            WHERE  id = ${seed.id}
              AND  "usedToday" < "dailyCapacity"
        `);
        if (affected > 0) {
            reserved.push(seed);
            reservedThisPass.set(seed.id, (reservedThisPass.get(seed.id) ?? 0) + 1);
        }
    }

    return reserved;
}

async function scheduleSeedToSeedChatter() {
    const candidates = await prisma.seedMailbox.findMany({
        where: { stage: { in: ["ACTIVE", "BOOTSTRAPPING"] } },
        orderBy: { updatedAt: "asc" },
        take: 10,
    });

    const eligible = candidates.filter((s) => s.usedToday < s.dailyCapacity);

    const reserved: typeof eligible = [];
    for (const seed of eligible) {
        if (reserved.length === 2) break;
        const affected = await prisma.$executeRaw(Prisma.sql`
            UPDATE "SeedMailbox"
            SET    "usedToday" = "usedToday" + 1
            WHERE  id = ${seed.id}
              AND  "usedToday" < "dailyCapacity"
        `);
        if (affected > 0) reserved.push(seed);
    }

    if (reserved.length < 2) return;

    await seedWarmupQueue.add("seed-to-seed-chatter", {
        fromSeedId: reserved[0].id,
        toSeedId: reserved[1].id,
    });
}

function shuffle<T>(arr: T[]): T[] {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}