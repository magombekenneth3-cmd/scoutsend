import { prisma } from "../../lib/prisma";
import { createMailProvider, MailboxCredentials } from "../../lib/mail";
import { decryptMailboxCredentials } from "../../lib/mail/crypto";
import { logger } from "../../lib/logger";
import { DeliveryState, Prisma } from "@prisma/client";
import pLimit from "p-limit";
import { redis } from "../../lib/ioredis";

interface DeliveryPollLimiters {
    mailbox: ReturnType<typeof pLimit>;
}

export function createDeliveryPollLimiters(): DeliveryPollLimiters {
    return {
        mailbox: pLimit(10),
    };
}



const TERMINAL_STATES: DeliveryState[] = ["BOUNCED", "SPAM", "REPLIED"];

const BOUNCE_SUBJECTS = [
    /delivery.{0,20}fail/i,
    /undeliverable/i,
    /mail.{0,10}return/i,
    /returned.{0,10}mail/i,
    /delivery.{0,10}status.{0,10}notif/i,
    /failure.{0,10}notice/i,
    /non.?delivery/i,
];

const BOUNCE_FROM = [
    /mailer-daemon/i,
    /postmaster/i,
    /no-?reply@.*bounce/i,
    /bounce[+@]/i,
];

const SPAM_COMPLAINT_SUBJECTS = [
    /abuse.{0,20}report/i,
    /spam.{0,20}complaint/i,
    /feedback.{0,20}loop/i,
    /arf.{0,20}report/i,
];

type BounceKind = "HARD" | "SOFT";
type InboxClassification = { type: "BOUNCE"; kind: BounceKind } | { type: "SPAM" } | { type: "REPLY" };

const HARD_BOUNCE_SUBJECTS = [
    /user.{0,10}unknown/i,
    /no.{0,10}such.{0,10}user/i,
    /does.{0,10}not.{0,10}exist/i,
    /invalid.{0,10}(?:address|recipient|mailbox)/i,
    /account.{0,20}(?:not found|suspended|terminated|disabled)/i,
    /550/,
    /551/,
    /553/,
];

const SOFT_BOUNCE_SUBJECTS = [
    /mailbox.{0,20}(?:full|over quota|storage)/i,
    /quota.{0,20}exceeded/i,
    /temporarily.{0,20}(?:unavailable|deferred)/i,
    /try.{0,20}again/i,
    /451/,
    /452/,
];

function classifyInboxMessage(fromEmail: string, subject: string): InboxClassification {
    for (const pattern of BOUNCE_FROM) {
        if (pattern.test(fromEmail)) {
            const kind: BounceKind = HARD_BOUNCE_SUBJECTS.some(p => p.test(subject)) ? "HARD"
                : SOFT_BOUNCE_SUBJECTS.some(p => p.test(subject)) ? "SOFT"
                : "HARD";
            return { type: "BOUNCE", kind };
        }
    }
    for (const pattern of BOUNCE_SUBJECTS) {
        if (pattern.test(subject)) {
            const kind: BounceKind = SOFT_BOUNCE_SUBJECTS.some(p => p.test(subject)) ? "SOFT" : "HARD";
            return { type: "BOUNCE", kind };
        }
    }
    for (const pattern of SPAM_COMPLAINT_SUBJECTS) {
        if (pattern.test(subject)) return { type: "SPAM" };
    }
    return { type: "REPLY" };
}

async function recordDeliveryEvent(
    outreachMessageId: string,
    newState: DeliveryState,
    recipientEmail: string | null,
    receivedAt: Date,
    mailboxId: string,
    userId: string,
    bounceKind: BounceKind | null = null,
): Promise<void> {
    const updated = await prisma.outreachMessage.updateMany({
        where: {
            id: outreachMessageId,
            deliveryState: { notIn: TERMINAL_STATES },
        },
        data: {
            deliveryState: newState,
            ...(newState === "OPENED" ? { openedAt: receivedAt } : {}),
        },
    });

    if (updated.count === 0) return;

    if (newState === "BOUNCED" || newState === "SPAM") {
        const shouldSuppress = newState === "SPAM" || bounceKind === "HARD";

        if (shouldSuppress && recipientEmail) {
            const campaignOrg = await prisma.outreachMessage.findUnique({
                where: { id: outreachMessageId },
                select: { lead: { select: { campaign: { select: { orgId: true } } } } },
            });
            const orgId = campaignOrg?.lead?.campaign?.orgId;
            if (orgId) {
                await prisma.suppression.upsert({
                    where: { email_orgId: { email: recipientEmail, orgId } },
                    create: {
                        email: recipientEmail,
                        orgId,
                        reason: newState === "BOUNCED"
                            ? "Hard bounce — permanent delivery failure"
                            : "Spam complaint detected via inbox poll",
                        source: "delivery-poller",
                        userId,
                    },
                    update: {},
                });
            }
        }

        await incrementMailboxDeliverabilityRate(mailboxId, newState);
        await incrementDomainDeliverabilityRate(outreachMessageId, newState);
    }
}

async function incrementMailboxDeliverabilityRate(
    mailboxId: string,
    event: "BOUNCED" | "SPAM"
): Promise<void> {
    await prisma.$transaction(async (tx) => {
        const mailbox = await tx.senderMailbox.findUnique({
            where: { id: mailboxId },
            select: { totalSent: true },
        });

        if (!mailbox || mailbox.totalSent === 0) return;

        const total = mailbox.totalSent;
        const rateField = event === "BOUNCED" ? "bounceRate" : "complaintRate";
        const ALLOWED_RATE_FIELDS = new Set(["bounceRate", "complaintRate"]);
        if (!ALLOWED_RATE_FIELDS.has(rateField)) throw new Error(`[deliverypoll] Invalid rateField: ${rateField}`);

        await tx.$executeRaw`
            UPDATE "SenderMailbox"
            SET ${Prisma.raw(`"${rateField}"`)} = (FLOOR(${Prisma.raw(`"${rateField}"`)} * ${total}) + 1.0) / ${total}
            WHERE id = ${mailboxId}
        `;
    });
}

async function incrementDomainDeliverabilityRate(
    outreachMessageId: string,
    event: "BOUNCED" | "SPAM"
): Promise<void> {
    const message = await prisma.outreachMessage.findUnique({
        where: { id: outreachMessageId },
        select: {
            lead: {
                select: {
                    campaign: {
                        select: {
                            senderDomain: {
                                select: {
                                    id: true,
                                    totalSent: true,
                                },
                            },
                        },
                    },
                },
            },
        },
    });

    const domain = message?.lead?.campaign?.senderDomain;
    if (!domain || domain.totalSent === 0) return;

    await prisma.$transaction(async (tx) => {
        const fresh = await tx.senderDomain.findUnique({
            where: { id: domain.id },
            select: { totalSent: true },
        });

        if (!fresh || fresh.totalSent === 0) return;

        const total = fresh.totalSent;
        const rateField = event === "BOUNCED" ? "bounceRate" : "complaintRate";
        const ALLOWED_RATE_FIELDS = new Set(["bounceRate", "complaintRate"]);
        if (!ALLOWED_RATE_FIELDS.has(rateField)) throw new Error(`[deliverypoll] Invalid rateField: ${rateField}`);

        await tx.$executeRaw`
            UPDATE "SenderDomain"
            SET ${Prisma.raw(`"${rateField}"`)} = (FLOOR(${Prisma.raw(`"${rateField}"`)} * ${total}) + 1.0) / ${total}
            WHERE id = ${domain.id}
        `;
    });
}

/** Redis key prefix for consecutive delivery-poll failure counts per mailbox. */
const DELIVERY_POLL_FAIL_KEY = (mailboxId: string) => `delivery-poll:fail:${mailboxId}`;

/** Base backoff in ms. Consecutive failures are shifted: 2^n minutes, capped at 64 min. */
const DELIVERY_POLL_BACKOFF_BASE_MS = 60_000;
const DELIVERY_POLL_BACKOFF_MAX_FAILURES = 6; // 2^6 = 64 minutes maximum

/**
 * Returns true if this mailbox should be skipped due to recent consecutive
 * delivery-poll failures. Uses Redis to track fail-count and last-fail timestamp.
 */
async function shouldSkipDeliveryDueToBackoff(mailboxId: string): Promise<boolean> {
    const raw = await redis.get(DELIVERY_POLL_FAIL_KEY(mailboxId));
    if (!raw) return false;
    const { count, lastFailAt } = JSON.parse(raw) as { count: number; lastFailAt: number };
    const backoffMs = Math.min(
        Math.pow(2, count) * DELIVERY_POLL_BACKOFF_BASE_MS,
        Math.pow(2, DELIVERY_POLL_BACKOFF_MAX_FAILURES) * DELIVERY_POLL_BACKOFF_BASE_MS,
    );
    const elapsed = Date.now() - lastFailAt;
    if (elapsed < backoffMs) {
        logger.info(
            { mailboxId, failCount: count, backoffMs, remainingMs: backoffMs - elapsed },
            "[deliveryPoller] Skipping mailbox — within backoff window",
        );
        return true;
    }
    return false;
}

/** Record a delivery-poll failure for this mailbox (increments Redis counter). */
async function recordDeliveryPollFailure(mailboxId: string): Promise<void> {
    const raw = await redis.get(DELIVERY_POLL_FAIL_KEY(mailboxId));
    const prev = raw ? (JSON.parse(raw) as { count: number }) : { count: 0 };
    const next = { count: prev.count + 1, lastFailAt: Date.now() };
    // TTL of 24 hours; after a day without failures the backoff resets automatically.
    await redis.set(DELIVERY_POLL_FAIL_KEY(mailboxId), JSON.stringify(next), "EX", 86_400);
}

/** Clear the delivery-poll backoff counter after a successful poll. */
async function clearDeliveryPollBackoff(mailboxId: string): Promise<void> {
    await redis.del(DELIVERY_POLL_FAIL_KEY(mailboxId));
}

/**
 * @internal — TEST USE ONLY. Not part of the public API.
 * Exposes the private backoff helpers so unit tests can exercise them directly
 * with real Redis in CJS mode (where mock.module() is unavailable).
 */
export const _deliveryBackoffTestHelpers =
    process.env.NODE_ENV === "test"
        ? { shouldSkipDeliveryDueToBackoff, recordDeliveryPollFailure, clearDeliveryPollBackoff, DELIVERY_POLL_FAIL_KEY }
        : undefined;

export async function pollMailboxDeliveryEvents(mailboxId: string, limiters: DeliveryPollLimiters = createDeliveryPollLimiters()): Promise<void> {
    void limiters;

    const mailbox = await prisma.senderMailbox.findUnique({
        where: { id: mailboxId },
        select: {
            id: true,
            credentials: true,
            lastReplyCheckedAt: true,
            emailAddress: true,
            providerType: true,
            createdById: true,
        },
    });

    if (!mailbox) {
        logger.warn({ mailboxId }, "[deliveryPoller] Mailbox not found");
        return;
    }

    // Skip if this mailbox is in an exponential backoff window after consecutive failures.
    if (await shouldSkipDeliveryDueToBackoff(mailboxId)) return;

    const since = mailbox.lastReplyCheckedAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);

    const provider = createMailProvider(decryptMailboxCredentials<MailboxCredentials>(mailbox.credentials, `mailbox:${mailboxId}`));

    let inboxMessages: Awaited<ReturnType<typeof provider.fetchReplies>>;
    try {
        inboxMessages = await provider.fetchReplies(since);
    } catch (err: unknown) {
        const safeErr = err instanceof Error
            ? { message: err.message, name: err.name, code: (err as any).code }
            : String(err);
        logger.error({ err: safeErr, mailboxId }, "[deliveryPoller] fetchReplies error");
        await recordDeliveryPollFailure(mailboxId);
        return;
    }

    let bounces = 0;
    let complaints = 0;

    const bounceSpamMessages = inboxMessages.filter(
        (msg) => classifyInboxMessage(msg.fromEmail, msg.subject).type !== "REPLY"
    );

    const replyToIds = bounceSpamMessages
        .map((msg) => msg.inReplyToId)
        .filter((id): id is string => Boolean(id));

    const outreachByExternalId = replyToIds.length > 0
        ? new Map(
            (await prisma.outreachMessage.findMany({
                where: { externalMessageId: { in: replyToIds } },
                select: { id: true, externalMessageId: true, lead: { select: { email: true } } },
            })).map((o) => [o.externalMessageId!, o])
          )
        : new Map<string, { id: string; lead: { email: string | null } }>();

    for (const msg of bounceSpamMessages) {
        const classification = classifyInboxMessage(msg.fromEmail, msg.subject);
        const newState: DeliveryState = classification.type === "BOUNCE" ? "BOUNCED" : "SPAM";
        const bounceKind = classification.type === "BOUNCE" ? classification.kind : null;

        if (msg.inReplyToId) {
            const outreach = outreachByExternalId.get(msg.inReplyToId);
            if (outreach) {
                await recordDeliveryEvent(
                    outreach.id,
                    newState,
                    outreach.lead.email,
                    msg.receivedAt,
                    mailboxId,
                    mailbox.createdById,
                    bounceKind
                );
                if (newState === "BOUNCED") bounces++;
                else complaints++;
                continue;
            }
        }

        const lead = await prisma.lead.findFirst({
            where: { email: msg.fromEmail, deletedAt: null },
            select: {
                id: true,
                email: true,
                outreachMessages: {
                    where: { deliveryState: { in: ["SENT", "DELIVERED", "OPENED"] } },
                    orderBy: { sentAt: "desc" },
                    take: 1,
                    select: { id: true },
                },
            },
        });

        if (lead?.outreachMessages[0]) {
            await recordDeliveryEvent(
                lead.outreachMessages[0].id,
                newState,
                lead.email,
                msg.receivedAt,
                mailboxId,
                mailbox.createdById,
                bounceKind
            );
            if (newState === "BOUNCED") bounces++;
            else complaints++;
        }
    }

    await prisma.senderMailbox.update({
        where: { id: mailboxId },
        data: { lastReplyCheckedAt: new Date() },
    });

    // Clear the delivery-poll backoff after a successful fetch and DB write.
    await clearDeliveryPollBackoff(mailboxId);

    if (bounces > 0 || complaints > 0) {
        logger.info({ mailboxId, bounces, complaints }, "[deliveryPoller] delivery events recorded");
    }
}

export async function pollAllMailboxDeliveryEvents(): Promise<void> {
    const limiters = createDeliveryPollLimiters();
    const mailboxes = await prisma.senderMailbox.findMany({
        where: { health: { not: "BLOCKED" } },
        select: { id: true },
    });

    logger.info({ count: mailboxes.length }, "[deliveryPoller] polling mailboxes for delivery events");

    for (const mb of mailboxes) {
        try {
            await limiters.mailbox(() => pollMailboxDeliveryEvents(mb.id, limiters));
        } catch (err: unknown) {
            const safeErr = err instanceof Error
                ? { message: err.message, name: err.name, code: (err as any).code }
                : String(err);
            logger.error({ err: safeErr, mailboxId: mb.id }, "[deliveryPoller] uncaught error polling mailbox");
        }
    }
}