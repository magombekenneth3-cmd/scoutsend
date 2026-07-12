import { Prisma } from "@prisma/client";
import pLimit from "p-limit";
import { prisma } from "../../lib/prisma";
import { callGeminiWithTools, MODELS, SchemaType, ToolDefinition } from "./gemini.client";
import { logger } from "../../lib/logger";

export interface BreakdownScores {
    icpMatch: number;
    intentStrength: number;
    fundingSignals: number;
    hiringVelocity: number;
    techFit: number;
    recency: number;
}

export interface ScoringResult {
    qualificationScore: number;
    qualificationReason: string;
    breakdownScores: BreakdownScores;
    evidenceTriggers: string[];
    recommendedAction: "HIGH_PRIORITY" | "STANDARD" | "NURTURE" | "DISQUALIFY";
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
    const w = weights;
    return `You are an expert B2B lead scoring engine. Score a lead across six dimensions by returning breakdownScores (0–100 each), evidenceTriggers, and qualificationReason.
You must always call the returnBatchResult tool to return the result. Do not return plain conversational text or explain your thought process in conversational text.

These weights determine how your breakdownScores combine into the lead's overall weighted score. We compute that weighted score — and the resulting recommended action — from your breakdownScores ourselves:
  icpMatch        → ${pct(w.icpMatch)}
  intentStrength  → ${pct(w.intentStrength)}
  fundingSignals  → ${pct(w.fundingSignals)}
  hiringVelocity  → ${pct(w.hiringVelocity)}
  techFit         → ${pct(w.techFit)}
  recency         → ${pct(w.recency)}

Score each dimension independently and honestly on its own 0–100 scale; don't shade individual dimensions to try to steer the overall outcome.`;
}

const DEFAULT_SCORING_WEIGHTS: ScoringWeights = {
    icpMatch: 0.25,
    intentStrength: 0.30,
    fundingSignals: 0.15,
    hiringVelocity: 0.15,
    techFit: 0.10,
    recency: 0.05,
};

export const LEAD_SCORING_SYSTEM_PROMPT = buildScoringSystemPrompt(DEFAULT_SCORING_WEIGHTS);


export const QUALIFICATION_THRESHOLD = 0.40;

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
const MAX_SIGNAL_EXPLANATION_CHARS = 1_000;
const MAX_ENRICHMENT_JSON_CHARS = 3_000;
const MAX_EVIDENCE_TRIGGERS = 5;
const MAX_REASON_CHARS = 2_000;
const GEMINI_BATCH_SIZE = 10;
const BULK_BATCH_SIZE = 50;
const BULK_CONCURRENCY = 1;
const BULK_INTER_CHUNK_DELAY_MS = 1_500;
const SCORE_RETRY_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 120_000;
const SCORE_TIMEOUT_MS = 60_000;
const SCORE_TIMEOUT_PER_LEAD_MS = 8_000;
const TRANSACTION_RETRY_ATTEMPTS = 3;
const TRANSACTION_RETRY_DELAY_MS = 300;
const UPDATE_FALLBACK_CONCURRENCY = 10;
const CAMPAIGN_THRESHOLD_CACHE_TTL_MS = 60_000;
const CAMPAIGN_THRESHOLD_CACHE_MAX_SIZE = 500;

if (BULK_CONCURRENCY !== 1) {
    throw new Error("BULK_CONCURRENCY must stay 1 unless the inter-chunk rate limiter is made concurrency-safe.");
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
        recommendedAction: ScoringResult["recommendedAction"];
    };
}

interface BatchScoringOutcome {
    results: Record<string, boolean>;
    unscoredLeadIds: string[];
}

function clampScore(value: unknown): number {
    const raw = typeof value === "number" ? value : NaN;
    if (isNaN(raw)) return 0;
    return Math.min(100, Math.max(0, Math.round(raw)));
}

function resolveThreshold(raw: unknown): number {
    return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 && raw <= 1
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

const campaignThresholdCache = new Map<string, { value: number; expiresAt: number }>();

function pruneCampaignThresholdCache(now: number): void {
    if (campaignThresholdCache.size < CAMPAIGN_THRESHOLD_CACHE_MAX_SIZE) return;

    for (const [key, entry] of campaignThresholdCache) {
        if (entry.expiresAt <= now) campaignThresholdCache.delete(key);
    }

    while (campaignThresholdCache.size >= CAMPAIGN_THRESHOLD_CACHE_MAX_SIZE) {
        const oldestKey = campaignThresholdCache.keys().next().value;
        if (oldestKey === undefined) break;
        campaignThresholdCache.delete(oldestKey);
    }
}

async function getCampaignQualificationThreshold(campaignId: string): Promise<number> {
    const cached = campaignThresholdCache.get(campaignId);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.value;

    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { qualificationThreshold: true },
    });
    const value = resolveThreshold(campaign?.qualificationThreshold);

    pruneCampaignThresholdCache(now);
    campaignThresholdCache.set(campaignId, { value, expiresAt: now + CAMPAIGN_THRESHOLD_CACHE_TTL_MS });
    return value;
}

function truncateText(text: string, maxChars: number): string {
    return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function truncateJsonForPrompt(value: Record<string, unknown>, maxChars: number): string {
    const json = JSON.stringify(value, null, 2);
    if (json.length <= maxChars) return json;
    return `${json.slice(0, maxChars)}\n... [truncated ${json.length - maxChars} more characters]`;
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

    if (!raw || typeof raw !== "object") return fallback;

    const r = raw as Record<string, unknown>;
    return BREAKDOWN_SCORE_KEYS.reduce((acc, key) => {
        acc[key] = clampScore(r[key]);
        return acc;
    }, {} as BreakdownScores);
}


function computeQualificationScore(breakdownScores: BreakdownScores, weights: ScoringWeights): number {
    const weighted =
        breakdownScores.icpMatch * weights.icpMatch +
        breakdownScores.intentStrength * weights.intentStrength +
        breakdownScores.fundingSignals * weights.fundingSignals +
        breakdownScores.hiringVelocity * weights.hiringVelocity +
        breakdownScores.techFit * weights.techFit +
        breakdownScores.recency * weights.recency;
    return clampScore(weighted);
}


function computeRecommendedAction(score: number): ScoringResult["recommendedAction"] {
    if (score >= 70) return "HIGH_PRIORITY";
    if (score >= 45) return "STANDARD";
    if (score >= 25) return "NURTURE";
    return "DISQUALIFY";
}

function validateScoringResult(raw: unknown, weights: ScoringWeights): ScoringResult {
    if (!raw || typeof raw !== "object") throw new Error("Scoring result is not an object");

    const r = raw as Record<string, unknown>;
    const breakdownScores = validateBreakdownScores(r.breakdownScores);
    const qualificationScore = computeQualificationScore(breakdownScores, weights);
    const recommendedAction = computeRecommendedAction(qualificationScore);
    const qualificationReason = typeof r.qualificationReason === "string"
        ? r.qualificationReason
        : "No reason provided";
    const evidenceTriggers = Array.isArray(r.evidenceTriggers)
        ? (r.evidenceTriggers as unknown[]).filter((t): t is string => typeof t === "string")
        : [];

    return { qualificationScore, qualificationReason, breakdownScores, evidenceTriggers, recommendedAction };
}

function buildReasonWithTriggers(score: number, reason: string, triggers: string[]): string {
    const cappedTriggers = triggers.slice(0, MAX_EVIDENCE_TRIGGERS);
    const combined = [
        `Score: ${score}/100.`,
        reason,
        cappedTriggers.length ? `Evidence: ${cappedTriggers.join(" | ")}` : null,
    ].filter(Boolean).join(" — ");

    return truncateText(combined, MAX_REASON_CHARS);
}

function mergeSignals(leadSignals: NormalisedSignal[], companySignals: NormalisedSignal[]): NormalisedSignal[] {
    const seen = new Set<string>();
    const merged: NormalisedSignal[] = [];

    for (const s of [...leadSignals, ...companySignals]) {
        const key = `${s.type}:${s.value.toLowerCase().trim()}`;
        if (!seen.has(key)) {
            seen.add(key);
            merged.push(s);
        }
    }

    return merged.sort((a, b) => b.confidence - a.confidence);
}

function buildLeadPromptsText(leads: any[]): string {
    return leads.map((lead) => {
        const leadSignals: NormalisedSignal[] = lead.signals.map((s: any) => ({
            type: s.signalType as string,
            value: truncateText(s.value, MAX_SIGNAL_VALUE_CHARS),
            confidence: s.confidence,
            explanation: s.explanation ? truncateText(s.explanation, MAX_SIGNAL_EXPLANATION_CHARS) : null,
        }));

        const companySignals: NormalisedSignal[] = (lead.company?.signals ?? []).map((s: any) => ({
            type: s.signalType as string,
            value: truncateText(s.value, MAX_SIGNAL_VALUE_CHARS),
            confidence: s.confidence,
            explanation: s.explanation ? truncateText(s.explanation, MAX_SIGNAL_EXPLANATION_CHARS) : null,
        }));

        const allSignals = mergeSignals(leadSignals, companySignals);

        const enrichmentData = {
            ...(lead.company?.enrichmentData as Record<string, unknown> ?? {}),
            ...(lead.enrichmentData as Record<string, unknown> ?? {}),
        };

        const competitorLine = lead.competitorSignal === true
            ? `Competitor signal: YES — this prospect uses a competing product: ${(lead.competitorTech as string[] ?? []).join(", ") || "unknown"}.\n`
            : "";

        const signalSummary = allSignals.length > 0
            ? allSignals
                .map(s => `  • [${s.type}] ${s.value} (conf: ${s.confidence.toFixed(2)}) — ${s.explanation ?? ""}`)
                .join("\n")
            : "  None";

        return `---
Lead ID: ${lead.id}
Company: ${lead.companyName}
Website: ${lead.website ?? "unknown"}
Contact: ${[lead.firstName, lead.lastName].filter(Boolean).join(" ")} — ${lead.title ?? "unknown role"}
Source: ${lead.source ?? "unknown"}
${competitorLine}Signals:
${signalSummary}
Enrichment data:
${truncateJsonForPrompt(enrichmentData, MAX_ENRICHMENT_JSON_CHARS)}`;
    }).join("\n\n");
}

async function fetchScoresFromGemini(
    leadsSubset: any[],
    icpDescription: string,
    systemPrompt: string,
    campaignId: string | undefined,
): Promise<any[]> {
    const leadPromptsText = buildLeadPromptsText(leadsSubset);

    // Boxing rawResult in a container object prevents TypeScript's control flow
    // analysis from narrowing the property to `null` across closure and await
    // boundaries — CFA only narrows bare `let` variables, not mutable properties.
    const scope: { rawResult: { scores: any[] } | null } = { rawResult: null };
    let toolCallCount = 0;

    const batchScoringTool: ToolDefinition = {
        declaration: {
            name: "returnBatchResult",
            description: "Return the batch of lead scoring results.",
            parameters: {
                type: SchemaType.OBJECT,
                properties: {
                    scores: {
                        type: SchemaType.ARRAY,
                        description: "List of score results for each evaluated lead.",
                        items: {
                            type: SchemaType.OBJECT,
                            properties: {
                                leadId: {
                                    type: SchemaType.STRING,
                                    description: "The unique Lead ID from the input.",
                                },
                                qualificationReason: {
                                    type: SchemaType.STRING,
                                    description: "1–2 sentences summarising the most important reason for this score.",
                                },
                                breakdownScores: {
                                    type: SchemaType.OBJECT,
                                    description: "Per-dimension scores 0–100.",
                                    properties: {
                                        icpMatch: { type: SchemaType.NUMBER },
                                        intentStrength: { type: SchemaType.NUMBER },
                                        fundingSignals: { type: SchemaType.NUMBER },
                                        hiringVelocity: { type: SchemaType.NUMBER },
                                        techFit: { type: SchemaType.NUMBER },
                                        recency: { type: SchemaType.NUMBER },
                                    },
                                    required: ["icpMatch", "intentStrength", "fundingSignals", "hiringVelocity", "techFit", "recency"],
                                },
                                evidenceTriggers: {
                                    type: SchemaType.ARRAY,
                                    description: "2–5 specific facts that drove the score.",
                                    items: { type: SchemaType.STRING },
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
            const incomingScores = Array.isArray(args?.scores) ? args.scores : [];

            if (toolCallCount > 1) {
                logger.warn(
                    { toolCallCount, batchSize: leadsSubset.length },
                    "[lead-scoring] returnBatchResult tool was called more than once; merging results by leadId",
                );
            }

            const merged = new Map<string, any>();
            for (const s of scope.rawResult?.scores ?? []) {
                merged.set(s.leadId, s);
            }
            for (const s of incomingScores) {
                if (!s?.leadId) {
                    logger.warn(
                        { batchSize: leadsSubset.length },
                        "[lead-scoring] Gemini returned a score entry with no leadId, dropping",
                    );
                    continue;
                }
                merged.set(s.leadId, s);
            }

            scope.rawResult = { scores: [...merged.values()] };
            return args;
        },
    };

    await callGeminiWithTools<{ scores: unknown[] }>({
        agentName: "lead-scoring.batch",
        model: MODELS.RESEARCH,
        systemPrompt,
        userPrompt: `ICP: ${icpDescription}\n\nLeads to evaluate:\n${leadPromptsText}`,
        tools: [batchScoringTool],
        temperature: 0.2,
    });

    const raw = scope.rawResult;
    if (!raw || raw.scores.length === 0) {
        throw new Error(
            `Gemini returned no scores for batch of ${leadsSubset.length} leads (campaignId=${campaignId ?? "unknown"})`,
        );
    }

    if (raw.scores.length > leadsSubset.length) {
        logger.warn(
            { returnedCount: raw.scores.length, requestedCount: leadsSubset.length, campaignId },
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
    for (const sRaw of scores) {
        const leadId = sRaw?.leadId as string | undefined;
        const sourceLead = leadId ? leadsToScoreById.get(leadId) : undefined;

        if (!leadId || !sourceLead) {
            logger.warn({ leadId }, "[lead-scoring] Gemini returned an unrecognised leadId, skipping");
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
            const scoring = validateScoringResult(sRaw, resolvedWeights);
            const normalisedScore = scoring.qualificationScore / 100;
            const reasonWithTriggers = buildReasonWithTriggers(
                scoring.qualificationScore,
                scoring.qualificationReason,
                scoring.evidenceTriggers,
            );

            processedLeadIds.add(leadId);
            failedLeadIds.delete(leadId);

            updates.push({
                leadId,
                qualifies: normalisedScore >= resolvedThreshold,
                expectedUpdatedAt: sourceLead.updatedAt,
                data: {
                    qualificationScore: normalisedScore,
                    qualificationReason: reasonWithTriggers,
                    breakdownScores: scoring.breakdownScores as unknown as Prisma.InputJsonValue,
                    recommendedAction: scoring.recommendedAction,
                },
            });
        } catch (err) {
            logger.warn({ err, leadId }, "[lead-scoring] Validation failed for lead, skipping");
            failedLeadIds.add(leadId);
        }
    }
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout after ${ms}ms: ${label}`)), ms),
        ),
    ]);
}

function resolveBatchTimeoutMs(leadCount: number): number {
    return Math.max(SCORE_TIMEOUT_MS * 2, leadCount * SCORE_TIMEOUT_PER_LEAD_MS);
}

async function runWithRetries<T>(fn: () => Promise<T>, attempts: number, delayMs: number): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (attempt < attempts) await sleep(delayMs * attempt);
        }
    }
    throw lastErr;
}

function parseRetryDelayMs(err: unknown): number | null {
    if (!err || typeof err !== "object") return null;
    const e = err as Record<string, unknown>;
    if (e["status"] !== 429) return null;

    const details = e["errorDetails"];
    if (!Array.isArray(details)) return null;

    for (const detail of details) {
        if (
            detail &&
            typeof detail === "object" &&
            (detail as Record<string, unknown>)["@type"] === "type.googleapis.com/google.rpc.RetryInfo"
        ) {
            const raw = (detail as Record<string, unknown>)["retryDelay"];
            if (typeof raw === "string") {
                const seconds = parseFloat(raw.replace("s", ""));
                if (!isNaN(seconds) && seconds > 0) return Math.ceil(seconds) * 1000 + 2_000;
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
): Promise<BatchScoringOutcome> {
    for (let attempt = 1; attempt <= SCORE_RETRY_ATTEMPTS; attempt++) {
        try {
            return await withTimeout(
                scoreLeadsBatch(leadIds, icpDescription, force, qualificationThreshold),
                resolveBatchTimeoutMs(leadIds.length),
                `batchSize=${leadIds.length}`,
            );
        } catch (err) {
            if (attempt === SCORE_RETRY_ATTEMPTS) throw err;

            const serverDelayMs = parseRetryDelayMs(err);
            const exponentialDelay = Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
            const delay = serverDelayMs ?? exponentialDelay;

            logger.warn(
                { err, leadIdsCount: leadIds.length, attempt, nextRetryMs: delay, serverAdvised: serverDelayMs !== null },
                "[lead-scoring] Retrying failed batch score",
            );
            await sleep(delay);
        }
    }

    throw new Error(`batchScoreWithRetry exhausted for batch of ${leadIds.length}`);
}

function chunkArray<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
        chunks.push(arr.slice(i, i + size));
    }
    return chunks;
}

export async function runLeadScoringAgent(
    leadId: string,
    icpDescription: string,
    force = false,
    qualificationThreshold?: number,
): Promise<boolean> {
    const res = await runBatchLeadScoringAgent([leadId], icpDescription, force, qualificationThreshold);
    return res[leadId] ?? false;
}

export async function runBatchLeadScoringAgent(
    leadIds: string[],
    icpDescription: string,
    force = false,
    qualificationThreshold?: number,
): Promise<Record<string, boolean>> {
    const { results } = await scoreLeadsBatch(leadIds, icpDescription, force, qualificationThreshold);
    return results;
}

async function scoreLeadsBatch(
    leadIds: string[],
    icpDescription: string,
    force = false,
    qualificationThreshold?: number,
): Promise<BatchScoringOutcome> {
    const leads = await prisma.lead.findMany({
        where: { id: { in: leadIds } },
        include: {
            signals: { orderBy: { confidence: "desc" }, take: MAX_LEAD_SIGNALS },
            company: {
                include: {
                    signals: { orderBy: { confidence: "desc" }, take: MAX_COMPANY_SIGNALS },
                },
            },
        },
    });

    const leadsToScore = force
        ? leads
        : leads.filter(l => l.qualificationScore === null || l.recommendedAction === null);
    const uniqueCampaignIds = new Set(leadsToScore.map((l) => l.campaignId));
    if (uniqueCampaignIds.size > 1) {
        throw new Error(
            `runBatchLeadScoringAgent called with leads from ${uniqueCampaignIds.size} campaigns. ` +
            `All leads in a batch must belong to the same campaign.`,
        );
    }

    const campaignId = leadsToScore[0]?.campaignId ?? leads[0]?.campaignId;
    const resolvedThreshold = qualificationThreshold !== undefined
        ? resolveThreshold(qualificationThreshold)
        : campaignId
            ? await getCampaignQualificationThreshold(campaignId)
            : QUALIFICATION_THRESHOLD;

    const results: Record<string, boolean> = {};
    for (const l of leads) {
        results[l.id] = (l.qualificationScore ?? 0) >= resolvedThreshold;
    }

    if (leadsToScore.length === 0) {
        return { results, unscoredLeadIds: [] };
    }

    const leadsToScoreById = new Map(leadsToScore.map(l => [l.id, l]));
    const allLeadIds = leadsToScore.map(l => l.id);

    let resolvedWeights: ScoringWeights = DEFAULT_SCORING_WEIGHTS;
    let systemPrompt = LEAD_SCORING_SYSTEM_PROMPT;
    if (campaignId) {
        const weights = await prisma.campaignScoringWeights.findUnique({
            where: { campaignId },
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
                    { err, campaignId, weights },
                    "[lead-scoring] Invalid campaign scoring weights, falling back to defaults",
                );
                resolvedWeights = DEFAULT_SCORING_WEIGHTS;
            }
        }

        systemPrompt = buildScoringSystemPrompt(resolvedWeights);
    }

    const initialScores = await fetchScoresFromGemini(leadsToScore, icpDescription, systemPrompt, campaignId);

    const processedLeadIds = new Set<string>();
    const updates: PendingLeadUpdate[] = [];
    const failedLeadIds = new Set<string>();

    processScoreEntries(initialScores, leadsToScoreById, resolvedWeights, resolvedThreshold, processedLeadIds, updates, failedLeadIds);
    let missingLeadIds = allLeadIds.filter(id => !processedLeadIds.has(id));

    if (missingLeadIds.length > 0) {
        logger.warn(
            { campaignId, missingLeadIds, missingCount: missingLeadIds.length, totalCount: leadsToScore.length },
            "[lead-scoring] Some leads weren't successfully scored in the initial response, retrying just those",
        );

        try {
            const missingLeads = missingLeadIds
                .map(id => leadsToScoreById.get(id))
                .filter((l): l is NonNullable<typeof l> => l !== undefined);
            const retryScores = await fetchScoresFromGemini(missingLeads, icpDescription, systemPrompt, campaignId);
            processScoreEntries(retryScores, leadsToScoreById, resolvedWeights, resolvedThreshold, processedLeadIds, updates, failedLeadIds);
            missingLeadIds = allLeadIds.filter(id => !processedLeadIds.has(id));
        } catch (err) {
            logger.warn({ err, missingLeadIds }, "[lead-scoring] Retry for unscored leads also failed");
        }

        if (missingLeadIds.length > 0) {
            logger.warn(
                { campaignId, missingLeadIds, missingCount: missingLeadIds.length },
                "[lead-scoring] Some leads still weren't scored after retrying once",
            );
        }
    }

    const staleLeadIds: string[] = [];

    if (updates.length > 0) {
        const applyUpdates = () => prisma.$transaction(
            updates.map(u => prisma.lead.updateMany({
                where: { id: u.leadId, updatedAt: u.expectedUpdatedAt },
                data: u.data,
            })),
        );

        try {
            const txResults = await runWithRetries(applyUpdates, TRANSACTION_RETRY_ATTEMPTS, TRANSACTION_RETRY_DELAY_MS);
            txResults.forEach((r, i) => {
                const u = updates[i];
                if (r.count > 0) {
                    results[u.leadId] = u.qualifies;
                } else {
                    staleLeadIds.push(u.leadId);
                    logger.warn(
                        { leadId: u.leadId },
                        "[lead-scoring] Lead changed concurrently since it was read, skipping update",
                    );
                }
            });
        } catch (err) {
            logger.warn(
                { err, leadIds: updates.map(u => u.leadId) },
                "[lead-scoring] Transactional batch update failed after retries, falling back to per-lead updates",
            );
            const updateLimit = pLimit(UPDATE_FALLBACK_CONCURRENCY);
            const settled = await Promise.allSettled(
                updates.map((u) =>
                    updateLimit(async () => {
                        const res = await prisma.lead.updateMany({
                            where: { id: u.leadId, updatedAt: u.expectedUpdatedAt },
                            data: u.data,
                        });
                        if (res.count === 0) {
                            staleLeadIds.push(u.leadId);
                            logger.warn(
                                { leadId: u.leadId },
                                "[lead-scoring] Lead changed concurrently since it was read, skipping update",
                            );
                            return;
                        }
                        results[u.leadId] = u.qualifies;
                    }),
                ),
            );

            settled.forEach((s, i) => {
                if (s.status === "rejected") {
                    failedLeadIds.add(updates[i].leadId);
                    logger.warn(
                        { err: s.reason, leadId: updates[i].leadId },
                        "[lead-scoring] Per-lead fallback update failed",
                    );
                }
            });
        }
    }

    const unscoredLeadIds = [...new Set([...failedLeadIds, ...missingLeadIds, ...staleLeadIds])];

    if (unscoredLeadIds.length > 0) {
        logger.warn(
            { campaignId, unscoredLeadIds, unscoredCount: unscoredLeadIds.length, totalCount: leadsToScore.length },
            "[lead-scoring] Some leads in batch were not successfully scored this run",
        );
    }

    return { results, unscoredLeadIds };
}

export async function runBulkLeadScoringAgent(
    campaignId: string,
    force = false,
): Promise<{ scored: number; qualified: number; failed: number }> {
    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { icpDescription: true, qualificationThreshold: true },
    });

    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    const icpDescription = campaign.icpDescription;
    if (!icpDescription?.trim()) {
        throw new Error(`Campaign ${campaignId} has no ICP description — cannot score leads`);
    }

    const qualificationThreshold = resolveThreshold(campaign.qualificationThreshold);

    let scored = 0;
    let qualified = 0;
    let failed = 0;
    let lastCallAt = 0;
    const failedIds = new Set<string>();
    const processedIds = new Set<string>();

    const limit = pLimit(BULK_CONCURRENCY);

    while (true) {
        const excludeIds = force
            ? new Set([...processedIds, ...failedIds])
            : failedIds;

        const leads = await prisma.lead.findMany({
            where: {
                campaignId,
                deletedAt: null,
                outreachMessages: { none: {} },
                ...(excludeIds.size > 0 ? { id: { notIn: [...excludeIds] } } : {}),
                ...(force
                    ? {}
                    : {
                        AND: [
                            {
                                OR: [
                                    { qualificationScore: null },
                                    { recommendedAction: null },
                                ],
                            },
                            {
                                OR: [
                                    { recommendedAction: null },
                                    { recommendedAction: { not: "DISQUALIFY" } },
                                ],
                            },
                        ],
                    }
                ),
            },
            select: { id: true },
            orderBy: { createdAt: "asc" },
            take: BULK_BATCH_SIZE,
        });

        if (leads.length === 0) break;

        const batchIds = leads.map(l => l.id);

        if (force) {
            for (const id of batchIds) processedIds.add(id);
        }

        logger.info({ campaignId, batch: leads.length, scored, failed }, "[lead-scoring] Bulk scoring batch");

        const chunks = chunkArray(batchIds, GEMINI_BATCH_SIZE);
        const results = await Promise.allSettled(
            chunks.map((chunk) =>
                limit(async () => {
                    const now = Date.now();
                    const elapsed = now - lastCallAt;
                    if (lastCallAt > 0 && elapsed < BULK_INTER_CHUNK_DELAY_MS) {
                        await sleep(BULK_INTER_CHUNK_DELAY_MS - elapsed);
                    }
                    lastCallAt = Date.now();
                    return batchScoreWithRetry(chunk, icpDescription, force, qualificationThreshold);
                }),
            ),
        );

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            const chunk = chunks[i];
            if (result.status === "fulfilled") {
                const { results: batchRes, unscoredLeadIds } = result.value;
                const unscoredSet = new Set(unscoredLeadIds);
                for (const leadId of chunk) {
                    if (unscoredSet.has(leadId)) {
                        failed++;
                        failedIds.add(leadId);
                    } else {
                        scored++;
                        if (batchRes[leadId]) qualified++;
                    }
                }
            } else {
                for (const leadId of chunk) {
                    failed++;
                    failedIds.add(leadId);
                }
                logger.warn(
                    { err: result.reason, chunkLength: chunk.length },
                    "[lead-scoring] Lead batch failed after retries",
                );
            }
        }

        if (leads.length < BULK_BATCH_SIZE) break;
    }

    logger.info({ campaignId, scored, qualified, failed }, "[lead-scoring] Bulk scoring complete");

    return { scored, qualified, failed };
}