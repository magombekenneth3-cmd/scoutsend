import pLimit from "p-limit";
import { prisma } from "../../lib/prisma";
import { callGemini, extractJSON, MODELS } from "./gemini.client";
import { createLearningEvent } from "../learning/learning.service";
import { LEARNING_EVENT_TYPES, LEARNING_OUTCOMES } from "../../lib/constants";
import { logger } from "../../lib/logger";
import { getQualityThresholds, type QualityThresholds } from "./thresholds";

type PersonaTier = "executive" | "director" | "ic";

const PERSONA_GUIDANCE: Record<PersonaTier, string> = {
    executive:
        "C-suite or VP. Frame everything as business impact, revenue lift, risk reduction, or competitive positioning. Strip tactical detail entirely. Maximum 4 sentences. The opening must reference ROI, market position, or strategic leverage — never product features.",
    director:
        "Director or Manager. Balance strategic context with operational benefit. One sentence of team-level impact is appropriate. Up to 5 sentences. Light reference to workflow or process improvement is acceptable.",
    ic:
        "Individual contributor or unidentified title. Technical framing and practical specifics are welcome. Slightly more detail is appropriate. Up to 6 sentences. Concrete examples and tool references land well.",
};

function resolvePositiveInt(raw: string | undefined, fallback: number): number {
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const QUALITY_CONCURRENCY = resolvePositiveInt(process.env.QUALITY_CONCURRENCY, 5);
const QUALITY_BATCH_SIZE = resolvePositiveInt(process.env.QUALITY_BATCH_SIZE, 200);
const REWRITE_TIMEOUT_MS = 45_000;
const EVALUATE_TIMEOUT_MS = 20_000;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [1_000, 3_000, 8_000] as const;
const RETRY_JITTER_MS = [300, 500, 1_000] as const;
const MAX_BODY_CHARS = 4_000;
const MAX_SIGNAL_VALUE_CHARS = 200;
const MAX_QUALIFICATION_REASON_CHARS = 500;
const MAX_LEAD_CONTEXT_CHARS = 2_500;
const REWRITE_PROMPT_VERSION = "rewrite.v1";
const EVALUATE_PROMPT_VERSION = "evaluate.v1";
const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const MAX_REWRITE_PASSES = 2;
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 10;
const CIRCUIT_BREAKER_RECOVERY_MS = 60_000;
const AI_SCORE_WEIGHT = 0.6;
const HEURISTIC_SCORE_WEIGHT = 0.4;

const EVALUATE_SCHEMA = {
    type: "object",
    properties: {
        spamRiskScore: { type: "number" },
        personalizationScore: { type: "number" },
    },
    required: ["spamRiskScore", "personalizationScore"],
} as const;

const REWRITE_SCHEMA = {
    type: "object",
    properties: {
        subject: { type: "string" },
        body: { type: "string" },
        spamRiskScore: { type: "number" },
        personalizationScore: { type: "number" },
        improvementNotes: { type: "string" },
    },
    required: ["subject", "body", "spamRiskScore", "personalizationScore", "improvementNotes"],
} as const;

const SPAM_TRIGGER_PHRASES = [
    "act now",
    "act fast",
    "click here",
    "limited time",
    "100% free",
    "no obligation",
    "risk free",
    "risk-free",
    "buy now",
    "order now",
    "while supplies last",
    "cash bonus",
    "no credit check",
    "guaranteed",
    "congratulations",
    "make money fast",
    "earn money",
    "no cost to you",
    "don't miss",
];

type WorkerOutcome = "rewritten" | "held" | "skipped" | "failed";

interface WorkerResult {
    status: WorkerOutcome;
    durationMs: number;
    retryAttempts: number;
    timedOut: boolean;
}

export interface QualitySummary {
    rewritten: number;
    heldForReview: number;
    failed: number;
    totalProcessed: number;
    totalDurationMs: number;
    averageDurationMs: number;
    totalRetryAttempts: number;
    timedOutMessages: number;
    approvalRate: number;
}

export interface HeuristicQualityResult {
    spamRiskScore: number;
    personalizationScore: number;
}

interface RewriteAndScoreResult {
    subject: string;
    body: string;
    spamRiskScore: number;
    personalizationScore: number;
    improvementNotes: string;
}

interface QualityScoreResult {
    spamRiskScore: number;
    personalizationScore: number;
}

interface RetryOptions {
    attempts?: number;
    delaysMs?: readonly number[];
    jitterMs?: readonly number[];
    isRetryable?: (err: unknown) => boolean;
    onAttemptFailed?: (attempt: number, err: unknown) => void;
}

type HeldMessage = {
    id: string;
    subject: string;
    body: string;
    originalSubject: string | null;
    originalBody: string | null;
    spamRiskScore: number | null;
    personalizationScore: number | null;
    lead: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        title: string | null;
        companyName: string | null;
        website: string | null;
        qualificationReason: string | null;
        signals: Array<{ signalType: string; value: string; explanation: string | null }>;
    };
};

class QualityResponseParseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "QualityResponseParseError";
    }
}

class CircuitBreakerError extends Error {
    constructor() {
        super("Circuit breaker open — Gemini temporarily unavailable");
        this.name = "CircuitBreakerError";
    }
}

class CircuitBreaker {
    private failures = 0;
    private openedAt = 0;
    private tripped = false;

    constructor(
        private readonly failureThreshold: number,
        private readonly recoveryMs: number,
    ) { }

    guard(): void {
        if (!this.tripped) return;
        if (Date.now() - this.openedAt >= this.recoveryMs) {
            this.tripped = false;
            this.failures = 0;
            return;
        }
        throw new CircuitBreakerError();
    }

    succeed(): void {
        this.failures = 0;
        this.tripped = false;
    }

    fail(): void {
        this.failures++;
        if (this.failures >= this.failureThreshold) {
            this.tripped = true;
            this.openedAt = Date.now();
            logger.warn(
                { failures: this.failures, recoveryMs: this.recoveryMs },
                "[quality.agent] Circuit breaker tripped — Gemini calls suspended",
            );
        }
    }
}

const geminiCircuit = new CircuitBreaker(
    CIRCUIT_BREAKER_FAILURE_THRESHOLD,
    CIRCUIT_BREAKER_RECOVERY_MS,
);

function inferPersonaTier(title: string | null): PersonaTier {
    if (!title) return "ic";
    const t = title.toLowerCase();

    if (
        /\b(avp|associate vice president|associate vp|assistant vice president|assistant vp)\b/.test(
            t,
        )
    )
        return "director";

    if (
        /\b(c[eftop]o|coo|cmo|ciso|founder|owner|president|chief|evp\b|svp\b|vp\b|vice[\s-]?president|vice[\s-]?chair)\b/.test(
            t,
        )
    )
        return "executive";

    if (/\b(director|head of|manager|lead\b|principal)\b/.test(t)) return "director";

    return "ic";
}

function clampScore(value: number): number {
    return Math.min(1, Math.max(0, value));
}

function needsRewrite(
    spamRiskScore: number,
    personalizationScore: number,
    thresholds: QualityThresholds,
): boolean {
    return (
        spamRiskScore >= thresholds.spamRiskMax ||
        personalizationScore < thresholds.personalizationMin
    );
}

function truncate(text: string, maxChars: number): string {
    return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

function stripHtmlLocal(text: string): string {
    return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function repairJsonText(text: string): string {
    const withoutFences = text.replace(/```(?:json)?/gi, "");
    const start = withoutFences.indexOf("{");
    const end = withoutFences.lastIndexOf("}");
    const sliced =
        start !== -1 && end !== -1 && end > start
            ? withoutFences.slice(start, end + 1)
            : withoutFences;
    return sliced.replace(/,\s*([}\]])/g, "$1").trim();
}

function parseStructuredResponse<T>(text: string): T {
    try {
        return extractJSON<T>(text);
    } catch (firstErr) {
        try {
            return extractJSON<T>(repairJsonText(text));
        } catch {
            const reason = firstErr instanceof Error ? firstErr.message : String(firstErr);
            throw new QualityResponseParseError(`Failed to parse structured response: ${reason}`);
        }
    }
}

function extractStatusCode(err: unknown): number | undefined {
    if (typeof err !== "object" || err === null) return undefined;
    const candidate = err as { status?: unknown; statusCode?: unknown; code?: unknown };
    const value = candidate.status ?? candidate.statusCode ?? candidate.code;
    return typeof value === "number" ? value : undefined;
}

function isRetryableError(err: unknown): boolean {
    if (err instanceof CircuitBreakerError) return false;
    if (err instanceof QualityResponseParseError) return true;

    const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();

    if (
        /quota|invalid api key|unauthorized|permission denied|\b400\b|\b401\b|\b403\b|\b404\b/.test(
            message,
        )
    )
        return false;

    if (/timed out/.test(message)) return true;

    const status = extractStatusCode(err);
    if (status !== undefined) return RETRYABLE_STATUS_CODES.has(status);

    return /\b(429|500|502|503|504)\b|rate limit|too many requests|temporarily unavailable|service unavailable|bad gateway|gateway timeout|econnreset|etimedout|enotfound/.test(
        message,
    );
}

async function tryClaimMessage(messageId: string): Promise<boolean> {
    const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`
        SELECT pg_try_advisory_lock(hashtextextended(${messageId}, 0)) AS locked
    `;
    return rows[0]?.locked === true;
}

async function releaseMessageClaim(messageId: string): Promise<void> {
    try {
        await prisma.$queryRaw`SELECT pg_advisory_unlock(hashtextextended(${messageId}, 0))`;
    } catch (err) {
        logger.error({ err, messageId }, "[quality.agent] Failed to release advisory lock");
    }
}

async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
    const attempts = options.attempts ?? MAX_RETRY_ATTEMPTS;
    const delaysMs = options.delaysMs ?? RETRY_DELAYS_MS;
    const jitterMs = options.jitterMs ?? RETRY_JITTER_MS;
    const isRetryable = options.isRetryable ?? (() => true);

    let lastError: unknown;

    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            options.onAttemptFailed?.(i + 1, err);

            if (i === attempts - 1 || !isRetryable(err)) throw err;

            const baseDelay = delaysMs[i] ?? delaysMs[delaysMs.length - 1] ?? 1_000;
            const spread = jitterMs[i] ?? jitterMs[jitterMs.length - 1] ?? 0;
            const delay = Math.max(0, baseDelay + (Math.random() * 2 - 1) * spread);

            await new Promise<void>((resolve) => setTimeout(resolve, delay));
        }
    }

    throw lastError ?? new Error("unreachable");
}

function withTimeout<T>(promise: Promise<T>, ms: number, controller?: AbortController): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            controller?.abort();
            reject(new Error(`Quality agent call timed out after ${ms}ms`));
        }, ms);
    });

    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timer) clearTimeout(timer);
    });
}

function blendScores(
    aiScores: QualityScoreResult,
    heuristicScores: HeuristicQualityResult,
): QualityScoreResult {
    return {
        spamRiskScore: clampScore(
            AI_SCORE_WEIGHT * aiScores.spamRiskScore +
            HEURISTIC_SCORE_WEIGHT * heuristicScores.spamRiskScore,
        ),
        personalizationScore: clampScore(
            AI_SCORE_WEIGHT * aiScores.personalizationScore +
            HEURISTIC_SCORE_WEIGHT * heuristicScores.personalizationScore,
        ),
    };
}

export function computeHeuristicQualityScore(
    subject: string,
    body: string,
    leadContext: string,
): HeuristicQualityResult {
    const strippedBody = stripHtmlLocal(body);
    const words = strippedBody.split(/\s+/).filter((w) => /[a-zA-Z0-9]/.test(w));
    const wordCount = words.length;

    const subjectLen = subject.trim().length;
    const subjectPenalty = subjectLen < 10 || subjectLen > 80 ? 0.15 : 0;
    const wordCountPenalty = wordCount < 30 ? 0.2 : wordCount > 600 ? 0.1 : 0;

    const exclamations = (strippedBody.match(/!/g) ?? []).length;
    const exclamationPenalty = Math.min(0.25, exclamations * 0.05);

    const urlCount = (strippedBody.match(/https?:\/\/\S+/g) ?? []).length;
    const urlDensityPenalty = urlCount > 2 ? Math.min(0.2, (urlCount - 2) * 0.05) : 0;

    const firstPersonCount = (strippedBody.match(/\bI\b/g) ?? []).length;
    const firstPersonRatio = firstPersonCount / (wordCount || 1);
    const firstPersonPenalty =
        firstPersonRatio > 0.06 ? Math.min(0.15, (firstPersonRatio - 0.06) * 5) : 0;

    const capsWords = words.filter(
        (w) => w.length >= 3 && /[A-Z]/.test(w) && w === w.toUpperCase(),
    );
    const capsRatio = capsWords.length / (wordCount || 1);
    const capsPenalty = capsRatio > 0.04 ? Math.min(0.15, (capsRatio - 0.04) * 4) : 0;

    const lowerCombined = `${subject} ${strippedBody}`.toLowerCase();
    const spamPhraseHits = SPAM_TRIGGER_PHRASES.reduce(
        (count, phrase) => (lowerCombined.includes(phrase) ? count + 1 : count),
        0,
    );
    const spamPhrasePenalty = Math.min(0.25, spamPhraseHits * 0.08);

    const heuristicSpamRisk = clampScore(
        subjectPenalty +
        exclamationPenalty +
        urlDensityPenalty +
        firstPersonPenalty +
        capsPenalty +
        spamPhrasePenalty,
    );

    const leadFirstName = leadContext.match(/^Name:\s*(\S+)/m)?.[1]?.toLowerCase();
    const companyName = leadContext.match(/^Company:\s*(.+)$/m)?.[1]?.toLowerCase();
    const signalsPresent =
        leadContext.includes("Signals:") && !leadContext.includes("Signals:\nN/A");

    const namePresent = leadFirstName
        ? strippedBody.toLowerCase().includes(leadFirstName)
        : false;
    const companyPresent = companyName
        ? strippedBody.toLowerCase().includes(companyName)
        : false;

    const personalizationBonus =
        (namePresent ? 0.2 : 0) + (companyPresent ? 0.25 : 0) + (signalsPresent ? 0.15 : 0);

    const heuristicPersonalization = clampScore(0.4 + personalizationBonus - wordCountPenalty);

    return {
        spamRiskScore: heuristicSpamRisk,
        personalizationScore: heuristicPersonalization,
    };
}

function buildLeadContext(lead: HeldMessage["lead"]): string {
    const fullName =
        [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Unknown";

    const signalSummary =
        lead.signals.length > 0
            ? lead.signals
                .map(
                    (s) =>
                        `- ${s.signalType}: ${truncate(s.value, MAX_SIGNAL_VALUE_CHARS)}${s.explanation ? ` (${truncate(s.explanation, 100)})` : ""
                        }`,
                )
                .join("\n")
            : "N/A";

    const context = [
        `Name: ${fullName}`,
        `Title: ${lead.title ?? "unknown"}`,
        `Company: ${lead.companyName ?? "Unknown"}`,
        `Website: ${lead.website ?? "unknown"}`,
        `Reason: ${truncate(lead.qualificationReason ?? "N/A", MAX_QUALIFICATION_REASON_CHARS)}`,
        `Signals:\n${signalSummary}`,
    ].join("\n");

    return truncate(context, MAX_LEAD_CONTEXT_CHARS);
}

async function evaluateQuality(params: {
    messageId: string;
    campaignId: string;
    subject: string;
    body: string;
    leadContext: string;
}): Promise<QualityScoreResult> {
    const { messageId, campaignId, subject, body, leadContext } = params;
    geminiCircuit.guard();
    const controller = new AbortController();
    try {
        const { text } = await withTimeout(
            callGemini({
                agentName: "quality.evaluator",
                model: MODELS.REVIEW,
                systemPrompt: `You are a senior B2B email quality evaluator. Score the email for spam risk and personalization. Do not rewrite it.

Return ONLY JSON.

spamRiskScore: 0.0–1.0 (high = spammy). personalizationScore: 0.0–1.0 (high = tailored to recipient).`,
                userPrompt: `RECIPIENT CONTEXT:
${leadContext}

SUBJECT:
${subject}

BODY:
${truncate(body, MAX_BODY_CHARS)}`,
                metadata: { messageId, campaignId },
                temperature: 0.2,
                responseMimeType: "application/json",
                responseSchema: EVALUATE_SCHEMA,
                signal: controller.signal,
            }),
            EVALUATE_TIMEOUT_MS,
            controller,
        );
        geminiCircuit.succeed();
        const raw = parseStructuredResponse<QualityScoreResult>(text);
        return {
            spamRiskScore: clampScore(raw.spamRiskScore),
            personalizationScore: clampScore(raw.personalizationScore),
        };
    } catch (err) {
        if (!(err instanceof QualityResponseParseError)) {
            geminiCircuit.fail();
        }
        throw err;
    }
}

async function rewriteAndScore(params: {
    messageId: string;
    campaignId: string;
    originalSubject: string;
    originalBody: string;
    failedReasons: string[];
    leadContext: string;
    personaTier: PersonaTier;
    unsubscribeFooter: string;
}): Promise<RewriteAndScoreResult> {
    const {
        messageId,
        campaignId,
        originalSubject,
        originalBody,
        failedReasons,
        leadContext,
        personaTier,
        unsubscribeFooter,
    } = params;

    geminiCircuit.guard();
    const controller = new AbortController();
    try {
        const { text } = await withTimeout(
            callGemini({
                agentName: "quality.rewriter",
                model: MODELS.REVIEW,
                systemPrompt: `You are a senior B2B email editor. Rewrite emails to pass quality checks, then self-score your rewrite.

RECIPIENT PERSONA: ${PERSONA_GUIDANCE[personaTier]}

Address only the failed checks listed in the prompt. Do not change what is already working.
If an unsubscribe footer is specified, you MUST append it verbatim at the very end of the body, after two newlines. Do not change any words in the footer.

Return ONLY JSON.

spamRiskScore: 0.0–1.0 (high = spammy). personalizationScore: 0.0–1.0 (high = tailored to recipient).`,
                userPrompt: `FAILED CHECKS:
${failedReasons.join("\n")}

RECIPIENT CONTEXT:
${leadContext}

REQUIRED UNSUBSCRIBE FOOTER:
${unsubscribeFooter}

ORIGINAL SUBJECT:
${originalSubject}

ORIGINAL BODY:
${truncate(originalBody, MAX_BODY_CHARS)}`,
                metadata: { messageId, campaignId },
                temperature: 0.6,
                responseMimeType: "application/json",
                responseSchema: REWRITE_SCHEMA,
                signal: controller.signal,
            }),
            REWRITE_TIMEOUT_MS,
            controller,
        );
        geminiCircuit.succeed();
        const raw = parseStructuredResponse<RewriteAndScoreResult>(text);
        return {
            subject: raw.subject,
            body: raw.body,
            spamRiskScore: clampScore(raw.spamRiskScore),
            personalizationScore: clampScore(raw.personalizationScore),
            improvementNotes: raw.improvementNotes,
        };
    } catch (err) {
        if (!(err instanceof QualityResponseParseError)) {
            geminiCircuit.fail();
        }
        throw err;
    }
}

async function fetchHeldMessageBatch(
    campaignId: string,
    cursor: string | null,
): Promise<HeldMessage[]> {
    return prisma.outreachMessage.findMany({
        where: {
            lead: { campaignId },
            approvalStatus: "PENDING",
            deliveryState: "DRAFT",
        },
        orderBy: { id: "asc" },
        take: QUALITY_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: {
            lead: {
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    title: true,
                    companyName: true,
                    website: true,
                    qualificationReason: true,
                    signals: { orderBy: { confidence: "desc" }, take: 3 },
                },
            },
        },
    });
}

async function processMessage(
    message: HeldMessage,
    campaignId: string,
    thresholds: QualityThresholds,
    unsubscribeFooter: string,
): Promise<WorkerResult> {
    const startedAt = Date.now();
    const claimed = await tryClaimMessage(message.id);

    if (!claimed) {
        logger.info(
            { messageId: message.id, campaignId },
            "[quality.agent] Message already claimed by another worker — skipping",
        );
        return {
            status: "skipped",
            durationMs: Date.now() - startedAt,
            retryAttempts: 0,
            timedOut: false,
        };
    }

    try {
        const leadContext = buildLeadContext(message.lead);
        const personaTier = inferPersonaTier(message.lead.title);

        let spamScore = message.spamRiskScore;
        let personScore = message.personalizationScore;
        let retryAttempts = 0;
        let timedOut = false;

        const trackAttempt = (_attempt: number, err: unknown) => {
            retryAttempts++;
            if (err instanceof Error && /timed out/i.test(err.message)) timedOut = true;
        };

        if (spamScore == null || personScore == null) {
            try {
                let parseErrors = 0;
                const evaluated = await withRetry(
                    () =>
                        evaluateQuality({
                            messageId: message.id,
                            campaignId,
                            subject: message.subject,
                            body: message.body,
                            leadContext,
                        }),
                    {
                        isRetryable: (err) => {
                            if (err instanceof QualityResponseParseError)
                                return ++parseErrors <= 1;
                            return isRetryableError(err);
                        },
                        onAttemptFailed: trackAttempt,
                    },
                );
                const heuristic = computeHeuristicQualityScore(
                    message.subject,
                    message.body,
                    leadContext,
                );
                const blended = blendScores(evaluated, heuristic);
                spamScore = blended.spamRiskScore;
                personScore = blended.personalizationScore;
            } catch (err) {
                logger.warn(
                    { err, messageId: message.id, campaignId },
                    "[quality.agent] Gemini evaluation failed — falling back to heuristic",
                );
                const heuristic = computeHeuristicQualityScore(
                    message.subject,
                    message.body,
                    leadContext,
                );
                spamScore = heuristic.spamRiskScore;
                personScore = heuristic.personalizationScore;
            }
        }

        if (!needsRewrite(spamScore, personScore, thresholds)) {
            return {
                status: "skipped",
                durationMs: Date.now() - startedAt,
                retryAttempts,
                timedOut,
            };
        }

        let currentSubject = message.subject;
        let currentBody = message.body;
        let currentSpam = spamScore;
        let currentPerson = personScore;
        let rewritePasses = 0;
        let rewriteFailed = false;
        let lastImprovementNotes = "";
        let lastRewriterSelfSpam = 0;
        let lastRewriterSelfPerson = 0;

        for (
            let pass = 0;
            pass < MAX_REWRITE_PASSES && needsRewrite(currentSpam, currentPerson, thresholds);
            pass++
        ) {
            const failedReasons: string[] = [];
            if (currentSpam >= thresholds.spamRiskMax) {
                failedReasons.push(`spam too high (${currentSpam.toFixed(2)})`);
            }
            if (currentPerson < thresholds.personalizationMin) {
                failedReasons.push(`personalization too low (${currentPerson.toFixed(2)})`);
            }

            let rewriteParseErrors = 0;
            let rewrite: RewriteAndScoreResult;
            try {
                rewrite = await withRetry(
                    () =>
                        rewriteAndScore({
                            messageId: message.id,
                            campaignId,
                            originalSubject: currentSubject,
                            originalBody: currentBody,
                            failedReasons,
                            leadContext,
                            personaTier,
                            unsubscribeFooter,
                        }),
                    {
                        isRetryable: (err) => {
                            if (err instanceof QualityResponseParseError)
                                return ++rewriteParseErrors <= 1;
                            return isRetryableError(err);
                        },
                        onAttemptFailed: trackAttempt,
                    },
                );
            } catch (err) {
                logger.warn(
                    { err, messageId: message.id, campaignId },
                    "[quality.agent] Rewrite failed — holding message for manual review",
                );
                rewriteFailed = true;
                break;
            }

            const rewriteHeuristic = computeHeuristicQualityScore(
                rewrite.subject,
                rewrite.body,
                leadContext,
            );

            let reEvaluated: QualityScoreResult;
            try {
                let evalParseErrors = 0;
                reEvaluated = await withRetry(
                    () =>
                        evaluateQuality({
                            messageId: message.id,
                            campaignId,
                            subject: rewrite.subject,
                            body: rewrite.body,
                            leadContext,
                        }),
                    {
                        isRetryable: (err) => {
                            if (err instanceof QualityResponseParseError)
                                return ++evalParseErrors <= 1;
                            return isRetryableError(err);
                        },
                        onAttemptFailed: trackAttempt,
                    },
                );
            } catch (err) {
                logger.warn(
                    { err, messageId: message.id, campaignId },
                    "[quality.agent] Post-rewrite evaluation failed — falling back to heuristic",
                );
                reEvaluated = {
                    spamRiskScore: rewriteHeuristic.spamRiskScore,
                    personalizationScore: rewriteHeuristic.personalizationScore,
                };
            }

            const blended = blendScores(reEvaluated, rewriteHeuristic);

            currentSubject = rewrite.subject;
            currentBody = rewrite.body;
            currentSpam = blended.spamRiskScore;
            currentPerson = blended.personalizationScore;
            lastImprovementNotes = rewrite.improvementNotes;
            lastRewriterSelfSpam = rewrite.spamRiskScore;
            lastRewriterSelfPerson = rewrite.personalizationScore;
            rewritePasses++;
        }

        const approved = !rewriteFailed && !needsRewrite(currentSpam, currentPerson, thresholds);

        const { count } = await prisma.outreachMessage.updateMany({
            where: { id: message.id, approvalStatus: "PENDING", deliveryState: "DRAFT" },
            data: {
                originalSubject: message.originalSubject ?? message.subject,
                originalBody: message.originalBody ?? message.body,
                subject: currentSubject,
                body: currentBody,
                spamRiskScore: currentSpam,
                personalizationScore: currentPerson,
                approvalStatus: approved ? "APPROVED" : "PENDING",
                deliveryState: approved ? "QUEUED" : "DRAFT",
            },
        });

        if (count === 0) {
            logger.warn(
                { messageId: message.id, campaignId },
                "[quality.agent] Optimistic lock miss — skipping stale update",
            );
            return {
                status: "skipped",
                durationMs: Date.now() - startedAt,
                retryAttempts,
                timedOut,
            };
        }

        try {
            await createLearningEvent({
                eventType: LEARNING_EVENT_TYPES.REVIEW_FLAGGED,
                originalOutput: JSON.stringify({ subject: message.subject, body: message.body }),
                modifiedOutput: JSON.stringify({
                    subject: currentSubject,
                    body: currentBody,
                    improvementNotes: lastImprovementNotes,
                }),
                outcome: approved ? LEARNING_OUTCOMES.APPROVED : LEARNING_OUTCOMES.PENDING_REVIEW,
                outreachMessageId: message.id,
                metadata: {
                    originalSpam: message.spamRiskScore,
                    originalPerson: message.personalizationScore,
                    rewriteSpam: currentSpam,
                    rewritePerson: currentPerson,
                    rewriterSelfSpam: lastRewriterSelfSpam,
                    rewriterSelfPerson: lastRewriterSelfPerson,
                    rewritePassedThresholds: approved,
                    rewritePasses,
                    rewriteFailed,
                    personaTier,
                    model: MODELS.REVIEW,
                    rewritePromptVersion: REWRITE_PROMPT_VERSION,
                    evaluatePromptVersion: EVALUATE_PROMPT_VERSION,
                    retryAttempts,
                    durationMs: Date.now() - startedAt,
                    thresholds: {
                        spamRiskMax: thresholds.spamRiskMax,
                        personalizationMin: thresholds.personalizationMin,
                    },
                },
            });
        } catch (err) {
            logger.error(
                { err, messageId: message.id, campaignId },
                "[quality.agent] Learning event failed — message update already committed",
            );
        }

        return {
            status: approved ? "rewritten" : "held",
            durationMs: Date.now() - startedAt,
            retryAttempts,
            timedOut,
        };
    } finally {
        await releaseMessageClaim(message.id);
    }
}

export async function runQualityAgent(campaignId: string): Promise<QualitySummary> {
    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { id: true, createdById: true },
    });

    if (!campaign) throw new Error("Campaign not found");

    const brandSettings = await prisma.brandSettings.findUnique({
        where: { userId: campaign.createdById },
        select: { unsubscribeText: true },
    });
    const unsubscribeFooter =
        brandSettings?.unsubscribeText ??
        "You received this email because you match our ideal customer profile. To unsubscribe, reply with 'unsubscribe'.";

    const thresholds = await getQualityThresholds(campaignId);
    const limit = pLimit(QUALITY_CONCURRENCY);

    let rewritten = 0;
    let heldForReview = 0;
    let failed = 0;
    let totalProcessed = 0;
    let totalDurationMs = 0;
    let totalRetryAttempts = 0;
    let timedOutMessages = 0;
    let cursor: string | null = null;

    while (true) {
        const batch = await fetchHeldMessageBatch(campaignId, cursor);
        if (batch.length === 0) break;

        const results = await Promise.allSettled(
            batch.map((message) =>
                limit(async (): Promise<WorkerResult> => {
                    try {
                        return await processMessage(message, campaignId, thresholds, unsubscribeFooter);
                    } catch (err) {
                        logger.error(
                            { err, messageId: message.id, leadId: message.lead.id, campaignId },
                            "[quality.agent] Message processing failed",
                        );
                        return {
                            status: "failed",
                            durationMs: 0,
                            retryAttempts: 0,
                            timedOut: false,
                        };
                    }
                }),
            ),
        );

        for (const result of results) {
            if (result.status === "rejected") {
                failed++;
                continue;
            }

            totalDurationMs += result.value.durationMs;
            totalRetryAttempts += result.value.retryAttempts;
            if (result.value.timedOut) timedOutMessages++;

            switch (result.value.status) {
                case "rewritten": rewritten++; break;
                case "held": heldForReview++; break;
                case "failed": failed++; break;
                case "skipped": break;
            }
        }

        totalProcessed += batch.length;

        const nextCursor: string | null = batch[batch.length - 1]?.id ?? cursor;
        if (nextCursor === cursor) break;
        cursor = nextCursor;

        if (batch.length < QUALITY_BATCH_SIZE) break;
    }

    const averageDurationMs = totalProcessed > 0 ? totalDurationMs / totalProcessed : 0;
    const approvalRate =
        rewritten + heldForReview > 0 ? rewritten / (rewritten + heldForReview) : 0;

    logger.info(
        {
            campaignId,
            rewritten,
            heldForReview,
            failed,
            totalProcessed,
            averageDurationMs,
            totalRetryAttempts,
            timedOutMessages,
            approvalRate,
        },
        "[quality.agent] Run complete",
    );

    return {
        rewritten,
        heldForReview,
        failed,
        totalProcessed,
        totalDurationMs,
        averageDurationMs,
        totalRetryAttempts,
        timedOutMessages,
        approvalRate,
    };
}