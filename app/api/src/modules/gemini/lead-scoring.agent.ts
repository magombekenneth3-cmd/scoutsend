import { Prisma } from "@prisma/client";
import pLimit from "p-limit";
import { prisma } from "../../lib/prisma";
import { z } from "zod";
import { callGateway } from "../../lib/llm-gateway";
import {
    callGeminiWithTools,
    MODELS,
    SchemaType,
    ToolDefinition,
} from "./gemini.client";
import { logger } from "../../lib/logger";
import { enqueueEmailRevealForQualifiedLeads } from "./email-enrichment.queue";
import { logLeadJourneyEvent } from "../../lib/leads/lead-journey.service";

export interface BreakdownScores {
    icpMatch: number;
    intentStrength: number;
    fundingSignals: number;
    hiringVelocity: number;
    techFit: number;
    recency: number;
    personEnrichmentHit?: boolean;
    confidenceScore?: number;
}

export interface ScoringResult {
    qualificationScore: number;
    qualificationReason: string;
    breakdownScores: BreakdownScores;
    evidenceTriggers: string[];
    recommendedAction:
    | "HIGH_PRIORITY"
    | "STANDARD"
    | "NURTURE"
    | "DISQUALIFY";
}

interface ScoringWeights {
    icpMatch: number;
    intentStrength: number;
    fundingSignals: number;
    hiringVelocity: number;
    techFit: number;
    recency: number;
}

function buildScoringSystemPrompt(weights: ScoringWeights): string {
    const pct = (v: number) => `${Math.round(v * 100)}%`;

    return `You are an expert B2B lead scoring engine. Score a lead across six dimensions by returning breakdownScores (0–100 each), evidenceTriggers, and qualificationReason.
You must always call the returnBatchResult tool to return the result. Do not return plain conversational text or explain your thought process in conversational text.

These weights determine how your breakdownScores combine into the lead's overall weighted score. We compute that weighted score — and the resulting recommended action — from your breakdownScores ourselves:
  icpMatch        → ${pct(weights.icpMatch)}
  intentStrength  → ${pct(weights.intentStrength)}
  fundingSignals  → ${pct(weights.fundingSignals)}
  hiringVelocity  → ${pct(weights.hiringVelocity)}
  techFit         → ${pct(weights.techFit)}
  recency         → ${pct(weights.recency)}

Score each dimension independently and honestly on its own 0–100 scale; don't shade individual dimensions to try to steer the overall outcome.`;
}

const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
    icpMatch: 0.25,
    intentStrength: 0.3,
    fundingSignals: 0.15,
    hiringVelocity: 0.15,
    techFit: 0.1,
    recency: 0.05,
};

export const LEAD_SCORING_SYSTEM_PROMPT = buildScoringSystemPrompt(
    DEFAULT_SCORING_WEIGHTS,
);

export const QUALIFICATION_THRESHOLD = 0.4;

const WEIGHT_SUM_TOLERANCE = 0.001;

const BREAKDOWN_SCORE_KEYS: (keyof BreakdownScores)[] = [
    "icpMatch",
    "intentStrength",
    "fundingSignals",
    "hiringVelocity",
    "techFit",
    "recency",
];

const MAX_LEAD_SIGNALS = 15;
const MAX_COMPANY_SIGNALS = 10;
const MAX_SIGNAL_VALUE_CHARS = 500;
const MAX_SIGNAL_EXPLANATION_CHARS = 1000;
const MAX_ENRICHMENT_JSON_CHARS = 3000;
const MAX_EVIDENCE_TRIGGERS = 5;
const MAX_REASON_CHARS = 2000;

const GEMINI_BATCH_SIZE = 10;
const BULK_BATCH_SIZE = 50;
const BULK_CONCURRENCY = 1;
const BULK_INTER_CHUNK_DELAY_MS = 1500;

const SCORE_RETRY_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 2000;
const MAX_RETRY_DELAY_MS = 120000;

const SCORE_TIMEOUT_MS = 60000;
const SCORE_TIMEOUT_PER_LEAD_MS = 8000;

const TRANSACTION_RETRY_ATTEMPTS = 3;
const TRANSACTION_RETRY_DELAY_MS = 300;
const UPDATE_FALLBACK_CONCURRENCY = 10;

const CAMPAIGN_THRESHOLD_CACHE_TTL_MS = 60000;
const CAMPAIGN_THRESHOLD_CACHE_MAX_SIZE = 500;

if (BULK_CONCURRENCY !== 1) {
    throw new Error(
        "BULK_CONCURRENCY must stay 1 unless the inter-chunk rate limiter is made concurrency-safe.",
    );
}

interface NormalisedSignal {
    type: string;
    value: string;
    confidence: number;
    explanation: string | null;
}

interface PendingLeadUpdate {
    leadId: string;
    qualifies: boolean;
    expectedUpdatedAt: Date;
    data: {
        qualificationScore: number;
        qualificationReason: string;
        breakdownScores: Prisma.InputJsonValue;
        evidenceTriggers: Prisma.InputJsonValue;
        recommendedAction: ScoringResult["recommendedAction"];
    };
}

interface BatchScoringOutcome {
    results: Record<string, boolean>;
    unscoredLeadIds: string[];
}

function clampScore(value: unknown): number {
    const raw = typeof value === "number" ? value : NaN;

    if (Number.isNaN(raw)) {
        return 0;
    }

    return Math.min(100, Math.max(0, Math.round(raw)));
}

function resolveThreshold(raw: unknown): number {
    return typeof raw === "number" &&
        Number.isFinite(raw) &&
        raw >= 0 &&
        raw <= 1
        ? raw
        : QUALIFICATION_THRESHOLD;
}

function validateWeights(weights: ScoringWeights): ScoringWeights {
    const total =
        weights.icpMatch +
        weights.intentStrength +
        weights.fundingSignals +
        weights.hiringVelocity +
        weights.techFit +
        weights.recency;

    if (Math.abs(total - 1) > WEIGHT_SUM_TOLERANCE) {
        throw new Error(`Scoring weights must sum to 1. Got ${total}`);
    }

    return weights;
}

const campaignThresholdCache = new Map<
    string,
    { value: number; expiresAt: number }
>();

function pruneCampaignThresholdCache(now: number): void {
    if (campaignThresholdCache.size < CAMPAIGN_THRESHOLD_CACHE_MAX_SIZE) {
        return;
    }

    for (const [key, entry] of campaignThresholdCache) {
        if (entry.expiresAt <= now) {
            campaignThresholdCache.delete(key);
        }
    }

    while (campaignThresholdCache.size >= CAMPAIGN_THRESHOLD_CACHE_MAX_SIZE) {
        const oldestKey = campaignThresholdCache.keys().next().value;

        if (oldestKey === undefined) {
            break;
        }

        campaignThresholdCache.delete(oldestKey);
    }
}

async function getCampaignQualificationThreshold(
    campaignId: string,
): Promise<number> {
    const now = Date.now();
    const cached = campaignThresholdCache.get(campaignId);

    if (cached && cached.expiresAt > now) {
        return cached.value;
    }

    const campaign = await prisma.campaign.findUnique({
        where: {
            id: campaignId,
        },
        select: {
            qualificationThreshold: true,
        },
    });

    const value = resolveThreshold(campaign?.qualificationThreshold);

    pruneCampaignThresholdCache(now);

    campaignThresholdCache.set(campaignId, {
        value,
        expiresAt: now + CAMPAIGN_THRESHOLD_CACHE_TTL_MS,
    });

    return value;
}

function truncateText(text: string, maxChars: number): string {
    return text.length > maxChars
        ? `${text.slice(0, maxChars)}…`
        : text;
}

function truncateJsonForPrompt(
    value: Record<string, unknown>,
    maxChars: number,
): string {
    const json = JSON.stringify(value, null, 2);

    if (json.length <= maxChars) {
        return json;
    }

    return `${json.slice(0, maxChars)}\n... [truncated ${json.length - maxChars
        } more characters]`;
}

function validateBreakdownScores(raw: unknown): BreakdownScores {
    const fallback: BreakdownScores = {
        icpMatch: 0,
        intentStrength: 0,
        fundingSignals: 0,
        hiringVelocity: 0,
        techFit: 0,
        recency: 0,
    };

    if (!raw || typeof raw !== "object") {
        return fallback;
    }

    const record = raw as Record<string, unknown>;

    const overallScore =
        typeof record["qualificationScore"] === "number" &&
            Number.isFinite(record["qualificationScore"])
            ? Math.min(100, Math.max(0, Math.round(record["qualificationScore"] * 100)))
            : null;

    return BREAKDOWN_SCORE_KEYS.reduce((acc, key) => {
        const raw = record[key];
        const isValid = typeof raw === "number" && Number.isFinite(raw);
        (acc as any)[key] = isValid ? clampScore(raw) : (overallScore ?? 0);
        return acc;
    }, {} as BreakdownScores);
}

function computeQualificationScore(
    breakdownScores: BreakdownScores,
    weights: ScoringWeights,
): number {
    const weighted =
        breakdownScores.icpMatch * weights.icpMatch +
        breakdownScores.intentStrength * weights.intentStrength +
        breakdownScores.fundingSignals * weights.fundingSignals +
        breakdownScores.hiringVelocity * weights.hiringVelocity +
        breakdownScores.techFit * weights.techFit +
        breakdownScores.recency * weights.recency;

    return clampScore(weighted);
}

function computeRecommendedAction(
    score: number,
): ScoringResult["recommendedAction"] {
    if (score >= 70) {
        return "HIGH_PRIORITY";
    }

    if (score >= 45) {
        return "STANDARD";
    }

    if (score >= 25) {
        return "NURTURE";
    }

    return "DISQUALIFY";
}

function validateScoringResult(
    raw: unknown,
    weights: ScoringWeights,
    sourceLead?: any,
): ScoringResult {
    if (!raw || typeof raw !== "object") {
        throw new Error("Scoring result is not an object");
    }

    const record = raw as Record<string, unknown>;

    const breakdownScores = validateBreakdownScores(
        record.breakdownScores,
    );

    const hasPersonEnrichment = Boolean(
        sourceLead &&
        (
            (sourceLead.enrichmentData && (sourceLead.enrichmentData as any).person) ||
            sourceLead.title ||
            sourceLead.seniority ||
            sourceLead.linkedinUrl
        )
    );

    const confidenceScore = hasPersonEnrichment ? 0.95 : 0.65;
    breakdownScores.personEnrichmentHit = hasPersonEnrichment;
    breakdownScores.confidenceScore = confidenceScore;

    const rawQualificationScore = computeQualificationScore(
        breakdownScores,
        weights,
    );

    const qualificationScore = Math.round(rawQualificationScore * confidenceScore);

    const recommendedAction =
        computeRecommendedAction(qualificationScore);

    const qualificationReason =
        typeof record.qualificationReason === "string"
            ? record.qualificationReason
            : "No reason provided";

    const evidenceTriggers = Array.isArray(record.evidenceTriggers)
        ? record.evidenceTriggers.filter(
            (trigger): trigger is string =>
                typeof trigger === "string",
        )
        : [];

    return {
        qualificationScore,
        qualificationReason,
        breakdownScores,
        evidenceTriggers,
        recommendedAction,
    };
}

function buildReasonWithTriggers(
    score: number,
    reason: string,
    triggers: string[],
): string {
    const cappedTriggers = triggers
        .slice(0, MAX_EVIDENCE_TRIGGERS)
        .map((trigger) => truncateText(trigger, 500));

    const combined = [
        `Score: ${score}/100.`,
        truncateText(reason, MAX_REASON_CHARS),
        cappedTriggers.length
            ? `Evidence: ${cappedTriggers.join(" | ")}`
            : null,
    ]
        .filter(Boolean)
        .join(" — ");

    return truncateText(combined, MAX_REASON_CHARS);
}

function mergeSignals(
    leadSignals: NormalisedSignal[],
    companySignals: NormalisedSignal[],
): NormalisedSignal[] {
    const seen = new Set<string>();
    const merged: NormalisedSignal[] = [];

    for (const signal of [...leadSignals, ...companySignals]) {
        const key = `${signal.type}:${signal.value
            .toLowerCase()
            .trim()}`;

        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        merged.push(signal);
    }

    return merged.sort(
        (a, b) => b.confidence - a.confidence,
    );
}

const RAW_SCRAPE_KEYS = new Set([
    "scrapedText",
    "description",
    "bodyText",
    "pageContent",
    "rawText",
    "homepageText",
    "websiteContent",
    "htmlContent",
]);

const MAX_SUMMARY_PROSE_CHARS = 300;

function condenseEnrichment(raw: Record<string, unknown>): Record<string, unknown> {
    const condensed: Record<string, unknown> = {};
    let proseParts: string[] = [];

    for (const [k, v] of Object.entries(raw)) {
        if (!RAW_SCRAPE_KEYS.has(k)) {
            condensed[k] = v;
            continue;
        }
        if (typeof v === "string" && v.trim().length > 0) {
            proseParts.push(v.trim());
        }
    }

    if (proseParts.length > 0) {
        const joined = proseParts.join(" ").replace(/\s+/g, " ");
        condensed["_pageSummary"] = truncateText(joined, MAX_SUMMARY_PROSE_CHARS);
    }

    return condensed;
}

function buildLeadPromptsText(leads: any[]): string {
    return leads
        .map((lead) => {
            const leadSignals: NormalisedSignal[] = (
                lead.signals ?? []
            ).map((signal: any) => ({
                type: String(signal.signalType ?? "unknown"),
                value: truncateText(
                    String(signal.value ?? ""),
                    MAX_SIGNAL_VALUE_CHARS,
                ),
                confidence:
                    typeof signal.confidence === "number"
                        ? signal.confidence
                        : 0,
                explanation: signal.explanation
                    ? truncateText(
                        String(signal.explanation),
                        MAX_SIGNAL_EXPLANATION_CHARS,
                    )
                    : null,
            }));

            const companySignals: NormalisedSignal[] = (
                lead.company?.signals ?? []
            ).map((signal: any) => ({
                type: String(signal.signalType ?? "unknown"),
                value: truncateText(
                    String(signal.value ?? ""),
                    MAX_SIGNAL_VALUE_CHARS,
                ),
                confidence:
                    typeof signal.confidence === "number"
                        ? signal.confidence
                        : 0,
                explanation: signal.explanation
                    ? truncateText(
                        String(signal.explanation),
                        MAX_SIGNAL_EXPLANATION_CHARS,
                    )
                    : null,
            }));

            const allSignals = mergeSignals(
                leadSignals,
                companySignals,
            );

            const companyEnrichment =
                lead.company?.enrichmentData &&
                    typeof lead.company.enrichmentData === "object"
                    ? (lead.company.enrichmentData as Record<
                        string,
                        unknown
                    >)
                    : {};

            const leadEnrichment =
                lead.enrichmentData &&
                    typeof lead.enrichmentData === "object"
                    ? (lead.enrichmentData as Record<
                        string,
                        unknown
                    >)
                    : {};

            const enrichmentData = condenseEnrichment({
                ...companyEnrichment,
                ...leadEnrichment,
            });

            const competitorTech = Array.isArray(
                lead.competitorTech,
            )
                ? lead.competitorTech
                    .filter(
                        (value: unknown): value is string =>
                            typeof value === "string",
                    )
                    .join(", ")
                : "";

            const competitorLine =
                lead.competitorSignal === true
                    ? `Competitor signal: YES — this prospect uses a competing product: ${competitorTech || "unknown"
                    }.\n`
                    : "";

            const signalSummary =
                allSignals.length > 0
                    ? allSignals
                        .map(
                            (signal) =>
                                `  • [${signal.type}] ${signal.value
                                } (conf: ${signal.confidence.toFixed(
                                    2,
                                )}) — ${signal.explanation ?? ""
                                }`,
                        )
                        .join("\n")
                    : "  None";

            return `---
Lead ID: ${lead.id}
Company: ${lead.companyName ?? "unknown"}
Website: ${lead.website ?? "unknown"}
Contact: ${[
                    lead.firstName,
                    lead.lastName,
                ]
                    .filter(Boolean)
                    .join(" ") || "unknown"} — ${lead.title ?? "unknown role"
                }
Source: ${lead.source ?? "unknown"}
${competitorLine}Signals:
${signalSummary}
Enrichment data:
${truncateJsonForPrompt(
                    enrichmentData,
                    MAX_ENRICHMENT_JSON_CHARS,
                )}`;
        })
        .join("\n\n");
}

function computeHeuristicScoreForLead(lead: any, _icpDescription: string): Record<string, unknown> {
    const title = (lead.title ?? "").toLowerCase();
    const isDecisionMaker = /ceo|founder|owner|president|vp|director|head|chief|partner|exec/i.test(title);
    const hasEmail = Boolean(lead.email && lead.email.includes("@"));
    const hasLinkedin = Boolean(lead.linkedinUrl);

    const icpMatch = isDecisionMaker ? 80 : 50;
    const intentStrength = (lead.signals?.length ?? 0) > 0 ? 70 : 40;
    const techFit = hasEmail ? 75 : 40;
    const hiringVelocity = hasLinkedin ? 70 : 50;
    const fundingSignals = 50;
    const recency = 60;

    const compositeScore = Math.round(
        icpMatch * 0.35 +
        intentStrength * 0.20 +
        techFit * 0.15 +
        hiringVelocity * 0.15 +
        fundingSignals * 0.10 +
        recency * 0.05
    );

    let recommendedAction = "NURTURE";
    if (compositeScore >= 70) recommendedAction = "HIGH_PRIORITY";
    else if (compositeScore >= 50) recommendedAction = "STANDARD";
    else if (!hasEmail && !hasLinkedin) recommendedAction = "DISQUALIFY";

    const evidenceTriggers = [
        isDecisionMaker ? "Decision maker title detected" : "Standard role",
        hasEmail ? "Verified email present" : "No email present",
        hasLinkedin ? "LinkedIn profile linked" : "No LinkedIn profile",
    ];

    return {
        leadId: lead.id,
        qualificationReason: `Local heuristic score: ${compositeScore}% — evaluated based on role (${lead.title ?? "unknown"}), contact availability, and signal density.`,
        breakdownScores: { icpMatch, intentStrength, fundingSignals, hiringVelocity, techFit, recency, evidenceTriggers },
        evidenceTriggers,
        recommendedAction,
    };
}

async function fetchScoresFromGemini(
    leadsSubset: any[],
    icpDescription: string,
    systemPrompt: string,
    campaignId: string | undefined,
): Promise<any[]> {
    const leadPromptsText =
        buildLeadPromptsText(leadsSubset);

    const scope: {
        rawResult: { scores: any[] } | null;
    } = {
        rawResult: null,
    };

    let toolCallCount = 0;

    const batchScoringTool: ToolDefinition = {
        declaration: {
            name: "returnBatchResult",
            description:
                "Return the batch of lead scoring results.",
            parameters: {
                type: SchemaType.OBJECT,
                properties: {
                    scores: {
                        type: SchemaType.ARRAY,
                        description:
                            "List of score results for each evaluated lead.",
                        items: {
                            type: SchemaType.OBJECT,
                            properties: {
                                leadId: {
                                    type: SchemaType.STRING,
                                    description:
                                        "The unique Lead ID from the input.",
                                },
                                qualificationReason: {
                                    type: SchemaType.STRING,
                                    description:
                                        "1–2 sentences summarising the most important reason for this score.",
                                },
                                breakdownScores: {
                                    type: SchemaType.OBJECT,
                                    description:
                                        "Per-dimension scores 0–100.",
                                    properties: {
                                        icpMatch: {
                                            type: SchemaType.NUMBER,
                                        },
                                        intentStrength: {
                                            type: SchemaType.NUMBER,
                                        },
                                        fundingSignals: {
                                            type: SchemaType.NUMBER,
                                        },
                                        hiringVelocity: {
                                            type: SchemaType.NUMBER,
                                        },
                                        techFit: {
                                            type: SchemaType.NUMBER,
                                        },
                                        recency: {
                                            type: SchemaType.NUMBER,
                                        },
                                    },
                                    required: [
                                        "icpMatch",
                                        "intentStrength",
                                        "fundingSignals",
                                        "hiringVelocity",
                                        "techFit",
                                        "recency",
                                    ],
                                },
                                evidenceTriggers: {
                                    type: SchemaType.ARRAY,
                                    description:
                                        "2–5 specific facts that drove the score.",
                                    items: {
                                        type: SchemaType.STRING,
                                    },
                                },
                            },
                            required: [
                                "leadId",
                                "qualificationReason",
                                "breakdownScores",
                                "evidenceTriggers",
                            ],
                        },
                    },
                },
                required: ["scores"],
            },
        },
        handler: async (args: any) => {
            toolCallCount++;

            const incomingScores = Array.isArray(args?.scores)
                ? args.scores
                : [];

            if (toolCallCount > 1) {
                logger.warn(
                    {
                        toolCallCount,
                        batchSize: leadsSubset.length,
                    },
                    "[lead-scoring] returnBatchResult tool was called more than once; merging results by leadId",
                );
            }

            const merged = new Map<string, any>();

            for (const score of scope.rawResult?.scores ?? []) {
                if (score?.leadId) {
                    merged.set(score.leadId, score);
                }
            }

            for (const score of incomingScores) {
                if (!score?.leadId) {
                    logger.warn(
                        {
                            batchSize: leadsSubset.length,
                        },
                        "[lead-scoring] Gemini returned a score entry with no leadId, dropping",
                    );
                    continue;
                }

                merged.set(score.leadId, score);
            }

            scope.rawResult = {
                scores: [...merged.values()],
            };

            return args;
        },
    };

    let raw = scope.rawResult;

    try {
        await callGateway<{ scores: unknown[] }>({
            agentName: "lead-scoring.batch",
            model: MODELS.RESEARCH,
            systemPrompt,
            userPrompt: `ICP: ${icpDescription}\n\nLeads to evaluate:\n${leadPromptsText}`,
            responseMode: "tool",
            outputSchema: z.object({ scores: z.array(z.unknown()) }),
            tools: [batchScoringTool],
            temperature: 0.2,
        });
        raw = scope.rawResult;
    } catch (err) {
        logger.warn(
            { err: err instanceof Error ? err.message : String(err), count: leadsSubset.length },
            "[lead-scoring] Gemini API unavailable or throttled — engaging local heuristic scoring fallback"
        );
        raw = {
            scores: leadsSubset.map((lead) => computeHeuristicScoreForLead(lead, icpDescription))
        };
    }

    if (!raw || raw.scores.length === 0) {
        raw = {
            scores: leadsSubset.map((lead) => computeHeuristicScoreForLead(lead, icpDescription))
        };
    }

    if (raw.scores.length > leadsSubset.length) {
        logger.warn(
            {
                returnedCount: raw.scores.length,
                requestedCount: leadsSubset.length,
                campaignId,
            },
            "[lead-scoring] Gemini returned more distinct score entries than leads requested",
        );
    }

    return raw.scores;
}

function processScoreEntries(
    scores: any[],
    leadsToScoreById: Map<string, any>,
    resolvedWeights: ScoringWeights,
    resolvedThreshold: number,
    processedLeadIds: Set<string>,
    updates: PendingLeadUpdate[],
    failedLeadIds: Set<string>,
): void {
    for (const scoreRaw of scores) {
        const leadId = scoreRaw?.leadId as
            | string
            | undefined;

        const sourceLead = leadId
            ? leadsToScoreById.get(leadId)
            : undefined;

        if (!leadId || !sourceLead) {
            logger.warn(
                { leadId },
                "[lead-scoring] Gemini returned an unrecognised leadId, skipping",
            );
            continue;
        }

        if (processedLeadIds.has(leadId)) {
            logger.warn(
                { leadId },
                "[lead-scoring] Gemini returned a duplicate leadId in batch, ignoring extra entry",
            );
            continue;
        }

        try {
            const scoring = validateScoringResult(
                scoreRaw,
                resolvedWeights,
                sourceLead,
            );

            const normalisedScore =
                scoring.qualificationScore / 100;

            const reasonWithTriggers =
                buildReasonWithTriggers(
                    scoring.qualificationScore,
                    scoring.qualificationReason,
                    scoring.evidenceTriggers,
                );

            processedLeadIds.add(leadId);
            failedLeadIds.delete(leadId);

            updates.push({
                leadId,
                qualifies:
                    normalisedScore >= resolvedThreshold &&
                    scoring.recommendedAction !==
                    "DISQUALIFY",
                expectedUpdatedAt: sourceLead.updatedAt,
                data: {
                    qualificationScore:
                        normalisedScore,
                    qualificationReason:
                        reasonWithTriggers,
                    breakdownScores: (scoring.breakdownScores as unknown) as Prisma.InputJsonValue,
                    evidenceTriggers: scoring.evidenceTriggers as unknown as Prisma.InputJsonValue,
                    recommendedAction:
                        scoring.recommendedAction,
                },
            });
        } catch (err) {
            logger.warn(
                { err, leadId },
                "[lead-scoring] Validation failed for lead, skipping",
            );

            failedLeadIds.add(leadId);
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) =>
        setTimeout(resolve, ms),
    );
}

async function withTimeout<T>(
    promise: Promise<T>,
    ms: number,
    label: string,
): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => {
                    reject(
                        new Error(
                            `Timeout after ${ms}ms: ${label}`,
                        ),
                    );
                }, ms);
            }),
        ]);
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
}

function resolveBatchTimeoutMs(
    leadCount: number,
): number {
    return Math.max(
        SCORE_TIMEOUT_MS * 2,
        leadCount * SCORE_TIMEOUT_PER_LEAD_MS,
    );
}

async function runWithRetries<T>(
    fn: () => Promise<T>,
    attempts: number,
    delayMs: number,
): Promise<T> {
    let lastError: unknown;

    for (
        let attempt = 1;
        attempt <= attempts;
        attempt++
    ) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;

            if (attempt < attempts) {
                await sleep(delayMs * attempt);
            }
        }
    }

    throw lastError;
}

function parseRetryDelayMs(
    err: unknown,
): number | null {
    if (!err || typeof err !== "object") {
        return null;
    }

    const error = err as Record<
        string,
        unknown
    >;

    if (error.status !== 429) {
        return null;
    }

    const details = error.errorDetails;

    if (!Array.isArray(details)) {
        return null;
    }

    for (const detail of details) {
        if (
            detail &&
            typeof detail === "object" &&
            (detail as Record<string, unknown>)[
            "@type"
            ] ===
            "type.googleapis.com/google.rpc.RetryInfo"
        ) {
            const raw = (
                detail as Record<string, unknown>
            ).retryDelay;

            if (typeof raw === "string") {
                const seconds = parseFloat(
                    raw.replace("s", ""),
                );

                if (
                    Number.isFinite(seconds) &&
                    seconds > 0
                ) {
                    return (
                        Math.ceil(seconds) * 1000 +
                        2000
                    );
                }
            }
        }
    }

    return null;
}

async function batchScoreWithRetry(
    leadIds: string[],
    icpDescription: string,
    force: boolean,
    qualificationThreshold?: number,
    prefetchedLeads?: any[],
    prefetchedWeights?: ScoringWeights,
    prefetchedSystemPrompt?: string,
): Promise<BatchScoringOutcome> {
    for (
        let attempt = 1;
        attempt <= SCORE_RETRY_ATTEMPTS;
        attempt++
    ) {
        try {
            return await withTimeout(
                scoreLeadsBatch(
                    leadIds,
                    icpDescription,
                    force,
                    qualificationThreshold,
                    prefetchedLeads,
                    prefetchedWeights,
                    prefetchedSystemPrompt,
                ),
                resolveBatchTimeoutMs(
                    leadIds.length,
                ),
                `batchSize=${leadIds.length}`,
            );
        } catch (err) {
            if (
                attempt ===
                SCORE_RETRY_ATTEMPTS
            ) {
                throw err;
            }

            const serverDelayMs =
                parseRetryDelayMs(err);

            const exponentialDelay = Math.min(
                RETRY_BASE_DELAY_MS *
                2 ** (attempt - 1),
                MAX_RETRY_DELAY_MS,
            );

            const delay =
                serverDelayMs ??
                exponentialDelay;

            logger.warn(
                {
                    err,
                    leadIdsCount:
                        leadIds.length,
                    attempt,
                    nextRetryMs: delay,
                    serverAdvised:
                        serverDelayMs !== null,
                },
                "[lead-scoring] Retrying failed batch score",
            );

            await sleep(delay);
        }
    }

    throw new Error(
        `batchScoreWithRetry exhausted for batch of ${leadIds.length}`,
    );
}

function chunkArray<T>(
    arr: T[],
    size: number,
): T[][] {
    const chunks: T[][] = [];

    for (
        let i = 0;
        i < arr.length;
        i += size
    ) {
        chunks.push(
            arr.slice(i, i + size),
        );
    }

    return chunks;
}

export async function runLeadScoringAgent(
    leadId: string,
    icpDescription: string,
    force = false,
    qualificationThreshold?: number,
): Promise<boolean> {
    const result =
        await runBatchLeadScoringAgent(
            [leadId],
            icpDescription,
            force,
            qualificationThreshold,
        );

    return result[leadId] ?? false;
}

export async function runBatchLeadScoringAgent(
    leadIds: string[],
    icpDescription: string,
    force = false,
    qualificationThreshold?: number,
): Promise<Record<string, boolean>> {
    const { results } =
        await scoreLeadsBatch(
            leadIds,
            icpDescription,
            force,
            qualificationThreshold,
        );

    return results;
}

async function scoreLeadsBatch(
    leadIds: string[],
    icpDescription: string,
    force = false,
    qualificationThreshold?: number,
    prefetchedLeads?: any[],
    prefetchedWeights?: ScoringWeights,
    prefetchedSystemPrompt?: string,
): Promise<BatchScoringOutcome> {
    const uniqueLeadIds = [
        ...new Set(
            leadIds.filter(
                (id): id is string =>
                    typeof id === "string" &&
                    id.trim().length > 0,
            ),
        ),
    ];

    if (uniqueLeadIds.length === 0) {
        return {
            results: {},
            unscoredLeadIds: [],
        };
    }

    const prefetchedById = prefetchedLeads
        ? new Map(prefetchedLeads.map((lead) => [lead.id, lead]))
        : null;

    const leads = prefetchedById
        ? uniqueLeadIds
            .map((id) => prefetchedById.get(id))
            .filter(
                (lead): lead is NonNullable<typeof lead> =>
                    lead !== undefined &&
                    lead.deletedAt === null,
            )
        : await prisma.lead.findMany({
            where: {
                id: {
                    in: uniqueLeadIds,
                },
                deletedAt: null,
            },
            include: {
                signals: {
                    orderBy: {
                        confidence: "desc",
                    },
                    take: MAX_LEAD_SIGNALS,
                },
                company: {
                    include: {
                        signals: {
                            orderBy: {
                                confidence: "desc",
                            },
                            take: MAX_COMPANY_SIGNALS,
                        },
                    },
                },
            },
        });

    const uniqueCampaignIds = new Set(
        leads.map((lead) => lead.campaignId),
    );

    if (uniqueCampaignIds.size > 1) {
        throw new Error(
            `runBatchLeadScoringAgent called with leads from ${uniqueCampaignIds.size} campaigns. All leads in a batch must belong to the same campaign.`,
        );
    }

    const campaignId = leads[0]?.campaignId;

    const leadsToScore = force
        ? leads
        : leads.filter(
            (lead) =>
                lead.qualificationScore === null ||
                lead.recommendedAction === null,
        );

    const resolvedThreshold =
        qualificationThreshold !== undefined
            ? resolveThreshold(qualificationThreshold)
            : campaignId
                ? await getCampaignQualificationThreshold(campaignId)
                : QUALIFICATION_THRESHOLD;

    const results: Record<string, boolean> = {};

    for (const lead of leads) {
        results[lead.id] =
            typeof lead.qualificationScore === "number" &&
            lead.qualificationScore >= resolvedThreshold &&
            lead.recommendedAction !== "DISQUALIFY";
    }

    if (leadsToScore.length === 0) {
        return {
            results,
            unscoredLeadIds: [],
        };
    }

    const MIN_FIRMOGRAPHIC_SIGNALS = 2;

    const [leadsWithSignals, thinLeads] = leadsToScore.reduce<[any[], any[]]>(
        ([rich, thin], lead) => {
            const signalCount =
                (lead.signals?.length ?? 0) + (lead.company?.signals?.length ?? 0);
            return signalCount >= MIN_FIRMOGRAPHIC_SIGNALS
                ? [[...rich, lead], thin]
                : [rich, [...thin, lead]];
        },
        [[], []],
    );

    if (thinLeads.length > 0) {
        logger.info(
            { campaignId, thinLeadCount: thinLeads.length },
            "[lead-scoring] Pre-flight: leads below firmographic threshold auto-tagged DISQUALIFY",
        );

        const disqualifyData = {
            qualificationScore: 0,
            qualificationReason: "Insufficient firmographic data — auto-disqualified pre-scoring",
            breakdownScores: ({ icpMatch: 0, intentStrength: 0, fundingSignals: 0, hiringVelocity: 0, techFit: 0, recency: 0 } as unknown) as Prisma.InputJsonValue,
            evidenceTriggers: ([] as unknown) as Prisma.InputJsonValue,
            recommendedAction: "DISQUALIFY" as const,
        };

        await Promise.allSettled(
            thinLeads.map((lead) =>
                prisma.lead.updateMany({
                    where: { id: lead.id, updatedAt: lead.updatedAt },
                    data: disqualifyData,
                }),
            ),
        );

        for (const lead of thinLeads) {
            results[lead.id] = false;
        }
    }

    const leadsToScoreById = new Map(
        leadsWithSignals.map((lead) => [lead.id, lead]),
    );

    const allLeadIds = leadsWithSignals.map((lead) => lead.id);

    let resolvedWeights =
        prefetchedWeights ?? DEFAULT_SCORING_WEIGHTS;
    let systemPrompt =
        prefetchedSystemPrompt ??
        LEAD_SCORING_SYSTEM_PROMPT;

    if (!prefetchedWeights && campaignId) {
        const weights =
            await prisma.campaignScoringWeights.findUnique({
                where: {
                    campaignId,
                },
                select: {
                    icpMatch: true,
                    intentStrength: true,
                    fundingSignals: true,
                    hiringVelocity: true,
                    techFit: true,
                    recency: true,
                },
            });

        resolvedWeights = weights ?? DEFAULT_SCORING_WEIGHTS;

        if (weights) {
            try {
                validateWeights(weights);
            } catch (err) {
                logger.error(
                    {
                        err,
                        campaignId,
                        weights,
                    },
                    "[lead-scoring] Invalid campaign scoring weights, falling back to defaults",
                );
                resolvedWeights = DEFAULT_SCORING_WEIGHTS;
            }
        }

        systemPrompt = buildScoringSystemPrompt(resolvedWeights);
    }

    if (allLeadIds.length === 0) {
        return { results, unscoredLeadIds: [] };
    }

    const initialScores = await fetchScoresFromGemini(
        leadsWithSignals,
        icpDescription,
        systemPrompt,
        campaignId,
    );

    const processedLeadIds = new Set<string>();
    const updates: PendingLeadUpdate[] = [];
    const failedLeadIds = new Set<string>();

    processScoreEntries(
        initialScores,
        leadsToScoreById,
        resolvedWeights,
        resolvedThreshold,
        processedLeadIds,
        updates,
        failedLeadIds,
    );

    let missingLeadIds = allLeadIds.filter(
        (id) => !processedLeadIds.has(id),
    );

    if (missingLeadIds.length > 0) {
        logger.warn(
            {
                campaignId,
                missingLeadIds,
                missingCount: missingLeadIds.length,
                totalCount: leadsToScore.length,
            },
            "[lead-scoring] Some leads weren't successfully scored in the initial response, retrying just those",
        );

        try {
            const missingLeads = missingLeadIds
                .map((id) => leadsToScoreById.get(id))
                .filter(
                    (lead): lead is NonNullable<typeof lead> =>
                        lead !== undefined,
                );

            const retryScores = await fetchScoresFromGemini(
                missingLeads,
                icpDescription,
                systemPrompt,
                campaignId,
            );

            processScoreEntries(
                retryScores,
                leadsToScoreById,
                resolvedWeights,
                resolvedThreshold,
                processedLeadIds,
                updates,
                failedLeadIds,
            );

            missingLeadIds = allLeadIds.filter(
                (id) => !processedLeadIds.has(id),
            );
        } catch (err) {
            logger.warn(
                {
                    err,
                    missingLeadIds,
                },
                "[lead-scoring] Retry for unscored leads also failed",
            );
        }

        if (missingLeadIds.length > 0) {
            logger.warn(
                {
                    campaignId,
                    missingLeadIds,
                    missingCount: missingLeadIds.length,
                },
                "[lead-scoring] Initiating micro-batch sub-batch recovery (batch size 2)",
            );

            for (let i = 0; i < missingLeadIds.length; i += 2) {
                const microBatchIds = missingLeadIds.slice(i, i + 2);
                const microBatchLeads = microBatchIds
                    .map((id) => leadsToScoreById.get(id))
                    .filter((lead): lead is NonNullable<typeof lead> => lead !== undefined);

                if (microBatchLeads.length === 0) continue;

                try {
                    const microScores = await fetchScoresFromGemini(
                        microBatchLeads,
                        icpDescription,
                        systemPrompt,
                        campaignId,
                    );

                    processScoreEntries(
                        microScores,
                        leadsToScoreById,
                        resolvedWeights,
                        resolvedThreshold,
                        processedLeadIds,
                        updates,
                        failedLeadIds,
                    );
                } catch (microErr) {
                    logger.warn(
                        { microBatchIds, microErr },
                        "[lead-scoring] Micro-batch recovery failed — applying heuristic fallback",
                    );

                    for (const lead of microBatchLeads) {
                        if (processedLeadIds.has(lead.id)) continue;

                        const heuristicRaw = computeHeuristicScoreForLead(lead, icpDescription);
                        const breakdown = (heuristicRaw.breakdownScores ?? {}) as Record<string, number>;
                        const heuristicScore = Math.round(
                            (breakdown.icpMatch ?? 50) * 0.35 +
                            (breakdown.intentStrength ?? 40) * 0.20 +
                            (breakdown.techFit ?? 40) * 0.15 +
                            (breakdown.hiringVelocity ?? 50) * 0.15 +
                            (breakdown.fundingSignals ?? 50) * 0.10 +
                            (breakdown.recency ?? 60) * 0.05
                        ) / 100;

                        const qualifies = heuristicScore >= resolvedThreshold;

                        processedLeadIds.add(lead.id);
                        failedLeadIds.delete(lead.id);

                        updates.push({
                            leadId: lead.id,
                            qualifies,
                            expectedUpdatedAt: lead.updatedAt,
                            data: {
                                qualificationScore: heuristicScore,
                                qualificationReason: `[HEURISTIC] ${String(heuristicRaw.qualificationReason ?? "Local heuristic fallback")}`,
                                breakdownScores: (
                                    heuristicRaw.breakdownScores ?? {}
                                ) as unknown as Prisma.InputJsonValue,
                                evidenceTriggers: (
                                    (heuristicRaw.evidenceTriggers as string[]) ?? []
                                ) as unknown as Prisma.InputJsonValue,
                                recommendedAction: qualifies ? "STANDARD" : "DISQUALIFY",
                            },
                        });
                    }
                }
            }

            const finalMissing = allLeadIds.filter((id) => !processedLeadIds.has(id));
            if (finalMissing.length > 0) {
                logger.warn(
                    { campaignId, finalMissing },
                    "[lead-scoring] Leads unscored after full recovery chain — recording as failed",
                );

                for (const id of finalMissing) {
                    failedLeadIds.add(id);
                }
            }
        }
    }

    const staleLeadIds: string[] = [];

    if (updates.length > 0) {
        const applyUpdates = () =>
            prisma.$transaction(
                updates.map((update) =>
                    prisma.lead.updateMany({
                        where: {
                            id: update.leadId,
                            updatedAt: update.expectedUpdatedAt,
                            deletedAt: null,
                        },
                        data: update.data,
                    }),
                ),
            );

        try {
            const txResults = await runWithRetries(
                applyUpdates,
                TRANSACTION_RETRY_ATTEMPTS,
                TRANSACTION_RETRY_DELAY_MS,
            );

            const successfulUpdates: PendingLeadUpdate[] = [];

            txResults.forEach((result, index) => {
                const update = updates[index];

                if (result.count > 0) {
                    results[update.leadId] = update.qualifies;
                    successfulUpdates.push(update);
                } else {
                    staleLeadIds.push(update.leadId);
                    logger.warn(
                        {
                            leadId: update.leadId,
                        },
                        "[lead-scoring] Lead changed concurrently since it was read, skipping update",
                    );
                }
            });

            await Promise.allSettled(
                successfulUpdates.map((update) =>
                    logLeadJourneyEvent({
                        leadId: update.leadId,
                        eventType: "SCORE_UPDATED",
                        metadata: {
                            qualificationScore:
                                update.data.qualificationScore,
                            qualifies: update.qualifies,
                        },
                    }),
                ),
            );
        } catch (err) {
            logger.warn(
                {
                    err,
                    leadIds: updates.map((update) => update.leadId),
                },
                "[lead-scoring] Transactional batch update failed after retries, falling back to per-lead updates",
            );

            const updateLimit = pLimit(
                UPDATE_FALLBACK_CONCURRENCY,
            );

            const settled = await Promise.allSettled(
                updates.map((update) =>
                    updateLimit(async () => {
                        const result =
                            await prisma.lead.updateMany({
                                where: {
                                    id: update.leadId,
                                    updatedAt:
                                        update.expectedUpdatedAt,
                                    deletedAt: null,
                                },
                                data: update.data,
                            });

                        if (result.count === 0) {
                            staleLeadIds.push(update.leadId);
                            logger.warn(
                                {
                                    leadId: update.leadId,
                                },
                                "[lead-scoring] Lead changed concurrently since it was read, skipping update",
                            );
                            return;
                        }

                        results[update.leadId] =
                            update.qualifies;

                        await logLeadJourneyEvent({
                            leadId: update.leadId,
                            eventType: "SCORE_UPDATED",
                            metadata: {
                                qualificationScore:
                                    update.data.qualificationScore,
                                qualifies: update.qualifies,
                            },
                        });
                    }),
                ),
            );

            settled.forEach((result, index) => {
                if (result.status === "rejected") {
                    failedLeadIds.add(
                        updates[index].leadId,
                    );
                    logger.warn(
                        {
                            err: result.reason,
                            leadId:
                                updates[index].leadId,
                        },
                        "[lead-scoring] Per-lead fallback update failed",
                    );
                }
            });
        }
    }

    const unscoredLeadIds = [
        ...new Set([
            ...failedLeadIds,
            ...missingLeadIds,
            ...staleLeadIds,
        ]),
    ];

    if (unscoredLeadIds.length > 0) {
        logger.warn(
            {
                campaignId,
                unscoredLeadIds,
                unscoredCount: unscoredLeadIds.length,
                totalCount: leadsToScore.length,
            },
            "[lead-scoring] Some leads in batch were not successfully scored this run",
        );
    }

    return {
        results,
        unscoredLeadIds,
    };
}

export async function runBulkLeadScoringAgent(
    campaignId: string,
    force = false,
): Promise<{
    scored: number;
    qualified: number;
    failed: number;
    revealQueued: number;
}> {
    const campaign = await prisma.campaign.findUnique({
        where: {
            id: campaignId,
        },
        select: {
            icpDescription: true,
            qualificationThreshold: true,
        },
    });

    if (!campaign) {
        throw new Error(`Campaign ${campaignId} not found`);
    }

    const icpDescription = campaign.icpDescription;

    if (!icpDescription?.trim()) {
        throw new Error(
            `Campaign ${campaignId} has no ICP description — cannot score leads`,
        );
    }

    const qualificationThreshold = resolveThreshold(
        campaign.qualificationThreshold,
    );

    let resolvedWeights: ScoringWeights =
        DEFAULT_SCORING_WEIGHTS;

    const configuredWeights =
        await prisma.campaignScoringWeights.findUnique({
            where: {
                campaignId,
            },
            select: {
                icpMatch: true,
                intentStrength: true,
                fundingSignals: true,
                hiringVelocity: true,
                techFit: true,
                recency: true,
            },
        });

    if (configuredWeights) {
        resolvedWeights = configuredWeights;

        try {
            validateWeights(configuredWeights);
        } catch (err) {
            logger.error(
                {
                    err,
                    campaignId,
                    weights: configuredWeights,
                },
                "[lead-scoring] Invalid campaign scoring weights, falling back to defaults",
            );
            resolvedWeights = DEFAULT_SCORING_WEIGHTS;
        }
    }

    const systemPrompt =
        buildScoringSystemPrompt(resolvedWeights);

    let scored = 0;
    let qualified = 0;
    let failed = 0;
    let revealQueued = 0;
    let lastCallAt = 0;

    const failedIds = new Set<string>();
    const processedIds = new Set<string>();
    const limit = pLimit(BULK_CONCURRENCY);

    while (true) {
        const excludeIds = force
            ? new Set([
                ...processedIds,
                ...failedIds,
            ])
            : failedIds;

        const leads = await prisma.lead.findMany({
            where: {
                campaignId,
                deletedAt: null,
                outreachMessages: {
                    none: {},
                },
                ...(excludeIds.size > 0
                    ? {
                        id: {
                            notIn: [
                                ...excludeIds,
                            ],
                        },
                    }
                    : {}),
                ...(force
                    ? {}
                    : {
                        AND: [
                            {
                                OR: [
                                    {
                                        qualificationScore:
                                            null,
                                    },
                                    {
                                        recommendedAction:
                                            null,
                                    },
                                ],
                            },
                            {
                                OR: [
                                    {
                                        recommendedAction:
                                            null,
                                    },
                                    {
                                        recommendedAction: {
                                            not: "DISQUALIFY",
                                        },
                                    },
                                ],
                            },
                        ],
                    }),
            },
            include: {
                signals: {
                    orderBy: {
                        confidence: "desc",
                    },
                    take: MAX_LEAD_SIGNALS,
                },
                company: {
                    include: {
                        signals: {
                            orderBy: {
                                confidence: "desc",
                            },
                            take: MAX_COMPANY_SIGNALS,
                        },
                    },
                },
            },
            orderBy: {
                createdAt: "asc",
            },
            take: BULK_BATCH_SIZE,
        });

        if (leads.length === 0) {
            break;
        }

        const batchIds = leads.map(
            (lead) => lead.id,
        );

        if (force) {
            for (const id of batchIds) {
                processedIds.add(id);
            }
        }

        logger.info(
            {
                campaignId,
                batch: leads.length,
                scored,
                failed,
            },
            "[lead-scoring] Bulk scoring batch",
        );

        const chunks = chunkArray(
            batchIds,
            GEMINI_BATCH_SIZE,
        );

        const results = await Promise.allSettled(
            chunks.map((chunk) =>
                limit(async () => {
                    const now = Date.now();
                    const elapsed =
                        now - lastCallAt;

                    if (
                        lastCallAt > 0 &&
                        elapsed <
                        BULK_INTER_CHUNK_DELAY_MS
                    ) {
                        await sleep(
                            BULK_INTER_CHUNK_DELAY_MS -
                            elapsed,
                        );
                    }

                    lastCallAt = Date.now();

                    const chunkIdSet =
                        new Set(chunk);

                    const chunkLeads =
                        leads.filter((lead) =>
                            chunkIdSet.has(
                                lead.id,
                            ),
                        );

                    return batchScoreWithRetry(
                        chunk,
                        icpDescription,
                        force,
                        qualificationThreshold,
                        chunkLeads,
                        resolvedWeights,
                        systemPrompt,
                    );
                }),
            ),
        );

        for (
            let i = 0;
            i < results.length;
            i++
        ) {
            const result = results[i];
            const chunk = chunks[i];

            if (
                result.status ===
                "fulfilled"
            ) {
                const {
                    results: batchResults,
                    unscoredLeadIds,
                } = result.value;

                const unscoredSet =
                    new Set(
                        unscoredLeadIds,
                    );

                for (const leadId of chunk) {
                    if (
                        unscoredSet.has(
                            leadId,
                        )
                    ) {
                        failed++;
                        failedIds.add(
                            leadId,
                        );
                    } else {
                        scored++;

                        if (
                            batchResults[
                            leadId
                            ]
                        ) {
                            qualified++;
                        }
                    }
                }
            } else {
                for (const leadId of chunk) {
                    failed++;
                    failedIds.add(
                        leadId,
                    );
                }

                logger.warn(
                    {
                        err: result.reason,
                        chunkLength:
                            chunk.length,
                    },
                    "[lead-scoring] Lead batch failed after retries",
                );
            }
        }

        if (
            leads.length <
            BULK_BATCH_SIZE
        ) {
            break;
        }
    }

    try {
        const readyForReveal =
            await prisma.lead.findMany({
                where: {
                    campaignId,
                    deletedAt: null,
                    recommendedAction: {
                        not: "DISQUALIFY",
                    },
                    qualificationScore: {
                        gte:
                            qualificationThreshold,
                    },
                    emailStatus:
                        "NOT_ATTEMPTED",
                },
                select: {
                    id: true,
                },
            });

        if (
            readyForReveal.length > 0
        ) {
            const revealResult =
                await enqueueEmailRevealForQualifiedLeads(
                    readyForReveal.map(
                        (lead) =>
                            lead.id,
                    ),
                    campaignId,
                    qualificationThreshold,
                );

            revealQueued =
                revealResult.qualifiedIds.length;

            logger.info(
                {
                    campaignId,
                    candidates:
                        readyForReveal.length,
                    revealQueued,
                    skipped:
                        revealResult.skipped,
                    qualificationThreshold,
                },
                "[lead-scoring] Qualified email reveal jobs queued",
            );
        }
    } catch (err) {
        logger.warn(
            {
                err,
                campaignId,
            },
            "[lead-scoring] Failed to enqueue email reveal for qualified leads",
        );
    }

    logger.info(
        {
            campaignId,
            scored,
            qualified,
            failed,
            revealQueued,
        },
        "[lead-scoring] Bulk scoring complete",
    );

    return {
        scored,
        qualified,
        failed,
        revealQueued,
    };
}