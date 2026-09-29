import { SignalType } from "@prisma/client";
import { leadSignalQueue } from "./campaign.queue";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { runLeadScoringAgent } from "./lead-scoring.agent";

const HIGH_VALUE_SIGNAL_TYPES = new Set([
    "FUNDING",
    "HIRING",
    "INTENT",
    "TECH_ADOPTION",
    "LEADERSHIP_CHANGE",
    "EXPANSION",
]);

const SIGNAL_COOLDOWN_MS = 6 * 60 * 60_000;
const SINGLE_SIGNAL_CONFIDENCE_THRESHOLD = 0.80;
const CORROBORATED_SIGNAL_CONFIDENCE_THRESHOLD = 0.60;
const NON_OUTREACH_PIPELINE_STAGES = new Set([
    "ENGAGED",
    "HOT",
    "MEETING_BOOKED",
    "DISQUALIFIED",
]);

interface IngestSignalParams {
    leadId: string;
    signalType: string;
    value: string;
    confidence: number;
    source?: string;
}

/**
 * Called whenever a new LeadSignal is persisted.
 * Evaluates signal priority and triggers immediate pipeline acceleration if warranted.
 */
export async function ingestLeadSignal(params: IngestSignalParams): Promise<void> {
    const { leadId, signalType, confidence } = params;

    if (!HIGH_VALUE_SIGNAL_TYPES.has(signalType)) {
        return;
    }

    if (confidence < CORROBORATED_SIGNAL_CONFIDENCE_THRESHOLD) {
        logger.debug(
            { leadId, signalType, confidence },
            "[signal-ingestion.agent] Low confidence signal skipped"
        );
        return;
    }

    const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        select: {
            id: true,
            campaignId: true,
            email: true,
            pipelineStage: true,
            recommendedAction: true,
            campaign: {
                select: {
                    id: true,
                    status: true,
                    icpDescription: true,
                },
            },
            outreachMessages: {
                where: {
                    deliveryState: { in: ["QUEUED", "SENDING", "SENT"] },
                },
                select: { id: true },
                take: 1,
            },
            signals: {
                where: {
                    signalType: { in: Array.from(HIGH_VALUE_SIGNAL_TYPES) as SignalType[] },
                    createdAt: { gte: new Date(Date.now() - 48 * 60 * 60_000) },
                },
                select: { signalType: true, confidence: true },
            },
        },
    });

    if (!lead) {
        logger.warn({ leadId }, "[signal-ingestion.agent] Lead not found");
        return;
    }

    if (NON_OUTREACH_PIPELINE_STAGES.has(lead.pipelineStage) || lead.recommendedAction === "DISQUALIFY") {
        logger.debug(
            { leadId, signalType, pipelineStage: lead.pipelineStage },
            "[signal-ingestion.agent] Lead in non-outreach stage — skipping acceleration"
        );
        return;
    }

    if (lead.outreachMessages.length > 0) {
        logger.debug(
            { leadId, signalType },
            "[signal-ingestion.agent] Lead already has outreach — skipping acceleration"
        );
        return;
    }

    const existingCorroboratingSignals = lead.signals.filter(
        (s) => s.signalType !== signalType && s.confidence >= CORROBORATED_SIGNAL_CONFIDENCE_THRESHOLD
    );
    const isCorroborated = existingCorroboratingSignals.length > 0;

    if (confidence < SINGLE_SIGNAL_CONFIDENCE_THRESHOLD && !isCorroborated) {
        logger.debug(
            { leadId, signalType, confidence, existingSignals: existingCorroboratingSignals.length },
            "[signal-ingestion.agent] Single unverified signal below threshold — corroboration required"
        );
        return;
    }

    const campaignId = lead.campaignId;
    if (!campaignId) {
        return;
    }

    const campaignStatus = lead.campaign?.status;
    if (!campaignStatus || ["COMPLETED", "FAILED", "DELETED"].includes(campaignStatus)) {
        return;
    }

    if (lead.campaign?.icpDescription) {
        await runLeadScoringAgent(leadId, lead.campaign.icpDescription, true).catch((err) =>
            logger.warn({ err, leadId, signalType }, "[signal-ingestion.agent] Event-driven lead rescore failed")
        );
    }


    const recentAcceleration = await prisma.queueJob.findFirst({
        where: {
            campaignId,
            jobType: "SIGNAL_ACCELERATE",
            status: { in: ["WAITING", "ACTIVE", "COMPLETED"] },
            createdAt: { gte: new Date(Date.now() - SIGNAL_COOLDOWN_MS) },
            payload: {
                path: ["leadId"],
                equals: leadId,
            },
        },
        select: { id: true },
    });

    if (recentAcceleration) {
        logger.debug(
            { leadId, signalType },
            "[signal-ingestion.agent] Cooldown active — acceleration already queued"
        );
        return;
    }

    const jobId = `signal-accelerate-${leadId}-${signalType}-${Date.now()}`;

    await leadSignalQueue.add(
        "signal-accelerate-lead",
        {
            leadId,
            campaignId,
            signalType,
            confidence: params.confidence,
            source: params.source ?? "unknown",
        },
        {
            jobId,
            priority: 1,
            attempts: 3,
            backoff: { type: "exponential", delay: 5_000 },
            removeOnComplete: { age: 3600 },
            removeOnFail: { age: 86400 },
        }
    );


    await prisma.queueJob.create({
        data: {
            queueName: "lead:signal-accelerate",
            jobType: "SIGNAL_ACCELERATE",
            status: "WAITING",
            campaignId,
            payload: {
                leadId,
                signalType,
                confidence: params.confidence,
                triggeredAt: new Date().toISOString(),
                bullJobId: jobId,
            },
        },
    }).catch((err) =>
        logger.warn({ err, leadId }, "[signal-ingestion.agent] Non-fatal: QueueJob record failed")
    );

    logger.info(
        { leadId, campaignId, signalType, confidence, jobId },
        "[signal-ingestion.agent] ✅ High-value signal detected — lead pipeline accelerated"
    );
}


export async function ingestSignalBatch(signals: IngestSignalParams[]): Promise<void> {
    const highValue = signals.filter(
        (s) => HIGH_VALUE_SIGNAL_TYPES.has(s.signalType) && s.confidence >= 0.6
    );

    if (highValue.length === 0) return;

    logger.info(
        { total: signals.length, highValue: highValue.length },
        "[signal-ingestion.agent] Batch ingestion started"
    );

    const BATCH = 10;
    for (let i = 0; i < highValue.length; i += BATCH) {
        await Promise.allSettled(
            highValue.slice(i, i + BATCH).map((s) =>
                ingestLeadSignal(s).catch((err) =>
                    logger.error(
                        { err, leadId: s.leadId, signalType: s.signalType },
                        "[signal-ingestion.agent] Failed to ingest signal"
                    )
                )
            )
        );
    }
}
