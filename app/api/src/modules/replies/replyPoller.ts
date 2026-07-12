import { prisma } from "../../lib/prisma";
import { createMailProvider, MailboxCredentials, InboundReply, OutlookCredentials } from "../../lib/mail";
import { logger } from "../../lib/logger";
import { decryptJson, encryptJson, isEncrypted } from "../../lib/mail/crypto";
import { redis } from "../../lib/ioredis";
import { createReply } from "./replies.services";
import pLimit from "p-limit";

interface ReplyPollLimiters {
    mailbox: ReturnType<typeof pLimit>;
}

export function createReplyPollLimiters(): ReplyPollLimiters {
    return {
        mailbox: pLimit(10),
    };
}

/** Redis key prefix for consecutive poll-failure counts per mailbox. */
const POLL_FAIL_KEY = (mailboxId: string) => `reply-poll:fail:${mailboxId}`;

/** Base backoff in ms. Consecutive failures are shifted: 2^n minutes, capped at 64 min. */
const POLL_BACKOFF_BASE_MS = 60_000;
const POLL_BACKOFF_MAX_FAILURES = 6; // 2^6 = 64 minutes maximum

/**
 * Returns true if this mailbox should be skipped due to recent consecutive failures.
 * Uses Redis to track fail-count and last-fail timestamp.
 */
async function shouldSkipDueToBackoff(mailboxId: string): Promise<boolean> {
    const raw = await redis.get(POLL_FAIL_KEY(mailboxId));
    if (!raw) return false;
    const { count, lastFailAt } = JSON.parse(raw) as { count: number; lastFailAt: number };
    const backoffMs = Math.min(Math.pow(2, count) * POLL_BACKOFF_BASE_MS, Math.pow(2, POLL_BACKOFF_MAX_FAILURES) * POLL_BACKOFF_BASE_MS);
    const elapsed = Date.now() - lastFailAt;
    if (elapsed < backoffMs) {
        logger.info(
            { mailboxId, failCount: count, backoffMs, remainingMs: backoffMs - elapsed },
            "[replyPoller] Skipping mailbox — within backoff window",
        );
        return true;
    }
    return false;
}

/** Record a poll failure for this mailbox (increments Redis counter). */
async function recordPollFailure(mailboxId: string): Promise<void> {
    const raw = await redis.get(POLL_FAIL_KEY(mailboxId));
    const prev = raw ? (JSON.parse(raw) as { count: number }) : { count: 0 };
    const next = { count: prev.count + 1, lastFailAt: Date.now() };
    // TTL of 24 hours; after a day without failures the backoff resets automatically
    await redis.set(POLL_FAIL_KEY(mailboxId), JSON.stringify(next), "EX", 86_400);
}

/** Clear the backoff counter after a successful poll. */
async function clearPollBackoff(mailboxId: string): Promise<void> {
    await redis.del(POLL_FAIL_KEY(mailboxId));
}

function decryptCredentials(raw: unknown): MailboxCredentials {
    if (isEncrypted(raw)) return decryptJson<MailboxCredentials>(raw as string);
    return raw as MailboxCredentials;
}

async function findOutreachMessage(reply: InboundReply, mailboxId: string) {
    if (reply.inReplyToId) {
        const msg = await prisma.outreachMessage.findFirst({
            where: {
                externalMessageId: reply.inReplyToId,
                lead: { campaign: { senderMailboxId: mailboxId } },
            },
            select: { id: true, leadId: true },
        });
        if (msg) return msg;
    }

    const lead = await prisma.lead.findFirst({
        where: {
            email: reply.fromEmail,
            deletedAt: null,
            campaign: { senderMailboxId: mailboxId },
        },
        select: {
            id: true,
            outreachMessages: {
                select: { id: true },
                where: { deliveryState: "SENT" },
                take: 1,
            },
        },
        orderBy: { createdAt: "desc" },
    });

    if (lead?.outreachMessages[0]) {
        return { id: lead.outreachMessages[0].id, leadId: lead.id };
    }

    return null;
}

export async function pollMailboxReplies(mailboxId: string, limiters: ReplyPollLimiters = createReplyPollLimiters()): Promise<void> {
    void limiters;

    const mailbox = await prisma.senderMailbox.findUnique({
        where: { id: mailboxId },
        select: {
            id: true,
            credentials: true,
            lastReplyCheckedAt: true,
            emailAddress: true,
            providerType: true,
        },
    });

    if (!mailbox) {
        logger.warn({ mailboxId }, "[replyPoller] Mailbox not found");
        return;
    }

    // Skip if this mailbox is in an exponential backoff window after consecutive failures.
    if (await shouldSkipDueToBackoff(mailboxId)) return;

    const since = mailbox.lastReplyCheckedAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
    const _rawCreds = decryptCredentials(mailbox.credentials);
    const provider = createMailProvider(_rawCreds, {
        outlook: {
            mailboxId,
            redis,
            onTokenRotation: async (newRefreshToken) => {
                const rotated = { ..._rawCreds, refreshToken: newRefreshToken } as OutlookCredentials;
                await prisma.senderMailbox.update({
                    where: { id: mailboxId },
                    data: { credentials: encryptJson(rotated) },
                });
            },
        },
    });

    let replies: InboundReply[] = [];
    try {
        replies = await provider.fetchReplies(since);
        // Clear backoff on successful fetch.
        await clearPollBackoff(mailboxId);
    } catch (err) {
        logger.error({ err, mailboxId }, "[replyPoller] fetchReplies error");
        // Record the failure so subsequent calls apply exponential backoff.
        await recordPollFailure(mailboxId);
        return;
    }

    logger.info({ mailboxId, count: replies.length, since }, "[replyPoller] fetched replies");

    if (replies.length === 0) {
        await prisma.senderMailbox.update({
            where: { id: mailboxId },
            data: { lastReplyCheckedAt: new Date() },
        });
        return;
    }

    const existingReplies = await prisma.reply.findMany({
        where: { providerMessageId: { in: replies.map((r) => r.providerMessageId) } },
        select: { providerMessageId: true },
    });
    const seenIds = new Set(existingReplies.map((r) => r.providerMessageId));

    const newReplies = replies.filter((r) => !seenIds.has(r.providerMessageId));

    if (newReplies.length === 0) {
        await prisma.senderMailbox.update({
            where: { id: mailboxId },
            data: { lastReplyCheckedAt: new Date() },
        });
        return;
    }

    const inReplyToIds = [
        ...new Set(newReplies.flatMap((r) => (r.inReplyToId ? [r.inReplyToId] : []))),
    ];
    const outreachByExternalId = new Map<string, { id: string; leadId: string }>();

    if (inReplyToIds.length > 0) {
        const matched = await prisma.outreachMessage.findMany({
            where: {
                externalMessageId: { in: inReplyToIds },
                lead: { campaign: { senderMailboxId: mailboxId } },
            },
            select: { id: true, leadId: true, externalMessageId: true },
        });
        for (const m of matched) {
            if (m.externalMessageId) {
                outreachByExternalId.set(m.externalMessageId, { id: m.id, leadId: m.leadId });
            }
        }
    }

    const unresolvedReplies = newReplies.filter(
        (r) => !r.inReplyToId || !outreachByExternalId.has(r.inReplyToId),
    );
    const outreachByEmail = new Map<string, { id: string; leadId: string }>();

    if (unresolvedReplies.length > 0) {
        const fromEmails = [...new Set(unresolvedReplies.map((r) => r.fromEmail))];
        const leads = await prisma.lead.findMany({
            where: {
                email: { in: fromEmails },
                deletedAt: null,
                campaign: { senderMailboxId: mailboxId },
            },
            select: {
                id: true,
                email: true,
                outreachMessages: {
                    select: { id: true },
                    where: { deliveryState: "SENT" },
                    take: 1,
                },
            },
            orderBy: { createdAt: "desc" },
        });
        for (const lead of leads) {
            if (!lead.email || !lead.outreachMessages[0] || outreachByEmail.has(lead.email)) continue;
            outreachByEmail.set(lead.email, { id: lead.outreachMessages[0].id, leadId: lead.id });
        }
    }

    let recorded = 0;

    for (const reply of newReplies) {
        const outreach =
            (reply.inReplyToId ? outreachByExternalId.get(reply.inReplyToId) : undefined) ??
            outreachByEmail.get(reply.fromEmail);

        if (!outreach) {
            logger.debug(
                { providerMessageId: reply.providerMessageId, fromEmail: reply.fromEmail },
                "[replyPoller] Could not correlate reply to an outreach message, skipping",
            );
            continue;
        }

        try {
            await createReply({
                body: reply.bodyText,
                providerMessageId: reply.providerMessageId,
                outreachMessageId: outreach.id,
                leadId: outreach.leadId,
            });
            recorded++;
        } catch (err) {
            logger.error(
                { err, providerMessageId: reply.providerMessageId },
                "[replyPoller] failed to record reply",
            );
        }
    }

    await prisma.senderMailbox.update({
        where: { id: mailboxId },
        data: { lastReplyCheckedAt: new Date() },
    });

    if (recorded > 0) {
        logger.info({ mailboxId, recorded }, "[replyPoller] recorded new replies");
    }
}

const MAILBOX_POLL_PAGE_SIZE = 100;

export async function pollAllMailboxes(): Promise<void> {
    const limiters = createReplyPollLimiters();
    const limit = limiters.mailbox;
    let cursor: string | undefined;
    let totalPolled = 0;

    while (true) {
        const mailboxes = await prisma.senderMailbox.findMany({
            where: { health: { not: "BLOCKED" } },
            select: { id: true },
            take: MAILBOX_POLL_PAGE_SIZE,
            ...(cursor && { skip: 1, cursor: { id: cursor } }),
            orderBy: { id: "asc" },
        });

        if (mailboxes.length === 0) break;

        logger.info({ count: mailboxes.length, cursor }, "[replyPoller] polling mailbox page");

        const results = await Promise.allSettled(
            mailboxes.map((mb) => limit(() => pollMailboxReplies(mb.id))),
        );

        for (const [i, result] of results.entries()) {
            if (result.status === "rejected") {
                logger.error(
                    { err: result.reason, mailboxId: mailboxes[i].id },
                    "[replyPoller] uncaught error polling mailbox",
                );
            }
        }

        totalPolled += mailboxes.length;
        if (mailboxes.length < MAILBOX_POLL_PAGE_SIZE) break;
        cursor = mailboxes[mailboxes.length - 1].id;
    }

    logger.info({ totalPolled }, "[replyPoller] polling complete");
}