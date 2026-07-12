import { PipelineStage } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../audit/audit.service";
import { AUDIT_EVENTS } from "../../lib/constants";
import { logger } from "../../lib/logger";
import type { ReplyIntent } from "../gemini/reply.agent";

// ─── Stage priority ────────────────────────────────────────────────────────────
// Higher number = won't be overwritten by a lower-priority advance.
// DISQUALIFIED uses -1 so it can always override any forward stage.

const STAGE_PRIORITY: Record<PipelineStage, number> = {
    PROSPECT: 0,
    ENGAGED: 1,
    HOT: 2,
    MEETING_BOOKED: 3,
    DISQUALIFIED: -1,
};

// Map: reply intent → target pipeline stage
const INTENT_TO_STAGE: Partial<Record<ReplyIntent, PipelineStage>> = {
    MEETING_REQUEST: "MEETING_BOOKED",
    POSITIVE: "HOT",
    QUESTION: "ENGAGED",
    NOT_INTERESTED: "DISQUALIFIED",
    NEGATIVE: "DISQUALIFIED",
    // OUT_OF_OFFICE and UNKNOWN intentionally omitted — no stage change
};

// ─── Types ─────────────────────────────────────────────────────────────────────

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
    replyRate: number;       // (any stage beyond PROSPECT) / totalLeads
    hotRate: number;         // (HOT + MEETING_BOOKED) / totalLeads
    meetingBookedRate: number; // MEETING_BOOKED / totalLeads
    disqualifyRate: number;  // DISQUALIFIED / totalLeads
}

// ─── Core advancement ──────────────────────────────────────────────────────────

/**
 * Advances a lead's pipeline stage based on a reply intent.
 *
 * Stages only move forward (by priority), except DISQUALIFIED which can
 * always be set. OUT_OF_OFFICE and UNKNOWN intents are no-ops.
 *
 * Called automatically during reply ingestion — auditUserId is optional
 * (system advances don't write an audit log, only a logger entry).
 */
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
        // Intent has no pipeline mapping — silent no-op
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
        logger.warn({ leadId }, "[pipeline.service] Lead not found — skipping advancement");
        return { advanced: false, newStage: null, previousStage: "PROSPECT" };
    }

    const previousStage = lead.pipelineStage;
    const currentPriority = STAGE_PRIORITY[previousStage];
    const targetPriority = STAGE_PRIORITY[targetStage];

    // Only advance if:
    //   (a) target is DISQUALIFIED — always allowed regardless of current stage, or
    //   (b) target has strictly higher priority than current stage
    const shouldAdvance =
        targetStage === "DISQUALIFIED" || targetPriority > currentPriority;

    if (!shouldAdvance) {
        logger.info(
            { leadId, previousStage, targetStage, intent },
            "[pipeline.service] Stage unchanged — current stage is equal or higher priority"
        );
        return { advanced: false, newStage: null, previousStage };
    }

    await prisma.lead.update({
        where: { id: leadId },
        data: {
            pipelineStage: targetStage,
            pipelineStageUpdatedAt: new Date(),
        },
    });

    logger.info(
        { leadId, previousStage, newStage: targetStage, intent, replyId, campaignId },
        "[pipeline.service] Lead pipeline advanced"
    );

    if (auditUserId) {
        logAudit({
            userId: auditUserId,
            action: AUDIT_EVENTS.LEAD_PIPELINE_ADVANCED,
            entityType: "Lead",
            entityId: leadId,
            metadata: { previousStage, newStage: targetStage, intent, replyId, campaignId },
        }).catch((err) => logger.error({ err }, "[pipeline.service] Audit log failed"));
    }

    return { advanced: true, newStage: targetStage, previousStage };
}

/**
 * Manually marks a lead as MEETING_BOOKED.
 *
 * Used when a meeting is confirmed through a channel outside the reply
 * pipeline (e.g. the rep took a call directly). Always requires a userId
 * for the audit trail.
 */
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
        throw Object.assign(new Error("Lead not found"), { statusCode: 404 });
    }

    const previousStage = lead.pipelineStage;

    if (previousStage === "MEETING_BOOKED") {
        // Idempotent — already at target stage
        return { advanced: false, newStage: "MEETING_BOOKED", previousStage };
    }

    await prisma.lead.update({
        where: { id: leadId },
        data: {
            pipelineStage: "MEETING_BOOKED",
            pipelineStageUpdatedAt: new Date(),
        },
    });

    logger.info(
        { leadId, previousStage, replyId, campaignId, auditUserId },
        "[pipeline.service] Lead manually marked MEETING_BOOKED"
    );

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
    }).catch((err) => logger.error({ err }, "[pipeline.service] Audit log failed"));

    return { advanced: true, newStage: "MEETING_BOOKED", previousStage };
}

// ─── Stats ─────────────────────────────────────────────────────────────────────

/**
 * Returns a full pipeline funnel for a campaign.
 * Used by the dashboard and the hackathon submission report.
 */
export async function getPipelineStats(campaignId: string): Promise<PipelineStats> {
    const rows = await prisma.lead.groupBy({
        by: ["pipelineStage"],
        where: { campaignId, deletedAt: null },
        _count: { id: true },
    });

    const funnel: PipelineFunnel = {
        PROSPECT: 0,
        ENGAGED: 0,
        HOT: 0,
        MEETING_BOOKED: 0,
        DISQUALIFIED: 0,
    };

    for (const row of rows) {
        funnel[row.pipelineStage] = row._count.id;
    }

    const totalLeads = Object.values(funnel).reduce((a, b) => a + b, 0);
    const hotAndAbove = funnel.HOT + funnel.MEETING_BOOKED;
    const anythingBeyondProspect =
        funnel.ENGAGED + funnel.HOT + funnel.MEETING_BOOKED + funnel.DISQUALIFIED;

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

/**
 * Returns pipeline stats across all campaigns for a user.
 * Used by the top-level dashboard summary.
 */
export async function getPipelineStatsForUser(userId: string): Promise<PipelineStats> {
    const rows = await prisma.lead.groupBy({
        by: ["pipelineStage"],
        where: {
            campaign: { createdById: userId },
            deletedAt: null,
        },
        _count: { id: true },
    });

    const funnel: PipelineFunnel = {
        PROSPECT: 0,
        ENGAGED: 0,
        HOT: 0,
        MEETING_BOOKED: 0,
        DISQUALIFIED: 0,
    };

    for (const row of rows) {
        funnel[row.pipelineStage] = row._count.id;
    }

    const totalLeads = Object.values(funnel).reduce((a, b) => a + b, 0);
    const hotAndAbove = funnel.HOT + funnel.MEETING_BOOKED;
    const anythingBeyondProspect =
        funnel.ENGAGED + funnel.HOT + funnel.MEETING_BOOKED + funnel.DISQUALIFIED;

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