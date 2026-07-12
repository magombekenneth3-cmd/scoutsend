import { Worker } from "bullmq";
import { DeliveryState, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { redis, createRedisConnection } from "../../lib/ioredis";
import { logger } from "../../lib/logger";
import { QUEUE_POLICY } from "../gemini/queue-policy";
import { wireWorkerEvents, registerForShutdown } from "../gemini/worker-runtime";
import type { ProviderDeliveryEvent } from "./delivery.controller";

export interface DeliveryWebhookJobData {
    payload: ProviderDeliveryEvent;
    newState: DeliveryState;
    dedupKey: string;
}

const SOFT_BOUNCE_TYPES = new Set(["Transient", "transient", "soft", "Soft"]);

const SOFT_BOUNCE_TEXT_PATTERNS = [
    /temporarily/i,
    /try again/i,
    /too many connections/i,
    /message deferred/i,
    /over quota/i,
    /insufficient system storage/i,
    /4\d\d/,
];

function isSoftBounce(payload: ProviderDeliveryEvent): boolean {
    if (payload.bounceType && SOFT_BOUNCE_TYPES.has(payload.bounceType)) return true;
    if (payload.bounceSubType && SOFT_BOUNCE_TYPES.has(payload.bounceSubType)) return true;
    const code = String(payload.statusCode ?? "");
    if (code.startsWith("4")) return true;
    const diagnostic = payload.diagnosticCode ?? "";
    return SOFT_BOUNCE_TEXT_PATTERNS.some((re) => re.test(diagnostic));
}

const TERMINAL_STATES: DeliveryState[] = ["BOUNCED", "SPAM", "REPLIED"];

async function updateMailboxDeliverabilityMetrics(
    externalMessageId: string,
    state: "BOUNCED" | "SPAM",
): Promise<void> {
    const message = await prisma.outreachMessage.findFirst({
        where: { externalMessageId },
        select: {
            lead: {
                select: {
                    campaign: {
                        select: { senderMailbox: { select: { id: true } } },
                    },
                },
            },
        },
    });

    const mailboxId = message?.lead?.campaign?.senderMailbox?.id;
    if (!mailboxId) return;

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
}

async function updateDomainDeliverabilityMetrics(
    externalMessageId: string,
    state: "BOUNCED" | "SPAM",
): Promise<void> {
    const message = await prisma.outreachMessage.findFirst({
        where: { externalMessageId },
        select: {
            lead: {
                select: {
                    campaign: {
                        select: { senderDomain: { select: { id: true } } },
                    },
                },
            },
        },
    });

    const domainId = message?.lead?.campaign?.senderDomain?.id;
    if (!domainId) return;

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
}

async function processDeliveryEvent(data: DeliveryWebhookJobData): Promise<void> {
    const { payload, newState, dedupKey } = data;
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
            "[delivery-worker] No matching outreach message found (or already terminal)",
        );
        return;
    }

    if (newState === "BOUNCED" && isSoftBounce(payload)) {
        await prisma.outreachMessage.updateMany({
            where: { externalMessageId: payload.externalMessageId },
            data: { deliveryState: "FAILED" },
        });
        logger.info(
            { externalMessageId: payload.externalMessageId, bounceType: payload.bounceType },
            "[delivery-worker] Soft bounce — state set to FAILED, suppression skipped",
        );
        return;
    }

    if ((newState === "BOUNCED" || newState === "SPAM") && payload.recipientEmail) {
        const msgForUser = await prisma.outreachMessage.findFirst({
            where: { externalMessageId: payload.externalMessageId },
            select: { lead: { select: { campaign: { select: { createdById: true } } } } },
        });
        const userId = msgForUser?.lead?.campaign?.createdById;

        if (userId) {
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
        } else {
            logger.warn(
                { externalMessageId: payload.externalMessageId },
                "[delivery-worker] Could not resolve userId for suppression — skipping",
            );
        }

        await Promise.all([
            updateMailboxDeliverabilityMetrics(payload.externalMessageId, newState as "BOUNCED" | "SPAM"),
            updateDomainDeliverabilityMetrics(payload.externalMessageId, newState as "BOUNCED" | "SPAM"),
        ]);

        logger.info(
            {
                externalMessageId: payload.externalMessageId,
                event: payload.event,
                recipientEmail: payload.recipientEmail,
            },
            "[delivery-worker] Hard bounce/complaint processed",
        );
    }
}

const policy = QUEUE_POLICY.deliveryWebhook;

export const deliveryWebhookWorker = new Worker<DeliveryWebhookJobData>(
    policy.queueName,
    async (job) => {
        try {
            await processDeliveryEvent(job.data);
        } catch (err) {
            await redis.del(job.data.dedupKey).catch(() => undefined);
            throw err;
        }
    },
    {
        connection: createRedisConnection(),
        concurrency: policy.concurrency,
        lockDuration: policy.lockDuration,
    },
);

wireWorkerEvents(deliveryWebhookWorker, policy.queueName);
registerForShutdown(deliveryWebhookWorker);
