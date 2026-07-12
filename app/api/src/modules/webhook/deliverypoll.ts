import { prisma } from "../../lib/prisma";
import { createMailProvider, MailboxCredentials } from "../../lib/mail";
import { decryptJson, isEncrypted } from "../../lib/mail/crypto";
import { logger } from "../../lib/logger";
import { DeliveryState, Prisma } from "@prisma/client";
import pLimit from "p-limit";

interface DeliveryPollLimiters {
    mailbox: ReturnType<typeof pLimit>;
}

export function createDeliveryPollLimiters(): DeliveryPollLimiters {
    return {
        mailbox: pLimit(10),
    };
}

function decryptCredentials(raw: unknown): MailboxCredentials {
    if (isEncrypted(raw)) return decryptJson<MailboxCredentials>(raw as string);
    return raw as MailboxCredentials;
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
            await prisma.suppression.upsert({
                where: { email_userId: { email: recipientEmail, userId } },
                create: {
                    email: recipientEmail,
                    reason: newState === "BOUNCED"
                        ? "Hard bounce — permanent delivery failure"
                        : "Spam complaint detected via inbox poll",
                    source: "delivery-poller",
                    userId,
                },
                update: {},
            });
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

        await tx.$executeRaw`
            UPDATE "SenderDomain"
            SET ${Prisma.raw(`"${rateField}"`)} = (FLOOR(${Prisma.raw(`"${rateField}"`)} * ${total}) + 1.0) / ${total}
            WHERE id = ${domain.id}
        `;
    });
}

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

    const since = mailbox.lastReplyCheckedAt ?? new Date(Date.now() - 24 * 60 * 60 * 1000);

    const provider = createMailProvider(decryptCredentials(mailbox.credentials));

    let inboxMessages: Awaited<ReturnType<typeof provider.fetchReplies>>;
    try {
        inboxMessages = await provider.fetchReplies(since);
    } catch (err) {
        logger.error({ err, mailboxId }, "[deliveryPoller] fetchReplies error");
        return;
    }

    let bounces = 0;
    let complaints = 0;

    for (const msg of inboxMessages) {
        const classification = classifyInboxMessage(msg.fromEmail, msg.subject);

        if (classification.type === "BOUNCE" || classification.type === "SPAM") {
            const newState: DeliveryState = classification.type === "BOUNCE" ? "BOUNCED" : "SPAM";
            const bounceKind = classification.type === "BOUNCE" ? classification.kind : null;

            if (msg.inReplyToId) {
                const outreach = await prisma.outreachMessage.findUnique({
                    where: { externalMessageId: msg.inReplyToId },
                    select: { id: true, lead: { select: { email: true } } },
                });

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
    }

    await prisma.senderMailbox.update({
        where: { id: mailboxId },
        data: { lastReplyCheckedAt: new Date() },
    });

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
        } catch (err) {
            logger.error({ err, mailboxId: mb.id }, "[deliveryPoller] uncaught error polling mailbox");
        }
    }
}