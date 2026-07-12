import { z } from "zod";
import { DELIVERABILITY_EVENT_TYPES } from "../../lib/constants";

const eventTypeEnum = z.enum([
    DELIVERABILITY_EVENT_TYPES.BOUNCE,
    DELIVERABILITY_EVENT_TYPES.SOFT_BOUNCE,
    DELIVERABILITY_EVENT_TYPES.HARD_BOUNCE,
    DELIVERABILITY_EVENT_TYPES.SPAM_COMPLAINT,
    DELIVERABILITY_EVENT_TYPES.UNSUBSCRIBE,
    DELIVERABILITY_EVENT_TYPES.DELIVERY_FAILURE,
    DELIVERABILITY_EVENT_TYPES.DOMAIN_BLOCKED,
]);

const severityEnum = z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]);

export const ingestDeliverabilityEventSchema = z.object({
    type: eventTypeEnum,
    severity: severityEnum,
    campaignId: z.string().optional(),
    senderDomainId: z.string().optional(),
    senderMailboxId: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
}).refine(
    (data) =>
        data.campaignId !== undefined ||
        data.senderDomainId !== undefined ||
        data.senderMailboxId !== undefined,
    { message: "At least one of campaignId, senderDomainId, or senderMailboxId must be provided" }
);

export const getDeliverabilityEventsQuerySchema = z.object({
    type: eventTypeEnum.optional(),
    severity: severityEnum.optional(),
    campaignId: z.string().optional(),
    senderDomainId: z.string().optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
});