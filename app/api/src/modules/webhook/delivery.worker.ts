import { Worker } from "bullmq";
import {
    DeliveryState,
    LeadJourneyEventType,
    Prisma,
} from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
    redis,
    redisConnectionOptions,
} from "../../lib/ioredis";
import { logger } from "../../lib/logger";
import { QUEUE_POLICY } from "../gemini/queue-policy";
import {
    wireWorkerEvents,
    registerForShutdown,
} from "../gemini/worker-runtime";
import { logLeadJourneyEvent } from "../../lib/leads/lead-journey.service";
import type { ProviderDeliveryEvent } from "./delivery.controller";

const DELIVERY_STATE_TO_JOURNEY_EVENT: Partial<
    Record<DeliveryState, LeadJourneyEventType>
> = {
    DELIVERED: "EMAIL_DELIVERED",
    BOUNCED: "EMAIL_BOUNCED",
    OPENED: "EMAIL_OPENED",
};

export interface DeliveryWebhookJobData {
    payload: ProviderDeliveryEvent;
    newState: DeliveryState;
    dedupKey: string;
}

const SOFT_BOUNCE_TYPES = new Set([
    "Transient",
    "transient",
    "soft",
    "Soft",
]);

const SOFT_BOUNCE_TEXT_PATTERNS = [
    /temporarily/i,
    /try again/i,
    /too many connections/i,
    /message deferred/i,
    /over quota/i,
    /insufficient system storage/i,
    /4\d\d/,
];

const TERMINAL_STATES: DeliveryState[] = [
    "BOUNCED",
    "SPAM",
    "REPLIED",
];

const ALLOWED_RATE_FIELDS = new Set([
    "bounceRate",
    "complaintRate",
]);

function isSoftBounce(payload: ProviderDeliveryEvent): boolean {
    if (
        payload.bounceType &&
        SOFT_BOUNCE_TYPES.has(payload.bounceType)
    ) {
        return true;
    }

    if (
        payload.bounceSubType &&
        SOFT_BOUNCE_TYPES.has(payload.bounceSubType)
    ) {
        return true;
    }

    const code = String(payload.statusCode ?? "");

    if (code.startsWith("4")) {
        return true;
    }

    const diagnostic = payload.diagnosticCode ?? "";

    return SOFT_BOUNCE_TEXT_PATTERNS.some((re) =>
        re.test(diagnostic)
    );
}

async function updateMailboxDeliverabilityMetrics(
    mailboxId: string,
    state: "BOUNCED" | "SPAM",
): Promise<void> {
    const rateField =
        state === "BOUNCED"
            ? "bounceRate"
            : "complaintRate";

    if (!ALLOWED_RATE_FIELDS.has(rateField)) {
        throw new Error(
            `[delivery-worker] Invalid rateField: ${rateField}`,
        );
    }

    await prisma.$transaction(async (tx) => {
        const mailbox = await tx.senderMailbox.findUnique({
            where: {
                id: mailboxId,
            },
            select: {
                totalSent: true,
            },
        });

        if (!mailbox || mailbox.totalSent === 0) {
            return;
        }

        const total = mailbox.totalSent;
        const column = Prisma.raw(`"${rateField}"`);

        await tx.$executeRaw`
      UPDATE "SenderMailbox"
      SET ${column} =
        (FLOOR(${column} * ${total}) + 1.0) / ${total}
      WHERE id = ${mailboxId}
    `;
    });
}

async function updateDomainDeliverabilityMetrics(
    domainId: string,
    state: "BOUNCED" | "SPAM",
): Promise<void> {
    const rateField =
        state === "BOUNCED"
            ? "bounceRate"
            : "complaintRate";

    if (!ALLOWED_RATE_FIELDS.has(rateField)) {
        throw new Error(
            `[delivery-worker] Invalid rateField: ${rateField}`,
        );
    }

    await prisma.$transaction(async (tx) => {
        const domain = await tx.senderDomain.findUnique({
            where: {
                id: domainId,
            },
            select: {
                totalSent: true,
            },
        });

        if (!domain || domain.totalSent === 0) {
            return;
        }

        const total = domain.totalSent;
        const column = Prisma.raw(`"${rateField}"`);

        await tx.$executeRaw`
      UPDATE "SenderDomain"
      SET ${column} =
        (FLOOR(${column} * ${total}) + 1.0) / ${total}
      WHERE id = ${domainId}
    `;
    });
}

async function processDeliveryEvent(
    data: DeliveryWebhookJobData,
): Promise<void> {
    const {
        payload,
        newState,
    } = data;

    const eventTime = payload.timestamp
        ? new Date(payload.timestamp)
        : new Date();

    const updated = await prisma.outreachMessage.updateMany({
        where: {
            externalMessageId: payload.externalMessageId,
            deliveryState: {
                notIn: TERMINAL_STATES,
            },
        },
        data: {
            deliveryState: newState,
            ...(newState === "OPENED"
                ? { openedAt: eventTime }
                : {}),
            ...(newState === "DELIVERED"
                ? { deliveredAt: eventTime }
                : {}),
        },
    });

    if (updated.count === 0) {
        logger.warn(
            {
                externalMessageId:
                    payload.externalMessageId,
                event: payload.event,
            },
            "[delivery-worker] No matching outreach message found (or already terminal)",
        );
        return;
    }

    const needsMessageDetails =
        Boolean(
            DELIVERY_STATE_TO_JOURNEY_EVENT[newState],
        ) ||
        ((newState === "BOUNCED" ||
            newState === "SPAM") &&
            Boolean(payload.recipientEmail));

    if (!needsMessageDetails) {
        if (
            newState === "BOUNCED" &&
            isSoftBounce(payload)
        ) {
            await prisma.outreachMessage.updateMany({
                where: {
                    externalMessageId:
                        payload.externalMessageId,
                },
                data: {
                    deliveryState: "FAILED",
                },
            });

            logger.info(
                {
                    externalMessageId:
                        payload.externalMessageId,
                    bounceType: payload.bounceType,
                },
                "[delivery-worker] Soft bounce — state set to FAILED, suppression skipped",
            );
        }

        return;
    }

    const message = await prisma.outreachMessage.findFirst({
        where: {
            externalMessageId:
                payload.externalMessageId,
        },
        select: {
            id: true,
            leadId: true,
            lead: {
                select: {
                    campaign: {
                        select: {
                            createdById: true,
                            orgId: true,
                            senderMailbox: {
                                select: {
                                    id: true,
                                },
                            },
                            senderDomain: {
                                select: {
                                    id: true,
                                },
                            },
                        },
                    },
                },
            },
        },
    });

    if (!message) {
        logger.warn(
            {
                externalMessageId:
                    payload.externalMessageId,
            },
            "[delivery-worker] Outreach message disappeared after state update",
        );
        return;
    }

    const journeyEventType =
        DELIVERY_STATE_TO_JOURNEY_EVENT[newState];

    if (journeyEventType) {
        await logLeadJourneyEvent({
            leadId: message.leadId,
            eventType: journeyEventType,
            channel: "EMAIL",
            outreachMessageId: message.id,
        });
    }

    if (
        newState === "BOUNCED" &&
        isSoftBounce(payload)
    ) {
        await prisma.outreachMessage.updateMany({
            where: {
                externalMessageId:
                    payload.externalMessageId,
            },
            data: {
                deliveryState: "FAILED",
            },
        });

        logger.info(
            {
                externalMessageId:
                    payload.externalMessageId,
                bounceType: payload.bounceType,
            },
            "[delivery-worker] Soft bounce — state set to FAILED, suppression skipped",
        );

        return;
    }

    if (
        (newState === "BOUNCED" ||
            newState === "SPAM") &&
        payload.recipientEmail
    ) {
        const userId =
            message.lead?.campaign?.createdById;
        const orgId =
            message.lead?.campaign?.orgId;

        if (userId && orgId) {
            await prisma.suppression.upsert({
                where: {
                    email_orgId: {
                        email: payload.recipientEmail,
                        orgId,
                    },
                },
                create: {
                    email: payload.recipientEmail,
                    reason: payload.event,
                    source: "delivery-webhook",
                    userId,
                    orgId,
                },
                update: {},
            });
        } else {
            logger.warn(
                {
                    externalMessageId:
                        payload.externalMessageId,
                },
                "[delivery-worker] Could not resolve userId for suppression — skipping",
            );
        }

        const mailboxId =
            message.lead?.campaign?.senderMailbox?.id;

        const domainId =
            message.lead?.campaign?.senderDomain?.id;

        await Promise.all([
            mailboxId
                ? updateMailboxDeliverabilityMetrics(
                    mailboxId,
                    newState as "BOUNCED" | "SPAM",
                )
                : Promise.resolve(),
            domainId
                ? updateDomainDeliverabilityMetrics(
                    domainId,
                    newState as "BOUNCED" | "SPAM",
                )
                : Promise.resolve(),
        ]);

        logger.info(
            {
                externalMessageId:
                    payload.externalMessageId,
                event: payload.event,
                recipientEmail:
                    payload.recipientEmail,
            },
            "[delivery-worker] Hard bounce/complaint processed",
        );
    }
}

const policy = QUEUE_POLICY.deliveryWebhook;

export const deliveryWebhookWorker =
    new Worker<DeliveryWebhookJobData>(
        policy.queueName,
        async (job) => {
            try {
                await processDeliveryEvent(job.data);
            } catch (err) {
                await redis
                    .del(job.data.dedupKey)
                    .catch(() => undefined);
                throw err;
            }
        },
        {
            connection: redisConnectionOptions,
            concurrency: policy.concurrency,
            lockDuration: policy.lockDuration,
        },
    );

wireWorkerEvents(
    deliveryWebhookWorker,
    policy.queueName,
);

registerForShutdown(deliveryWebhookWorker);