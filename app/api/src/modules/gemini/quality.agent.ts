import pLimit from "p-limit";
import { createHash } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { redis } from "../../lib/ioredis";
import { MODELS } from "./gemini.client";
import {
    callGateway,
    createProposalHash,
    type QualityEvaluatorOutput,
    QualityEvaluatorOutputSchema,
    type QualityRewriterOutput,
    QualityRewriterOutputSchema,
} from "../../lib/llm-gateway";
import { executeProposalOnce } from "../proposal-execution/proposal-execution.service";
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
const REEVAL_VARIANCE_THRESHOLD = 0.15;
const CLAIM_LOCK_TTL_MS = REWRITE_TIMEOUT_MS * MAX_REWRITE_PASSES + EVALUATE_TIMEOUT_MS + 10_000;
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 10;
const CIRCUIT_BREAKER_RECOVERY_MS = 60_000;
const AI_SCORE_WEIGHT = 0.6;
const HEURISTIC_SCORE_WEIGHT = 0.4;

// (EVALUATE_SCHEMA and REWRITE_SCHEMA removed — P0-A: replaced by QualityEvaluatorOutputSchema
// and QualityRewriterOutputSchema Zod schemas exported from the llm-gateway barrel)

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
    senderMailboxId?: string | null;
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

// (repairJsonText and parseStructuredResponse removed — P0-A: Zod validation via callGateway
// replaces manual JSON text parsing from raw callGemini output)

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

const CLAIM_LOCK_PREFIX = "quality:claim:";

const RELEASE_LOCK_SCRIPT = `
  if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
  else
    return 0
  end
`;

async function tryClaimMessage(messageId: string, token: string): Promise<boolean> {
    const key = `${CLAIM_LOCK_PREFIX}${messageId}`;
    const result = await redis.set(key, token, "PX", CLAIM_LOCK_TTL_MS, "NX");
    return result === "OK";
}

async function releaseMessageClaim(messageId: string, token: string): Promise<void> {
    const key = `${CLAIM_LOCK_PREFIX}${messageId}`;
    try {
        await redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token);
    } catch (err) {
        logger.error({ err, messageId }, "[quality.agent] Failed to release Redis claim lock");
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
    personaTier?: PersonaTier,
): HeuristicQualityResult {
    const strippedBody = stripHtmlLocal(body);
    const words = strippedBody.split(/\s+/).filter((w) => /[a-zA-Z0-9]/.test(w));
    const wordCount = words.length;

    const subjectLen = subject.trim().length;
    const subjectPenalty = subjectLen < 10 || subjectLen > 80 ? 0.15 : 0;

    const wordCountFloor = personaTier === "executive" ? 12 : personaTier === "director" ? 20 : 30;
    const wordCountPenalty = wordCount < wordCountFloor ? 0.2 : wordCount > 600 ? 0.1 : 0;

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
        const proposal = await withTimeout(
            callGateway<QualityEvaluatorOutput>({
                agentName: "quality.evaluator",
                model: MODELS.REVIEW,
                responseMode: "structured",
                outputSchema: QualityEvaluatorOutputSchema,
                systemPrompt: `You are a senior B2B email quality evaluator. Score the email for spam risk and personalization. Do not rewrite it.

Return ONLY JSON.

spamRiskScore: 0.0–1.0 (high = spammy). personalizationScore: 0.0–1.0 (high = tailored to recipient).`,
                userPrompt: `RECIPIENT CONTEXT:
${leadContext}

SUBJECT:
${subject}

BODY:
${truncate(body, MAX_BODY_CHARS)}`,
                proposalContext: { leadId: undefined, campaignId },
                metadata: { messageId, campaignId },
                temperature: 0.2,
            }),
            EVALUATE_TIMEOUT_MS,
            controller,
        );
        geminiCircuit.succeed();
        return {
            spamRiskScore: clampScore(proposal.payload.spamRiskScore),
            personalizationScore: clampScore(proposal.payload.personalizationScore),
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
        const proposal = await withTimeout(
            callGateway<QualityRewriterOutput>({
                agentName: "quality.rewriter",
                model: MODELS.REVIEW,
                responseMode: "structured",
                outputSchema: QualityRewriterOutputSchema,
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
                proposalContext: { leadId: undefined, campaignId },
                metadata: { messageId, campaignId },
                temperature: 0.6,
            }),
            REWRITE_TIMEOUT_MS,
            controller,
        );
        geminiCircuit.succeed();
        return {
            subject: proposal.payload.subject,
            body: proposal.payload.body,
            spamRiskScore: clampScore(proposal.payload.spamRiskScore),
            personalizationScore: clampScore(proposal.payload.personalizationScore),
            improvementNotes: proposal.payload.improvementNotes,
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
        select: {
            id: true,
            subject: true,
            body: true,
            originalSubject: true,
            originalBody: true,
            spamRiskScore: true,
            personalizationScore: true,
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
    orgId: string | null,
    thresholds: QualityThresholds,
    unsubscribeFooter: string,
): Promise<WorkerResult> {
    const startedAt = Date.now();
    const claimToken = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const claimed = await tryClaimMessage(message.id, claimToken);

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
                personaTier,
            );

            const rewriterSelfScores: QualityScoreResult = {
                spamRiskScore: rewrite.spamRiskScore,
                personalizationScore: rewrite.personalizationScore,
            };

            const spamVariance = Math.abs(rewriterSelfScores.spamRiskScore - rewriteHeuristic.spamRiskScore);
            const personVariance = Math.abs(rewriterSelfScores.personalizationScore - rewriteHeuristic.personalizationScore);
            const highVariance = spamVariance > REEVAL_VARIANCE_THRESHOLD || personVariance > REEVAL_VARIANCE_THRESHOLD;

            let reEvaluated: QualityScoreResult;
            if (highVariance) {
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
                        "[quality.agent] Post-rewrite evaluation failed — falling back to rewriter self-score",
                    );
                    reEvaluated = rewriterSelfScores;
                }
            } else {
                reEvaluated = rewriterSelfScores;
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

        const mailboxHealthy = true;

        const approved = !rewriteFailed && !needsRewrite(currentSpam, currentPerson, thresholds) && mailboxHealthy;

        // ── P0-A: Authoritative PENDING/DRAFT → APPROVED/QUEUED state transition ───
        // This transition must be protected by executeProposalOnce().
        //
        // proposalId: stable for this (message, agent, rewrite content) tuple
        //   - messageId is the resource being updated
        //   - currentSubject+currentBody hash encodes the exact content being approved
        //   - This ensures a different rewrite pass produces a different proposalId
        // resource: { type: "OUTREACH_MESSAGE", id: message.id }
        //   - The existing message is the resource. On idempotent replay, this ID is returned.
        // reloadAndVerifyContext: TOCTOU check — re-read DB state before committing.
        //   - If message is no longer PENDING/DRAFT (was approved/rejected elsewhere),
        //     the updateMany inside executeMutation will affect 0 rows (detected below).
        // The Redis claim lock (tryClaimMessage) is preserved as a secondary guard.
        // ────────────────────────────────────────────────────────────────────────────

        const contentFingerprint = createHash("sha256")
            .update(`${message.id}:${currentSubject}:${currentBody}`)
            .digest("hex")
            .slice(0, 16);

        const proposalPayload = {
            messageId: message.id,
            subject: currentSubject,
            body: currentBody,
            spamRiskScore: currentSpam,
            personalizationScore: currentPerson,
            approved,
        };

        const agentName = "quality.agent" as const;
        const contextHash = "" as const;
        const validHash = createProposalHash({
            agentName,
            requestFingerprint: contentFingerprint,
            contextHash,
            payload: proposalPayload,
        });

        const qualityProposal = {
            proposalId: `quality.approval:${message.id}:${contentFingerprint}`,
            agentName,
            payload: proposalPayload,
            contextHash,
            requestFingerprint: contentFingerprint,
            proposedAt: new Date(),
            expiresAt: new Date(Date.now() + 15 * 60 * 1000),
            tokenUsage: { input: 0, output: 0, total: 0 },
            latencyMs: 0,
            proposalHash: validHash,
        } as const;

        const execution = await executeProposalOnce({
            proposal: qualityProposal,
            reloadAndVerifyContext: async () => {
                // TOCTOU: re-read the message from the database to confirm it is
                // still PENDING/DRAFT before allowing the state transition.
                const current = await prisma.outreachMessage.findUnique({
                    where: { id: message.id },
                    select: { approvalStatus: true, deliveryState: true },
                });
                if (!current) {
                    throw new Error(
                        `[quality.agent] TOCTOU: message ${message.id} not found — aborting state transition`,
                    );
                }
                if (current.approvalStatus !== "PENDING" || current.deliveryState !== "DRAFT") {
                    throw new Error(
                        `[quality.agent] TOCTOU: message ${message.id} is no longer PENDING/DRAFT (` +
                        `approvalStatus=${current.approvalStatus}, deliveryState=${current.deliveryState}) ` +
                        `— aborting to prevent duplicate state transition`,
                    );
                }
            },
            executeMutation: async (tx) => {
                const { count } = await tx.outreachMessage.updateMany({
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
                    // Concurrent write won the race — treat as stale
                    throw new Error(
                        `[quality.agent] Optimistic lock miss inside executeProposalOnce — message ${message.id} was modified concurrently`,
                    );
                }

                return {
                    result: { approved, count },
                    resource: { type: "OUTREACH_MESSAGE", id: message.id },
                };
            },
        });

        const mutationSucceeded = execution.status === "SUCCEEDED" || execution.isIdempotentReplay;

        if (!mutationSucceeded) {
            logger.warn(
                { messageId: message.id, campaignId, status: execution.status },
                "[quality.agent] executeProposalOnce did not succeed — skipping message",
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
                orgId: orgId ?? undefined,
                campaignId,
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
        await releaseMessageClaim(message.id, claimToken);
    }
}

export async function runQualityAgent(campaignId: string): Promise<QualitySummary> {
    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { id: true, createdById: true, orgId: true },
    });

    if (!campaign) throw new Error("Campaign not found");

    const orgId = campaign.orgId;

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
                        return await processMessage(message, campaignId, orgId, thresholds, unsubscribeFooter);
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