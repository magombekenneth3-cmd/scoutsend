import { Channel, LeadJourneyEventType, Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { logger } from "../logger";

const EVENT_LABELS: Record<LeadJourneyEventType, string> = {
    EMAIL_SENT: "sent an email",
    EMAIL_DELIVERED: "had an email delivered",
    EMAIL_OPENED: "opened an email",
    EMAIL_CLICKED: "clicked a link in an email",
    EMAIL_BOUNCED: "had an email bounce",
    LINKEDIN_VISITED: "had their LinkedIn profile visited",
    LINKEDIN_CONNECT_SENT: "received a LinkedIn connection request",
    LINKEDIN_CONNECT_ACCEPTED: "accepted a LinkedIn connection",
    LINKEDIN_MESSAGED: "received a LinkedIn message",
    REPLY_RECEIVED: "replied",
    SEQUENCE_STEP_EXECUTED: "had a sequence step run",
    PIPELINE_STAGE_CHANGED: "moved pipeline stage",
    MEETING_BOOKED: "booked a meeting",
    SIGNAL_DETECTED: "triggered a new signal",
    SCORE_UPDATED: "had their qualification score updated",
    SUPPRESSED: "was suppressed",
};

const DEFAULT_JOURNEY_LIMIT = 20;
const MAX_JOURNEY_LIMIT = 100;

function normalizeLimit(limit: number): number {
    if (!Number.isFinite(limit)) {
        return DEFAULT_JOURNEY_LIMIT;
    }

    return Math.min(
        MAX_JOURNEY_LIMIT,
        Math.max(1, Math.trunc(limit)),
    );
}

function normalizeMetadata(
    metadata?: Record<string, unknown>,
): Prisma.InputJsonValue | undefined {
    if (!metadata) {
        return undefined;
    }

    try {
        return JSON.parse(JSON.stringify(metadata)) as Prisma.InputJsonValue;
    } catch {
        return undefined;
    }
}

export async function logLeadJourneyEvent(params: {
    leadId: string;
    eventType: LeadJourneyEventType;
    channel?: Channel;
    outreachMessageId?: string;
    metadata?: Record<string, unknown>;
}): Promise<void> {
    const {
        leadId,
        eventType,
        channel,
        outreachMessageId,
        metadata,
    } = params;

    try {
        await prisma.leadJourneyEvent.create({
            data: {
                leadId,
                eventType,
                channel,
                outreachMessageId,
                metadata: normalizeMetadata(metadata),
            },
        });
    } catch (err) {
        logger.error(
            { err, leadId, eventType },
            "[lead-journey] Failed to log event",
        );
    }
}

export async function getRecentLeadJourney(
    leadId: string,
    limit = DEFAULT_JOURNEY_LIMIT,
) {
    return prisma.leadJourneyEvent.findMany({
        where: { leadId },
        orderBy: { createdAt: "desc" },
        take: normalizeLimit(limit),
    });
}

export async function summarizeLeadJourney(
    leadId: string,
    limit = DEFAULT_JOURNEY_LIMIT,
): Promise<string> {
    const events = await getRecentLeadJourney(leadId, limit);

    if (events.length === 0) {
        return "No prior engagement recorded for this lead.";
    }

    const counts = new Map<LeadJourneyEventType, number>();

    for (const event of events) {
        counts.set(
            event.eventType,
            (counts.get(event.eventType) ?? 0) + 1,
        );
    }

    const lines: string[] = [];

    for (const [type, count] of counts) {
        const label = EVENT_LABELS[type] ?? type;
        lines.push(
            count > 1 ? `${label} (x${count})` : label,
        );
    }

    const latest = events[0];

    let latestMetadata: string | null = null;

    if (
        latest.metadata &&
        typeof latest.metadata === "object"
    ) {
        try {
            latestMetadata = JSON.stringify(latest.metadata).slice(0, 200);
        } catch {
            latestMetadata = null;
        }
    }

    return [
        `Lead activity history: ${lines.join(", ")}.`,
        latestMetadata
            ? `Most recent event detail: ${latestMetadata}.`
            : null,
    ]
        .filter((value): value is string => Boolean(value))
        .join(" ");
}