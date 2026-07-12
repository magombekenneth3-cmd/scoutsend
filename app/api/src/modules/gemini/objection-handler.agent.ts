import pLimit from "p-limit";
import { prisma } from "../../lib/prisma";
import { callGemini, extractJSON, MODELS } from "./gemini.client";
import { logger } from "../../lib/logger";
import { ReplyIntent, DraftReply } from "./reply.agent";
import { getWinPatterns, WinPattern } from "../memory/memory.service";

export type ObjectionCategory =
    | "PRICING"
    | "TIMING"
    | "INCUMBENT_VENDOR"
    | "NO_NEED"
    | "DECISION_MAKER"
    | "MORE_INFO"
    | "GENERAL_INTEREST"
    | "NONE";

const OBJECTION_CATEGORIES: readonly ObjectionCategory[] = [
    "PRICING",
    "TIMING",
    "INCUMBENT_VENDOR",
    "NO_NEED",
    "DECISION_MAKER",
    "MORE_INFO",
    "GENERAL_INTEREST",
    "NONE",
];

interface ObjectionAnalysis {
    category: ObjectionCategory;
    secondaryCategory: ObjectionCategory | null;
    extractedObjection: string;
}

export interface ObjectionAwareDraftResult extends DraftReply {
    objectionCategory: ObjectionCategory;
    secondaryObjectionCategory?: ObjectionCategory | null;
}

export type ObjectionFrameworkOverrides = Partial<Record<ObjectionCategory, string>>;

const BATCH_CONCURRENCY = 4;
const GEMINI_TIMEOUT_MS = 25_000;
const GEMINI_COMPLEXITY_TIMEOUT_MS = 15_000;
const GEMINI_MAX_ATTEMPTS = 3;
const GEMINI_RETRY_BASE_DELAY_MS = 500;
const GEMINI_RETRY_MAX_DELAY_MS = 4_000;
const MAX_CUSTOM_FRAMEWORK_CHARS = 600;

const OBJECTION_FRAMEWORKS: Record<ObjectionCategory, string> = {
    PRICING:
        "Acknowledge cost is a real consideration. Reframe around ROI or cost of the problem they already have. Offer a scoped pilot or next step that reduces commitment. Do not include calendar links or specific time slots.",
    TIMING:
        "Validate their timing concern without accepting it as final. Ask what would need to be true for this to be a priority. Leave the door open with a specific future touchpoint. Do not include calendar links or specific time slots.",
    INCUMBENT_VENDOR:
        "Don't attack the incumbent. Ask one curious question about what they'd change if they could. Position as additive, not replacement. Do not include calendar links or specific time slots.",
    DECISION_MAKER:
        "Acknowledge and ask who the right person is. Offer to help with a brief intro message or one-pager they can forward. Do not include calendar links or specific time slots.",
    NO_NEED:
        "Thank them for the clarity. Ask one polite question: whether there is a better person in their org this would be relevant to. If they confirm no fit exists, bow out gracefully with no pressure. Keep it very short. Do not include calendar links or specific time slots.",
    MORE_INFO:
        "Answer the question directly and concisely — one paragraph max. Then suggest a brief call over the next week or two as the fastest path to address their other questions, asking what works for them.",
    GENERAL_INTEREST:
        "Match their energy, be warm. Move toward a concrete next step: suggest a brief call over the next week or two, and let them know you'll send a calendar invite accordingly.",
    NONE:
        "Write a warm, professional reply. Move toward a concrete next step: suggest a brief call over the next week or two, and let them know you'll send a calendar invite accordingly.",
};

function isObjectionCategory(value: unknown): value is ObjectionCategory {
    return typeof value === "string" && OBJECTION_CATEGORIES.includes(value as ObjectionCategory);
}

function isValidObjectionCore(value: unknown): value is Record<string, unknown> {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    return isObjectionCategory(v.category) && typeof v.extractedObjection === "string";
}

function isValidDraftReply(value: unknown): value is DraftReply {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v.subject === "string" &&
        v.subject.trim().length > 0 &&
        typeof v.body === "string" &&
        v.body.trim().length > 0
    );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: NodeJS.Timeout;

    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error(`Timeout after ${timeoutMs}ms`)),
                    timeoutMs,
                );
            }),
        ]);
    } finally {
        clearTimeout(timer!);
    }
}

function isRetryableGeminiError(err: unknown): boolean {
    if (!(err instanceof Error)) return false;
    if (err.message.startsWith("Timeout after")) return true;

    const status =
        (err as { status?: unknown }).status ??
        (err as { statusCode?: unknown }).statusCode ??
        (err as { code?: unknown }).code;

    if (typeof status === "number" && (status === 429 || status >= 500)) return true;

    const message = err.message.toLowerCase();
    return (
        message.includes("429") ||
        message.includes("rate limit") ||
        message.includes("resource_exhausted") ||
        message.includes("econnreset") ||
        message.includes("etimedout") ||
        message.includes("unavailable") ||
        message.includes("deadline exceeded")
    );
}

function computeRetryDelayMs(attempt: number): number {
    const base = Math.min(
        GEMINI_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
        GEMINI_RETRY_MAX_DELAY_MS,
    );
    const jitter = 0.75 + Math.random() * 0.5;
    return Math.round(base * jitter);
}

async function callGeminiWithResilience<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt++) {
        try {
            return await withTimeout(operation(), timeoutMs);
        } catch (err) {
            lastError = err;
            if (attempt === GEMINI_MAX_ATTEMPTS || !isRetryableGeminiError(err)) {
                throw err;
            }
            logger.warn(
                {
                    attempt,
                    maxAttempts: GEMINI_MAX_ATTEMPTS,
                    err: err instanceof Error ? err.message : String(err),
                },
                "[objection-handler.agent] Gemini call failed — retrying",
            );
            await new Promise((resolve) => setTimeout(resolve, computeRetryDelayMs(attempt)));
        }
    }

    throw lastError;
}

function resolveFramework(
    category: ObjectionCategory,
    overrides: ObjectionFrameworkOverrides | undefined,
): string {
    const custom = overrides?.[category]?.trim();
    if (custom && custom.length > 0) {
        return custom.length > MAX_CUSTOM_FRAMEWORK_CHARS
            ? `${custom.slice(0, MAX_CUSTOM_FRAMEWORK_CHARS)}…`
            : custom;
    }
    return OBJECTION_FRAMEWORKS[category] ?? OBJECTION_FRAMEWORKS.NONE;
}

function resolveDraftTimeoutMs(params: { hasWinPatterns: boolean; isHybridObjection: boolean }): number {
    const extra =
        (params.hasWinPatterns ? GEMINI_COMPLEXITY_TIMEOUT_MS / 2 : 0) +
        (params.isHybridObjection ? GEMINI_COMPLEXITY_TIMEOUT_MS / 2 : 0);
    return GEMINI_TIMEOUT_MS + extra;
}

async function detectObjection(params: {
    replyBody: string;
    intent: ReplyIntent;
    messageId: string;
}): Promise<ObjectionAnalysis> {
    const { replyBody, intent, messageId } = params;

    let text: string;
    try {
        ({ text } = await callGeminiWithResilience(
            () =>
                callGemini({
                    agentName: "objection-handler.detector",
                    model: MODELS.REVIEW,
                    systemPrompt: `You are a B2B sales objection analyst. Classify the objection(s) in a prospect's reply.

Return ONLY JSON:
{
  "category": one of "PRICING" | "TIMING" | "INCUMBENT_VENDOR" | "NO_NEED" | "DECISION_MAKER" | "MORE_INFO" | "GENERAL_INTEREST" | "NONE",
  "secondaryCategory": one of the same values except "NONE", or null — only set this if a second, genuinely distinct objection is also present,
  "extractedObjection": string — the exact objection in 1 sentence, or empty string if none
}

Category definitions:
- PRICING: mentions cost, budget, expensive, can't justify
- TIMING: not now, bad timing, next quarter, too busy
- INCUMBENT_VENDOR: already have a solution, using a competitor
- NO_NEED: don't need this, not relevant, not a priority
- DECISION_MAKER: not the right person, need to check with someone
- MORE_INFO: asking a specific question about the product/service
- GENERAL_INTEREST: interested but no specific objection
- NONE: clear positive with no friction

Most replies carry a single objection — leave secondaryCategory null unless the prospect clearly raises two separate concerns (for example, pricing alongside bad timing).`,
                    userPrompt: `Intent: ${intent}\n\nReply:\n${replyBody}`,
                    metadata: { messageId },
                    temperature: 0.1,
                }),
            GEMINI_TIMEOUT_MS,
        ));
    } catch (err) {
        logger.warn(
            { messageId, err: err instanceof Error ? err.message : String(err) },
            "[objection-handler.agent] Objection detection failed — falling back to NONE",
        );
        return { category: "NONE", secondaryCategory: null, extractedObjection: "" };
    }

    const parsed = extractJSON<Record<string, unknown>>(text);

    if (!isValidObjectionCore(parsed)) {
        logger.warn(
            { messageId },
            "[objection-handler.agent] Invalid ObjectionAnalysis from Gemini — falling back to NONE",
        );
        return { category: "NONE", secondaryCategory: null, extractedObjection: "" };
    }

    const category = parsed.category as ObjectionCategory;
    const extractedObjection = parsed.extractedObjection as string;
    const rawSecondary = parsed.secondaryCategory;

    let secondaryCategory: ObjectionCategory | null = null;
    if (
        category !== "NONE" &&
        isObjectionCategory(rawSecondary) &&
        rawSecondary !== "NONE" &&
        rawSecondary !== category
    ) {
        secondaryCategory = rawSecondary;
    }

    return { category, secondaryCategory, extractedObjection };
}

async function generateDraftWithFramework(params: {
    objection: ObjectionAnalysis;
    originalSubject: string;
    leadFirstName?: string;
    companyName?: string;
    title?: string;
    replyBody: string;
    messageId: string;
    winPatterns?: WinPattern[];
    frameworkOverrides?: ObjectionFrameworkOverrides;
}): Promise<DraftReply> {
    const {
        objection,
        originalSubject,
        leadFirstName,
        companyName,
        title,
        replyBody,
        messageId,
        winPatterns,
        frameworkOverrides,
    } = params;

    const secondaryCategory = objection.secondaryCategory;

    const primaryFramework = resolveFramework(objection.category, frameworkOverrides);
    const secondaryFramework = secondaryCategory
        ? resolveFramework(secondaryCategory, frameworkOverrides)
        : null;

    const framework = secondaryFramework
        ? `Primary concern (${objection.category}): ${primaryFramework}\nThey also raised a secondary concern (${secondaryCategory}): ${secondaryFramework}\nLead with the primary concern. Acknowledge the secondary one in no more than a single clause so the reply stays focused.`
        : primaryFramework;

    const winPatternsBlock =
        winPatterns && winPatterns.length > 0
            ? "\n\nWINNING REPLY PATTERNS — these structures unlocked positive responses from similar accounts. Use for tonal inspiration only:\n" +
            winPatterns
                .map(
                    (p, i) =>
                        `Pattern ${i + 1} (${p.replyIntent}, recency: ${p.recencyScore}):\n` +
                        `  Signal that worked: ${p.signalType}\n` +
                        `  Subject framing: ${p.subjectPattern}\n` +
                        `  Opening structure: ${p.bodyOpeningPattern}\n` +
                        `  Tone: ${p.tone ?? "unspecified"}`
                )
                .join("\n\n")
            : "";

    const timeoutMs = resolveDraftTimeoutMs({
        hasWinPatterns: Boolean(winPatterns && winPatterns.length > 0),
        isHybridObjection: Boolean(secondaryCategory),
    });

    const { text } = await callGeminiWithResilience(
        () =>
            callGemini({
                agentName: "objection-handler.drafter",
                model: MODELS.REVIEW,
                systemPrompt: `You are a senior B2B sales rep drafting a reply to a prospect's inbound email.

Rules:
- Be concise (3–5 sentences max)
- Warm but professional tone
- Never mention AI
- Never start with "I"
- Never include a calendar scheduling link (presumptuous)
- Never suggest specific time slots or short timelines (like "tomorrow" or "Monday at 1 PM")
- Close with this polite timing formula: "Do you have time over the next week or two to learn more? Let me know what works for you and I'll send a calendar invite along accordingly."
- Apply the response framework provided — it is your strategic guide for this reply
- If win patterns are provided, let them guide your tone and framing — do not copy them verbatim${winPatternsBlock}

Return ONLY JSON:
{
  "subject": string,
  "body": string
}`,
                userPrompt: `Response framework: ${framework}

Objection detected: ${objection.extractedObjection || "none"}

Original subject: ${originalSubject}
Lead: ${leadFirstName ?? "there"} at ${companyName ?? "their company"}
Their title: ${title ?? "unknown"}

Their reply:
${replyBody}`,
                metadata: {
                    messageId,
                    objectionCategory: objection.category,
                    secondaryObjectionCategory: secondaryCategory ?? undefined,
                },
                temperature: 0.5,
            }),
        timeoutMs,
    );

    const parsed = extractJSON<DraftReply>(text);

    if (!isValidDraftReply(parsed)) {
        throw new Error(
            `[objection-handler.agent] Invalid DraftReply from Gemini for message ${messageId}`,
        );
    }

    return {
        ...parsed,
        subject: parsed.subject.trim(),
        body: parsed.body.trim(),
    };
}

export async function generateObjectionAwareDraftFromContext(params: {
    replyBody: string;
    intent: ReplyIntent;
    originalSubject: string;
    leadFirstName?: string;
    companyName?: string;
    title?: string;
    messageId: string;
    targetIndustry?: string;
    targetRegion?: string;
    frameworkOverrides?: ObjectionFrameworkOverrides;
}): Promise<ObjectionAwareDraftResult> {
    const {
        replyBody,
        intent,
        originalSubject,
        leadFirstName,
        companyName,
        title,
        messageId,
        targetIndustry,
        targetRegion,
        frameworkOverrides,
    } = params;

    const [objection, winPatterns] = await Promise.all([
        detectObjection({ replyBody, intent, messageId }),
        getWinPatterns({ targetIndustry, targetRegion, limit: 3 }).catch(() => []),
    ]);

    logger.info(
        {
            messageId,
            objectionCategory: objection.category,
            secondaryObjectionCategory: objection.secondaryCategory,
            intent,
        },
        "[objection-handler.agent] Objection detected (context path)"
    );

    const draft = await generateDraftWithFramework({
        objection,
        originalSubject,
        leadFirstName,
        companyName,
        title,
        replyBody,
        messageId,
        winPatterns,
        frameworkOverrides,
    });

    return {
        subject: draft.subject,
        body: draft.body,
        objectionCategory: objection.category,
        secondaryObjectionCategory: objection.secondaryCategory,
    };
}

export async function generateObjectionAwareDraft(params: {
    replyId: string;
    frameworkOverrides?: ObjectionFrameworkOverrides;
}): Promise<ObjectionAwareDraftResult | null> {
    const reply = await prisma.reply.findUnique({
        where: { id: params.replyId },
        include: {
            outreachMessage: {
                select: { subject: true, body: true },
            },
            lead: {
                select: {
                    firstName: true,
                    lastName: true,
                    companyName: true,
                    title: true,
                    campaign: {
                        select: {
                            targetIndustry: true,
                            targetRegion: true,
                        },
                    },
                },
            },
        },
    });

    if (!reply) {
        logger.warn({ replyId: params.replyId }, "[objection-handler.agent] Reply not found");
        return null;
    }

    if (reply.draftBody) {
        logger.info(
            { replyId: params.replyId },
            "[objection-handler.agent] Draft already exists — skipping"
        );
        return null;
    }

    const intent = reply.intent as ReplyIntent;

    const [objection, winPatterns] = await Promise.all([
        detectObjection({
            replyBody: reply.body,
            intent,
            messageId: reply.outreachMessageId,
        }),
        getWinPatterns({
            targetIndustry: reply.lead.campaign?.targetIndustry ?? undefined,
            targetRegion: reply.lead.campaign?.targetRegion ?? undefined,
            limit: 3,
        }).catch(() => []),
    ]);

    logger.info(
        {
            replyId: params.replyId,
            objectionCategory: objection.category,
            secondaryObjectionCategory: objection.secondaryCategory,
            winPatternCount: winPatterns.length,
        },
        "[objection-handler.agent] Objection detected (db path)"
    );

    const draft = await generateDraftWithFramework({
        objection,
        originalSubject: reply.outreachMessage.subject,
        leadFirstName: reply.lead.firstName ?? undefined,
        companyName: reply.lead.companyName,
        title: reply.lead.title ?? undefined,
        replyBody: reply.body,
        messageId: reply.outreachMessageId,
        winPatterns,
        frameworkOverrides: params.frameworkOverrides,
    });

    await prisma.reply.update({
        where: { id: params.replyId },
        data: {
            draftSubject: draft.subject,
            draftBody: draft.body,
            objectionCategory: objection.category,
        },
    });

    logger.info(
        { replyId: params.replyId },
        "[objection-handler.agent] Draft saved (db path)"
    );

    return {
        subject: draft.subject,
        body: draft.body,
        objectionCategory: objection.category,
        secondaryObjectionCategory: objection.secondaryCategory,
    };
}

export async function runObjectionHandlerForCampaign(
    campaignId: string,
    frameworkOverrides?: ObjectionFrameworkOverrides,
): Promise<void> {
    const replies = await prisma.reply.findMany({
        where: {
            lead: { campaignId },
            intent: { in: ["POSITIVE", "MEETING_REQUEST", "QUESTION"] },
            requiresHumanReview: true,
            draftBody: null,
            deletedAt: null,
        },
        select: { id: true },
    });

    logger.info(
        { campaignId, count: replies.length },
        "[objection-handler.agent] Batch processing replies"
    );

    const limit = pLimit(BATCH_CONCURRENCY);

    await Promise.allSettled(
        replies.map((reply) =>
            limit(async () => {
                try {
                    await generateObjectionAwareDraft({ replyId: reply.id, frameworkOverrides });
                } catch (err) {
                    logger.error(
                        { err, replyId: reply.id },
                        "[objection-handler.agent] Failed for reply"
                    );
                }
            })
        )
    );

    logger.info({ campaignId }, "[objection-handler.agent] Batch done");
}