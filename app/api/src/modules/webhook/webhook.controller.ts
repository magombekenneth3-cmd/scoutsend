import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { redis } from "../../lib/ioredis";
import { DeliveryState, Prisma } from "@prisma/client";
import { logger } from "../../lib/logger";

export interface ProviderDeliveryEvent {
    externalMessageId: string;
    event: "delivered" | "bounced" | "complained" | "opened";
    recipientEmail?: string;
    timestamp?: string;
}

function verifySecret(req: Request): boolean {
    const expected = process.env.WEBHOOK_SECRET;
    if (!expected) return false;
    const raw = req.headers["x-webhook-secret"];
    const incoming = Array.isArray(raw) ? raw[0] : (raw ?? "");
    const a = Buffer.from(incoming);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

const EVENT_STATE_MAP: Record<ProviderDeliveryEvent["event"], DeliveryState> = {
    delivered: "DELIVERED",
    bounced: "BOUNCED",
    complained: "SPAM",
    opened: "OPENED",
};

const TERMINAL_STATES: DeliveryState[] = ["BOUNCED", "SPAM", "REPLIED"];

const DEDUP_TTL_SECONDS = 86_400;

export async function handleProviderDeliveryEvent(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    let dedupKey: string | undefined;

    try {
        if (!verifySecret(req)) {
            res.status(401).end();
            return;
        }

        const payload = req.body as ProviderDeliveryEvent;

        if (!payload?.externalMessageId || !payload?.event) {
            res.status(400).json({ error: "Missing externalMessageId or event" });
            return;
        }

        const newState = EVENT_STATE_MAP[payload.event];
        if (!newState) {
            res.status(400).json({ error: `Unknown event type: ${payload.event}` });
            return;
        }

        dedupKey = `wh:delivery:${payload.externalMessageId}:${payload.event}`;
        const acquired = await redis.set(dedupKey, "1", "EX", DEDUP_TTL_SECONDS, "NX");
        if (!acquired) {
            logger.info(
                { externalMessageId: payload.externalMessageId, event: payload.event },
                "[delivery-webhook] Duplicate event — already processing or processed, skipping"
            );
            res.status(200).end();
            return;
        }

        const eventTime = payload.timestamp ? new Date(payload.timestamp) : new Date();

        const updated = await prisma.outreachMessage.updateMany({
            where: {
                externalMessageId: payload.externalMessageId,
                deliveryState: { notIn: TERMINAL_STATES },
            },
            data: {
                deliveryState: newState,
                ...(newState === "OPENED" ? { openedAt: eventTime } : {}),
                ...(newState === "DELIVERED" ? { deliveredAt: eventTime } : {}),
            },
        });

        if (updated.count === 0) {
            logger.warn(
                { externalMessageId: payload.externalMessageId, event: payload.event },
                "[delivery-webhook] No matching outreach message found (or already terminal)"
            );
            res.status(200).end();
            return;
        }

        if (newState === "BOUNCED" || newState === "SPAM") {
            const ctx = await prisma.outreachMessage.findFirst({
                where: { externalMessageId: payload.externalMessageId },
                select: {
                    lead: {
                        select: {
                            campaign: {
                                select: {
                                    createdById: true,
                                    senderMailbox: { select: { id: true } },
                                    senderDomain: { select: { id: true } },
                                },
                            },
                        },
                    },
                },
            });

            const userId = ctx?.lead?.campaign?.createdById;
            const mailboxId = ctx?.lead?.campaign?.senderMailbox?.id;
            const domainId = ctx?.lead?.campaign?.senderDomain?.id;

            if (payload.recipientEmail && userId) {
                await prisma.suppression.upsert({
                    where: { email_userId: { email: payload.recipientEmail, userId } },
                    create: {
                        email: payload.recipientEmail,
                        reason: payload.event,
                        source: "delivery-webhook",
                        userId,
                    },
                    update: {},
                });
            }

            const [mailboxUpdated, domainUpdated] = await Promise.all([
                mailboxId ? updateMailboxDeliverabilityMetrics(mailboxId, newState) : Promise.resolve(false),
                domainId ? updateDomainDeliverabilityMetrics(domainId, newState) : Promise.resolve(false),
            ]);

            logger.info(
                {
                    externalMessageId: payload.externalMessageId,
                    event: payload.event,
                    recipientEmail: payload.recipientEmail,
                    mailboxUpdated,
                    domainUpdated,
                },
                "[delivery-webhook] Bounce/complaint processed"
            );
        }

        res.status(200).end();
    } catch (err) {
        if (dedupKey) {
            await redis.del(dedupKey).catch(() => { });
        }
        next(err);
    }
}

async function updateMailboxDeliverabilityMetrics(
    mailboxId: string,
    state: "BOUNCED" | "SPAM"
): Promise<boolean> {
    await prisma.$transaction(async (tx) => {
        const mailbox = await tx.senderMailbox.findUnique({
            where: { id: mailboxId },
            select: { totalSent: true },
        });

        if (!mailbox || mailbox.totalSent === 0) return;

        const total = mailbox.totalSent;
        const rateField = state === "BOUNCED" ? "bounceRate" : "complaintRate";

        await tx.$executeRaw`
            UPDATE "SenderMailbox"
            SET ${Prisma.raw(`"${rateField}"`)} = (FLOOR(${Prisma.raw(`"${rateField}"`)} * ${total}) + 1.0) / ${total}
            WHERE id = ${mailboxId}
        `;
    });

    return true;
}

async function updateDomainDeliverabilityMetrics(
    domainId: string,
    state: "BOUNCED" | "SPAM"
): Promise<boolean> {
    await prisma.$transaction(async (tx) => {
        const domain = await tx.senderDomain.findUnique({
            where: { id: domainId },
            select: { totalSent: true },
        });

        if (!domain || domain.totalSent === 0) return;

        const total = domain.totalSent;
        const rateField = state === "BOUNCED" ? "bounceRate" : "complaintRate";

        await tx.$executeRaw`
            UPDATE "SenderDomain"
            SET ${Prisma.raw(`"${rateField}"`)} = (FLOOR(${Prisma.raw(`"${rateField}"`)} * ${total}) + 1.0) / ${total}
            WHERE id = ${domainId}
        `;
    });

    return true;
}