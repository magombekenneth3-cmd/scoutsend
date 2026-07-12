/**
 * signal-ingestion.agent.ts
 *
 * Pillar B: Real-Time Signal-Based Triggering
 *
 * When a high-value signal fires for a lead (FUNDING, HIRING, INTENT, TECH_ADOPTION),
 * immediately enqueue an accelerated research → generate pipeline for that lead.
 * This bypasses the nightly batch scheduler so outreach reaches prospects while
 * the buying signal is still hot — typically within minutes of detection.
 */

import { leadSignalQueue } from "./campaign.queue";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";

/** Signal types that warrant immediate outreach acceleration */
const HIGH_VALUE_SIGNAL_TYPES = new Set([
    "FUNDING",
    "HIRING",
    "INTENT",
    "TECH_ADOPTION",
    "LEADERSHIP_CHANGE",
    "EXPANSION",
]);

const SIGNAL_COOLDOWN_MS = 6 * 60 * 60_000; // 6 hours — prevent duplicate triggers per lead

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
        return; // Low-priority signal — let the nightly batch handle it
    }

    if (confidence < 0.6) {
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
        },
    });

    if (!lead) {
        logger.warn({ leadId }, "[signal-ingestion.agent] Lead not found");
        return;
    }

    // Skip leads that already have outreach in flight
    if (lead.outreachMessages.length > 0) {
        logger.debug(
            { leadId, signalType },
            "[signal-ingestion.agent] Lead already has outreach — skipping acceleration"
        );
        return;
    }

    // Skip disqualified or opted-out leads
    if (lead.pipelineStage === "DISQUALIFIED" || lead.recommendedAction === "DISQUALIFY") {
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

    // Cooldown check: avoid re-triggering if we already fired an acceleration for this lead recently
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
            priority: 1, // Highest priority — ahead of batch jobs
            attempts: 3,
            backoff: { type: "exponential", delay: 5_000 },
            removeOnComplete: { age: 3600 },
            removeOnFail: { age: 86400 },
        }
    );

    // Record in QueueJob for cooldown tracking and observability
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

/**
 * Batch-ingest signals for multiple leads (e.g. after a discovery run).
 * Processes concurrently with a cap to avoid overwhelming the queue.
 */
export async function ingestSignalBatch(signals: IngestSignalParams[]): Promise<void> {
    const highValue = signals.filter(
        (s) => HIGH_VALUE_SIGNAL_TYPES.has(s.signalType) && s.confidence >= 0.6
    );

    if (highValue.length === 0) return;

    logger.info(
        { total: signals.length, highValue: highValue.length },
        "[signal-ingestion.agent] Batch ingestion started"
    );

    // Process in batches of 10 to avoid DB connection exhaustion
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
