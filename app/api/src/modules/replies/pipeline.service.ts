import { PipelineStage } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../audit/audit.service";
import { AUDIT_EVENTS } from "../../lib/constants";
import { logger } from "../../lib/logger";
import type { ReplyIntent } from "../gemini/reply.agent";
import { realtimeQueue } from "../gemini/campaign.queue";
import { logLeadJourneyEvent } from "../../lib/leads/lead-journey.service";

const STAGE_PRIORITY: Record<PipelineStage, number> = {
    PROSPECT: 0,
    ENGAGED: 1,
    HOT: 2,
    MEETING_BOOKED: 3,
    DISQUALIFIED: -1,
};

const INTENT_TO_STAGE: Partial<Record<ReplyIntent, PipelineStage>> = {
    MEETING_REQUEST: "MEETING_BOOKED",
    POSITIVE: "HOT",
    QUESTION: "ENGAGED",
    NOT_INTERESTED: "DISQUALIFIED",
    NEGATIVE: "DISQUALIFIED",
};

export interface PipelineAdvancement {
    advanced: boolean;
    newStage: PipelineStage | null;
    previousStage: PipelineStage;
}

export interface PipelineFunnel {
    PROSPECT: number;
    ENGAGED: number;
    HOT: number;
    MEETING_BOOKED: number;
    DISQUALIFIED: number;
}

export interface PipelineStats {
    funnel: PipelineFunnel;
    totalLeads: number;
    replyRate: number;
    hotRate: number;
    meetingBookedRate: number;
    disqualifyRate: number;
}

function createFunnel(): PipelineFunnel {
    return {
        PROSPECT: 0,
        ENGAGED: 0,
        HOT: 0,
        MEETING_BOOKED: 0,
        DISQUALIFIED: 0,
    };
}

function calculateStats(funnel: PipelineFunnel): PipelineStats {
    const totalLeads = Object.values(funnel).reduce((a, b) => a + b, 0);
    const hotAndAbove = funnel.HOT + funnel.MEETING_BOOKED;
    const anythingBeyondProspect =
        funnel.ENGAGED +
        funnel.HOT +
        funnel.MEETING_BOOKED +
        funnel.DISQUALIFIED;

    const safe = (n: number) =>
        totalLeads > 0 ? parseFloat((n / totalLeads).toFixed(4)) : 0;

    return {
        funnel,
        totalLeads,
        replyRate: safe(anythingBeyondProspect),
        hotRate: safe(hotAndAbove),
        meetingBookedRate: safe(funnel.MEETING_BOOKED),
        disqualifyRate: safe(funnel.DISQUALIFIED),
    };
}

async function enqueueDiscoveryScript(leadId: string): Promise<void> {
    try {
        await realtimeQueue.add(
            "generate-discovery-script",
            { leadId },
            {
                jobId: `discovery-script-${leadId}`,
                removeOnComplete: { age: 3600 },
                removeOnFail: { age: 86400 },
            },
        );
    } catch (err) {
        logger.error(
            { err, leadId },
            "[pipeline.service] Failed to enqueue discovery script",
        );
    }
}

export async function advanceLeadPipeline(params: {
    leadId: string;
    intent: ReplyIntent;
    replyId: string;
    campaignId: string;
    auditUserId?: string;
}): Promise<PipelineAdvancement> {
    const { leadId, intent, replyId, campaignId, auditUserId } = params;
    const targetStage = INTENT_TO_STAGE[intent];

    if (!targetStage) {
        const lead = await prisma.lead.findUnique({
            where: { id: leadId },
            select: { pipelineStage: true },
        });

        return {
            advanced: false,
            newStage: null,
            previousStage: lead?.pipelineStage ?? "PROSPECT",
        };
    }

    const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { pipelineStage: true },
    });

    if (!lead) {
        logger.warn(
            { leadId },
            "[pipeline.service] Lead not found — skipping advancement",
        );

        return {
            advanced: false,
            newStage: null,
            previousStage: "PROSPECT",
        };
    }

    const previousStage = lead.pipelineStage;
    const currentPriority = STAGE_PRIORITY[previousStage];
    const targetPriority = STAGE_PRIORITY[targetStage];

    if (
        targetStage !== "DISQUALIFIED" &&
        targetPriority <= currentPriority
    ) {
        logger.info(
            { leadId, previousStage, targetStage, intent },
            "[pipeline.service] Stage unchanged — current stage is equal or higher priority",
        );

        return {
            advanced: false,
            newStage: null,
            previousStage,
        };
    }

    const now = new Date();

    const updateResult =
        targetStage === "DISQUALIFIED"
            ? await prisma.lead.updateMany({
                where: { id: leadId },
                data: {
                    pipelineStage: targetStage,
                    pipelineStageUpdatedAt: now,
                },
            })
            : await prisma.lead.updateMany({
                where: {
                    id: leadId,
                    pipelineStage: {
                        in: (
                            Object.keys(STAGE_PRIORITY) as PipelineStage[]
                        ).filter(
                            (stage) =>
                                STAGE_PRIORITY[stage] < targetPriority &&
                                stage !== "DISQUALIFIED",
                        ),
                    },
                },
                data: {
                    pipelineStage: targetStage,
                    pipelineStageUpdatedAt: now,
                },
            });

    if (updateResult.count === 0) {
        const currentLead = await prisma.lead.findUnique({
            where: { id: leadId },
            select: { pipelineStage: true },
        });

        if (!currentLead) {
            logger.warn(
                { leadId },
                "[pipeline.service] Lead disappeared during advancement",
            );

            return {
                advanced: false,
                newStage: null,
                previousStage,
            };
        }

        logger.info(
            {
                leadId,
                previousStage: currentLead.pipelineStage,
                targetStage,
                intent,
            },
            "[pipeline.service] Concurrent stage update won — advancement skipped",
        );

        return {
            advanced: false,
            newStage: null,
            previousStage: currentLead.pipelineStage,
        };
    }

    logger.info(
        {
            leadId,
            previousStage,
            newStage: targetStage,
            intent,
            replyId,
            campaignId,
        },
        "[pipeline.service] Lead pipeline advanced",
    );

    try {
        await logLeadJourneyEvent({
            leadId,
            eventType:
                targetStage === "MEETING_BOOKED"
                    ? "MEETING_BOOKED"
                    : "PIPELINE_STAGE_CHANGED",
            metadata: {
                previousStage,
                newStage: targetStage,
                intent,
                trigger: "reply",
                replyId,
            },
        });
    } catch (err) {
        logger.error(
            { err, leadId, targetStage, replyId },
            "[pipeline.service] Lead journey event failed",
        );
    }

    if (auditUserId) {
        logAudit({
            userId: auditUserId,
            action: AUDIT_EVENTS.LEAD_PIPELINE_ADVANCED,
            entityType: "Lead",
            entityId: leadId,
            metadata: {
                previousStage,
                newStage: targetStage,
                intent,
                replyId,
                campaignId,
            },
        }).catch((err) =>
            logger.error(
                { err, leadId },
                "[pipeline.service] Audit log failed",
            ),
        );
    }

    if (targetStage === "MEETING_BOOKED") {
        void enqueueDiscoveryScript(leadId);
    }

    return {
        advanced: true,
        newStage: targetStage,
        previousStage,
    };
}

export async function markLeadMeetingBooked(params: {
    leadId: string;
    replyId: string;
    campaignId: string;
    auditUserId: string;
    notes?: string;
}): Promise<PipelineAdvancement> {
    const { leadId, replyId, campaignId, auditUserId, notes } = params;

    const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: { pipelineStage: true },
    });

    if (!lead) {
        throw Object.assign(new Error("Lead not found"), {
            statusCode: 404,
        });
    }

    const previousStage = lead.pipelineStage;

    if (previousStage === "MEETING_BOOKED") {
        return {
            advanced: false,
            newStage: "MEETING_BOOKED",
            previousStage,
        };
    }

    const updateResult = await prisma.lead.updateMany({
        where: {
            id: leadId,
            pipelineStage: previousStage,
        },
        data: {
            pipelineStage: "MEETING_BOOKED",
            pipelineStageUpdatedAt: new Date(),
        },
    });

    if (updateResult.count === 0) {
        const currentLead = await prisma.lead.findUnique({
            where: { id: leadId },
            select: { pipelineStage: true },
        });

        if (!currentLead) {
            throw Object.assign(new Error("Lead not found"), {
                statusCode: 404,
            });
        }

        if (currentLead.pipelineStage === "MEETING_BOOKED") {
            return {
                advanced: false,
                newStage: "MEETING_BOOKED",
                previousStage: currentLead.pipelineStage,
            };
        }

        return {
            advanced: false,
            newStage: null,
            previousStage: currentLead.pipelineStage,
        };
    }

    logger.info(
        {
            leadId,
            previousStage,
            replyId,
            campaignId,
            auditUserId,
        },
        "[pipeline.service] Lead manually marked MEETING_BOOKED",
    );

    try {
        await logLeadJourneyEvent({
            leadId,
            eventType: "MEETING_BOOKED",
            metadata: {
                previousStage,
                trigger: "manual",
                replyId,
                notes: notes ?? null,
            },
        });
    } catch (err) {
        logger.error(
            { err, leadId, replyId },
            "[pipeline.service] Lead journey event failed",
        );
    }

    logAudit({
        userId: auditUserId,
        action: AUDIT_EVENTS.LEAD_PIPELINE_ADVANCED,
        entityType: "Lead",
        entityId: leadId,
        metadata: {
            previousStage,
            newStage: "MEETING_BOOKED",
            trigger: "manual",
            replyId,
            campaignId,
            notes: notes ?? null,
        },
    }).catch((err) =>
        logger.error(
            { err, leadId },
            "[pipeline.service] Audit log failed",
        ),
    );

    void enqueueDiscoveryScript(leadId);

    return {
        advanced: true,
        newStage: "MEETING_BOOKED",
        previousStage,
    };
}

export async function getPipelineStats(
    campaignId: string,
): Promise<PipelineStats> {
    const rows = await prisma.lead.groupBy({
        by: ["pipelineStage"],
        where: {
            campaignId,
            deletedAt: null,
        },
        _count: {
            id: true,
        },
    });

    const funnel = createFunnel();

    for (const row of rows) {
        funnel[row.pipelineStage] = row._count.id;
    }

    return calculateStats(funnel);
}

export async function getPipelineStatsForUser(
    userId: string,
): Promise<PipelineStats> {
    const rows = await prisma.lead.groupBy({
        by: ["pipelineStage"],
        where: {
            campaign: {
                createdById: userId,
            },
            deletedAt: null,
        },
        _count: {
            id: true,
        },
    });

    const funnel = createFunnel();

    for (const row of rows) {
        funnel[row.pipelineStage] = row._count.id;
    }

    return calculateStats(funnel);
}