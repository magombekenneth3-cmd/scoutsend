import { Channel, LeadJourneyEventType, Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { logger } from "../logger";

export async function logLeadJourneyEvent(params: {
    leadId: string;
    eventType: LeadJourneyEventType;
    channel?: Channel;
    outreachMessageId?: string;
    metadata?: Record<string, unknown>;
}): Promise<void> {
    const { leadId, eventType, channel, outreachMessageId, metadata } = params;

    try {
        await prisma.leadJourneyEvent.create({
            data: {
                leadId,
                eventType,
                channel,
                outreachMessageId,
                metadata: metadata as Prisma.InputJsonValue | undefined,
            },
        });
    } catch (err) {
        logger.error({ err, leadId, eventType }, "[lead-journey] Failed to log event");
    }
}

const EVENT_LABELS: Record<LeadJourneyEventType, string> = {
    EMAIL_SENT: "sent an email",
    EMAIL_DELIVERED: "had an email delivered",
    EMAIL_OPENED: "opened an email",
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

export async function getRecentLeadJourney(leadId: string, limit = 20) {
    return prisma.leadJourneyEvent.findMany({
        where: { leadId },
        orderBy: { createdAt: "desc" },
        take: limit,
    });
}

export async function summarizeLeadJourney(leadId: string, limit = 20): Promise<string> {
    const events = await getRecentLeadJourney(leadId, limit);

    if (events.length === 0) return "No prior engagement recorded for this lead.";

    const counts = new Map<LeadJourneyEventType, number>();
    for (const event of events) {
        counts.set(event.eventType, (counts.get(event.eventType) ?? 0) + 1);
    }

    const lines: string[] = [];
    for (const [type, count] of counts) {
        const label = EVENT_LABELS[type] ?? type;
        lines.push(count > 1 ? `${label} (x${count})` : label);
    }

    const latest = events[0];
    const latestMetadata =
        latest.metadata && typeof latest.metadata === "object"
            ? JSON.stringify(latest.metadata).slice(0, 200)
            : null;

    return [
        `Lead activity history: ${lines.join(", ")}.`,
        latestMetadata ? `Most recent event detail: ${latestMetadata}.` : null,
    ]
        .filter(Boolean)
        .join(" ");
}