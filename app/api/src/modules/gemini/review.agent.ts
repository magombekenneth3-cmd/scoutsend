import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { LEARNING_EVENT_TYPES, LEARNING_OUTCOMES } from "../../lib/constants";
import { runQualityAgent, computeHeuristicQualityScore } from "./quality.agent";
import { runComplianceAgent, auditMessage } from "./compliance.agent";
import { sendQueue } from "./campaign.queue";
import { redis } from "../../lib/ioredis";
import { logger } from "../../lib/logger";
import pLimit from "p-limit";
import {
    callGeminiWithTools,
    GeminiPipelineError,
    MODELS,
    SchemaType,
    type ToolDefinition,
} from "./gemini.client";
import { getQualityThresholds, type QualityThresholds } from "./thresholds";

const EVALUATE_EMAIL_TOOL: ToolDefinition = {
    declaration: {
        name: "returnEvaluationResult",
        description: "Grade the cold outreach message quality.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                spamRiskScore: {
                    type: SchemaType.NUMBER,
                    description: "Spam risk 0.0–1.0 (lower is better)",
                },
                personalizationScore: {
                    type: SchemaType.NUMBER,
                    description: "Personalisation depth 0.0–1.0 (higher is better)",
                },
            },
            required: ["spamRiskScore", "personalizationScore"],
        },
    },
    handler: async (args) => args,
};

const EVAL_CONCURRENCY = 5;
const EVAL_TIMEOUT_MS = 20_000;
const REVIEW_LOCK_TTL_MS = 5 * 60 * 1000;
const LOCK_HEARTBEAT_INTERVAL_MS = 30_000;

type EvalStatus = "OK" | "TIMEOUT" | "BLOCKED" | "FAILED";

interface EvaluationResult {
    status: EvalStatus;
    spamRiskScore: number | null;
    personalizationScore: number | null;
    rawHeuristicPersonalization: number | null;
}

export interface RejectionReason {
    leadId: string;
    spamRiskScore: number;
    personalizationScore: number;
    reasons: string[];
}

export interface ReviewSummary {
    total: number;
    autoApproved: number;
    sentToQualityAgent: number;
    heldForReview: number;
    generationFailed: number;
    evalTimedOut: number;
    complianceBlocked: number;
    rejectionMap: Record<string, RejectionReason>;
}

interface ReviewOptions {
    followUpPass?: boolean;
}

type MessageVerdict = "AUTO_APPROVE" | "QUALITY_AGENT" | "GENERATION_FAILED" | "EVAL_TIMEOUT" | "GEMINI_BLOCKED";

function clampScore(value: number): number {
    return Math.min(1, Math.max(0, value));
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: NodeJS.Timeout;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`Evaluation timed out after ${ms}ms`)), ms);
            }),
        ]);
    } finally {
        clearTimeout(timer!);
    }
}

const HEURISTIC_WEIGHT = 0.3;
const LLM_WEIGHT = 1 - HEURISTIC_WEIGHT;

async function evaluateMessage(params: {
    subject: string;
    body: string;
    leadContext: string;
    messageId: string;
    campaignId: string;
}): Promise<{ spamRiskScore: number; personalizationScore: number; rawHeuristicPersonalization: number }> {
    const { subject, body, leadContext, messageId, campaignId } = params;

    const heuristic = computeHeuristicQualityScore(subject, body, leadContext);

    const { result } = await callGeminiWithTools<{ spamRiskScore: number; personalizationScore: number }>({
        agentName: "review.evaluator",
        model: MODELS.REVIEW,
        systemPrompt:
            "You are a B2B sales email quality auditor. Grade the cold outreach email.\n\n" +
            "Scoring rules:\n" +
            "- spamRiskScore (0.0–1.0, lower is better): increases with generic openings, pushy CTAs, or trigger phrases\n" +
            "- personalizationScore (0.0–1.0, higher is better): increases when the email references specific company signals, role context, or industry insight",
        userPrompt: `RECIPIENT CONTEXT:\n${leadContext}\n\nSUBJECT:\n${subject}\n\nBODY:\n${body}`,
        tools: [EVALUATE_EMAIL_TOOL],
        metadata: { messageId, campaignId },
        temperature: 0.1,
    });

    const llmSpam = clampScore(result.spamRiskScore);
    const llmPerson = clampScore(result.personalizationScore);

    return {
        spamRiskScore: clampScore(HEURISTIC_WEIGHT * heuristic.spamRiskScore + LLM_WEIGHT * llmSpam),
        personalizationScore: clampScore(HEURISTIC_WEIGHT * heuristic.personalizationScore + LLM_WEIGHT * llmPerson),
        rawHeuristicPersonalization: heuristic.personalizationScore,
    };
}

function classifyMessage(
    evalStatus: EvalStatus,
    spamRiskScore: number | null,
    personalizationScore: number | null,
    thresholds: QualityThresholds,
    rawHeuristicPersonalization: number | null,
): MessageVerdict {
    if (evalStatus === "BLOCKED") return "GEMINI_BLOCKED";
    if (evalStatus === "TIMEOUT") return "EVAL_TIMEOUT";
    if (evalStatus === "FAILED" || spamRiskScore == null || personalizationScore == null) return "GENERATION_FAILED";
    if (rawHeuristicPersonalization !== null && rawHeuristicPersonalization < 0.3) return "QUALITY_AGENT";
    if (spamRiskScore < thresholds.spamRiskMax && personalizationScore >= thresholds.personalizationMin) {
        return "AUTO_APPROVE";
    }
    return "QUALITY_AGENT";
}

function buildRejectionReasons(
    spamRiskScore: number | null,
    personalizationScore: number | null,
    thresholds: QualityThresholds,
    enrichmentData?: Record<string, unknown> | null,
): string[] {
    if (spamRiskScore == null || personalizationScore == null) {
        return ["scoring_failed"];
    }

    const complianceViolations = Array.isArray(enrichmentData?.complianceViolations)
        ? (enrichmentData!.complianceViolations as string[])
        : [];
    if (complianceViolations.length > 0) {
        return complianceViolations.map(v => `compliance:${v}`);
    }

    const reasons: string[] = [];
    if (spamRiskScore >= thresholds.spamRiskMax) {
        reasons.push(`spam_too_high:${spamRiskScore.toFixed(2)}`);
    }
    if (personalizationScore < thresholds.personalizationMin) {
        reasons.push(`personalization_too_low:${personalizationScore.toFixed(2)}`);
    }
    return reasons.length > 0 ? reasons : ["quality_thresholds_not_met"];
}

export async function runReviewAgent(
    campaignId: string,
    options: ReviewOptions = {},
): Promise<ReviewSummary> {
    const { followUpPass = false } = options;

    const lockKey = `review-lock:${campaignId}`;
    const acquired = await redis.set(lockKey, "1", "PX", REVIEW_LOCK_TTL_MS, "NX");
    if (acquired !== "OK") {
        throw new Error(`Review agent already running for campaign ${campaignId}`);
    }

    const abort = new AbortController();

    const heartbeat = setInterval(async () => {
        try {
            const refreshed = await redis.set(lockKey, "1", "PX", REVIEW_LOCK_TTL_MS, "XX");
            if (refreshed !== "OK") {
                logger.error({ campaignId }, "[review.agent] Lock evicted from Redis mid-review — aborting run");
                abort.abort();
            }
        } catch (err) {
            logger.warn({ err, campaignId }, "[review.agent] Lock heartbeat error — Redis unreachable, not aborting");
        }
    }, LOCK_HEARTBEAT_INTERVAL_MS);

    try {
        return await _runReviewAgent(campaignId, followUpPass, abort.signal);
    } finally {
        clearInterval(heartbeat);
        await redis.del(lockKey);
    }
}

async function _runReviewAgent(
    campaignId: string,
    followUpPass: boolean,
    abortSignal: AbortSignal,
): Promise<ReviewSummary> {
    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { id: true, status: true, createdById: true },
    });

    if (!campaign) throw new Error("Campaign not found");

    const thresholds = await getQualityThresholds(campaignId);

    const brandSettings = await prisma.brandSettings.findUnique({
        where: { userId: campaign.createdById },
        select: { unsubscribeText: true },
    });
    const unsubscribeFooter = brandSettings?.unsubscribeText ?? "You received this email because you match our ideal customer profile. To unsubscribe, reply with 'unsubscribe'.";

    const messages = await prisma.outreachMessage.findMany({
        where: {
            lead: { campaignId },
            approvalStatus: "PENDING",
            deliveryState: "DRAFT",
        },
        select: {
            id: true,
            subject: true,
            body: true,
            leadId: true,
            spamRiskScore: true,
            personalizationScore: true,
            enrichmentData: true,
            lead: {
                select: {
                    firstName: true,
                    lastName: true,
                    title: true,
                    companyName: true,
                    website: true,
                    qualificationReason: true,
                    signals: { orderBy: { confidence: "desc" }, take: 3 },
                    enrichmentData: true,
                },
            },
        },
    });

    const evalResultMap = new Map<string, EvaluationResult>();
    const evalLimit = pLimit(EVAL_CONCURRENCY);

    await Promise.allSettled(
        messages.map(message =>
            evalLimit(async () => {
                if (message.spamRiskScore !== null && message.personalizationScore !== null) {
                    return;
                }

                const lead = message.lead;
                if (!lead) return;

                const signalSummary =
                    lead.signals.length > 0
                        ? lead.signals
                            .map((s: { signalType: string; value: string; explanation: string | null }) => `- ${s.signalType}: ${s.value}${s.explanation ? ` (${s.explanation})` : ""}`)
                            .join("\n")
                        : "N/A";

                const leadContext = [
                    `Name: ${[lead.firstName, lead.lastName].filter(Boolean).join(" ") || "unknown"}`,
                    `Title: ${lead.title ?? "unknown"}`,
                    `Company: ${lead.companyName}`,
                    `Website: ${lead.website ?? "unknown"}`,
                    `Reason: ${lead.qualificationReason ?? "N/A"}`,
                    `Signals:\n${signalSummary}`,
                ].join("\n");

                try {
                    if (abortSignal.aborted) {
                        throw new Error("Review run aborted: lock evicted");
                    }
                    const result = await withTimeout(
                        evaluateMessage({
                            subject: message.subject,
                            body: message.body,
                            leadContext,
                            messageId: message.id,
                            campaignId,
                        }),
                        EVAL_TIMEOUT_MS,
                    );

                    evalResultMap.set(message.id, {
                        status: "OK",
                        spamRiskScore: result.spamRiskScore,
                        personalizationScore: result.personalizationScore,
                        rawHeuristicPersonalization: result.rawHeuristicPersonalization,
                    });
                } catch (err) {
                    const isTimeout = err instanceof Error && err.message.startsWith("Evaluation timed out");
                    if (err instanceof GeminiPipelineError && err.blocked === true) {
                        logger.warn(
                            { messageId: message.id, gemini_blocked: err.reason },
                            "[review.evaluator] Gemini response blocked — skipping regen budget",
                        );
                        evalResultMap.set(message.id, { status: "BLOCKED", spamRiskScore: null, personalizationScore: null, rawHeuristicPersonalization: null });
                    } else if (isTimeout) {
                        logger.warn(
                            { messageId: message.id },
                            "[review.evaluator] Evaluation timed out — will retry without consuming regen budget",
                        );
                        evalResultMap.set(message.id, { status: "TIMEOUT", spamRiskScore: null, personalizationScore: null, rawHeuristicPersonalization: null });
                    } else {
                        logger.error(
                            { err, messageId: message.id },
                            "[review.evaluator] Evaluation failed",
                        );
                        evalResultMap.set(message.id, { status: "FAILED", spamRiskScore: null, personalizationScore: null, rawHeuristicPersonalization: null });
                    }
                }
            })
        )
    );

    let autoApproved = 0;
    let sentToQualityAgent = 0;
    let generationFailed = 0;
    let evalTimedOut = 0;

    type ApprovedRecord = {
        id: string;
        leadId: string;
        subject: string;
        body: string;
        spam: number;
        personalization: number;
    };

    type GenerationFailedRecord = {
        id: string;
        leadId: string;
    };

    const approvedRecords: ApprovedRecord[] = [];
    const generationFailedRecords: GenerationFailedRecord[] = [];
    const dbUpdates: Prisma.PrismaPromise<unknown>[] = [];

    for (const message of messages) {
        const evalResult = evalResultMap.get(message.id);
        const evalStatus: EvalStatus = evalResult
            ? evalResult.status
            : (message.spamRiskScore !== null ? "OK" : "FAILED");
        const spam = evalResult?.spamRiskScore ?? message.spamRiskScore;
        const person = evalResult?.personalizationScore ?? message.personalizationScore;
        const rawHeuristic = evalResult?.rawHeuristicPersonalization ?? null;

        const leadEd = (message.lead?.enrichmentData ?? {}) as Record<string, unknown>;
        const leadCountry =
            (leadEd.country as string | undefined) ??
            (leadEd.countryCode as string | undefined) ??
            null;
        const consentBasis = typeof leadEd.consentBasis === "string" ? leadEd.consentBasis : null;

        const violations = auditMessage(message.subject, message.body, leadCountry, consentBasis, unsubscribeFooter);
        const isComplianceBlocked = violations.some(v => v.severity === "block");
        const complianceWarnings = violations.filter(v => v.severity === "warn").map(v => v.code);
        const complianceViolations = violations.filter(v => v.severity === "block").map(v => v.code);

        const ed = (message.enrichmentData ?? {}) as Record<string, unknown>;
        const updatedEd = {
            ...ed,
            complianceViolations: complianceViolations.length > 0 ? complianceViolations : undefined,
            complianceWarnings: complianceWarnings.length > 0 ? complianceWarnings : undefined,
            ...(isComplianceBlocked && { complianceBlockedAt: new Date().toISOString() }),
        };

        if (!updatedEd.complianceViolations) delete updatedEd.complianceViolations;
        if (!updatedEd.complianceWarnings) delete updatedEd.complianceWarnings;
        if (!isComplianceBlocked) delete updatedEd.complianceBlockedAt;

        dbUpdates.push(
            prisma.outreachMessage.update({
                where: { id: message.id },
                data: {
                    spamRiskScore: spam,
                    personalizationScore: person,
                    enrichmentData: updatedEd as Prisma.InputJsonValue,
                },
            })
        );

        let verdict = classifyMessage(evalStatus, spam, person, thresholds, rawHeuristic);
        if (verdict === "AUTO_APPROVE" && isComplianceBlocked) {
            verdict = "QUALITY_AGENT";
        }

        if (verdict === "GEMINI_BLOCKED") {
            logger.warn({ messageId: message.id }, "[review.agent] Message blocked by Gemini — incrementing evalTimedOut");
            evalTimedOut++;
        } else if (verdict === "EVAL_TIMEOUT") {
            evalTimedOut++;
        } else if (verdict === "GENERATION_FAILED") {
            generationFailed++;
            generationFailedRecords.push({ id: message.id, leadId: message.leadId });
        } else if (verdict === "AUTO_APPROVE") {
            approvedRecords.push({
                id: message.id,
                leadId: message.leadId,
                subject: message.subject,
                body: message.body,
                spam: spam!,
                personalization: person!,
            });
            autoApproved++;
        } else {
            sentToQualityAgent++;
        }
    }

    if (abortSignal.aborted) {
        throw new Error("Review aborted: lock lost before commit — no writes performed");
    }

    if (dbUpdates.length > 0) {
        await prisma.$transaction(dbUpdates);
    }

    if (generationFailedRecords.length > 0) {
        logger.warn(
            { campaignId, count: generationFailedRecords.length },
            "[review.agent] Messages failed eval — queued for regeneration",
        );
    }

    if (approvedRecords.length > 0) {
        const approvedIds = approvedRecords.map(r => r.id);

        await prisma.$transaction(async tx => {
            await tx.outreachMessage.updateMany({
                where: { id: { in: approvedIds } },
                data: { approvalStatus: "APPROVED", deliveryState: "QUEUED" },
            });

            await tx.learningEvent.createMany({
                data: approvedRecords.map(r => ({
                    eventType: LEARNING_EVENT_TYPES.AUTO_APPROVED,
                    originalOutput: JSON.stringify({ subject: r.subject, body: r.body }),
                    modifiedOutput: "",
                    outcome: LEARNING_OUTCOMES.APPROVED,
                    outreachMessageId: r.id,
                    metadata: {
                        spamRiskScore: r.spam,
                        personalizationScore: r.personalization,
                    } as Prisma.InputJsonValue,
                })),
            });
        });
    }

    let qualitySummary = { rewritten: 0, heldForReview: 0 };

    if (sentToQualityAgent > 0) {
        qualitySummary = await runQualityAgent(campaignId);
    }

    const complianceSummary = await runComplianceAgent(campaignId);

    const hasPendingReview = qualitySummary.heldForReview > 0 || complianceSummary.blocked > 0;

    const stillHeld = await prisma.outreachMessage.findMany({
        where: {
            lead: { campaignId },
            approvalStatus: "PENDING",
            deliveryState: "DRAFT",
            spamRiskScore: { not: null },
            personalizationScore: { not: null },
        },
        select: {
            leadId: true,
            spamRiskScore: true,
            personalizationScore: true,
            enrichmentData: true,
        },
    });

    const rejectionMap: Record<string, RejectionReason> = {};

    for (const rec of generationFailedRecords) {
        rejectionMap[rec.leadId] = {
            leadId: rec.leadId,
            spamRiskScore: 0,
            personalizationScore: 0,
            reasons: ["scoring_failed"],
        };
    }

    for (const msg of stillHeld) {
        const ed = (msg.enrichmentData ?? {}) as Record<string, unknown>;
        rejectionMap[msg.leadId] = {
            leadId: msg.leadId,
            spamRiskScore: msg.spamRiskScore ?? 0,
            personalizationScore: msg.personalizationScore ?? 0,
            reasons: buildRejectionReasons(msg.spamRiskScore, msg.personalizationScore, thresholds, ed),
        };
    }

    if (followUpPass) {
        if (autoApproved > 0) {
            const jobId = `send-batch-${campaignId}`;
            const existingJob = await sendQueue.getJob(jobId);
            if (!existingJob) {
                await sendQueue.add(
                    "send-batch",
                    { campaignId },
                    {
                        jobId,
                        removeOnComplete: { age: 300 },
                        removeOnFail: { age: 3600 },
                    }
                );
            }
        }

        logger.info(
            {
                campaignId,
                autoApproved,
                heldForReview: qualitySummary.heldForReview,
                complianceBlocked: complianceSummary.blocked,
            },
            "[review.agent] Follow-up pass complete",
        );
    } else {
        await prisma.campaign.update({
            where: { id: campaignId },
            data: { status: hasPendingReview ? "REVIEW" : "QUEUED" },
        });
    }

    return {
        total: messages.length,
        autoApproved,
        sentToQualityAgent,
        heldForReview: qualitySummary.heldForReview,
        generationFailed,
        evalTimedOut,
        complianceBlocked: complianceSummary.blocked,
        rejectionMap,
    };
}