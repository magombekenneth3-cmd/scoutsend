import pLimit from "p-limit";
import { prisma } from "../../lib/prisma";
import { MODELS } from "./gemini.client";
import { callGateway, ObjectionAnalysisSchema, DraftReplyOutputSchema } from "../../lib/llm-gateway";
import type { ObjectionAnalysisOutput, DraftReplyOutput } from "../../lib/llm-gateway";
import { logger } from "../../lib/logger";
import { ReplyIntent, DraftReply } from "./reply.agent";
import { getWinPatterns, WinPattern } from "../memory/memory.service";

export type ObjectionCategory =
    | "PRICING"
    | "TIMING"
    | "INCUMBENT_VENDOR"
    | "SECURITY_COMPLIANCE"
    | "INTEGRATION_TECHNICAL"
    | "BRUSH_OFF"
    | "NO_NEED"
    | "DECISION_MAKER"
    | "MORE_INFO"
    | "GENERAL_INTEREST"
    | "NONE";

const OBJECTION_CATEGORIES: readonly ObjectionCategory[] = [
    "PRICING",
    "TIMING",
    "INCUMBENT_VENDOR",
    "SECURITY_COMPLIANCE",
    "INTEGRATION_TECHNICAL",
    "BRUSH_OFF",
    "NO_NEED",
    "DECISION_MAKER",
    "MORE_INFO",
    "GENERAL_INTEREST",
    "NONE",
];

const SENSITIVE_CATEGORIES = new Set<ObjectionCategory>([
    "PRICING",
    "SECURITY_COMPLIANCE",
]);

interface ObjectionAnalysis {
    category: ObjectionCategory;
    secondaryCategory: ObjectionCategory | null;
    extractedObjection: string;
}

export interface ObjectionAwareDraftResult extends DraftReply {
    objectionCategory: ObjectionCategory;
    secondaryObjectionCategory?: ObjectionCategory | null;
    requiresHumanReview?: boolean;
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
        "Acknowledge the budget concern without apologising for the price. Reframe around the cost of the problem they currently have unsolved, not around your product features. Offer a scoped proof-of-value step that reduces commitment. Close with a low-friction asset ask: 'Worth sharing a 1-page ROI breakdown for a company like yours?'",
    TIMING:
        "Validate their timing concern without accepting it as final. Ask one open question: what would need to be true for this to become a priority. Anchor a specific future touchpoint. Close with a low-friction nudge: 'Mind if I check back near the end of Q3 when planning opens up?'",
    INCUMBENT_VENDOR:
        "Do not attack the incumbent — compliment their choice instead. Ask one curious question about what they'd improve if they could. Position as additive or complementary, not a rip-and-replace. Close with a differentiation query: 'Open to seeing how we complement [Vendor] on [specific gap]?'",
    SECURITY_COMPLIANCE:
        "Directly affirm the security question without hedging. State relevant certifications (SOC2, GDPR, ISO 27001) in a single clause. Offer to send the compliance documentation package. Close with a resource-delivery offer: 'Happy to send over our SOC2 Type II report and data processing addendum if that helps.'",
    INTEGRATION_TECHNICAL:
        "Confirm compatibility directly and concisely — one sentence. Offer the technical specification or an architecture call with an engineer. Close with a confirmation ask: 'Does native [CRM/SSO/API] support address your main concern, or is there a specific integration you'd like to verify?'",
    BRUSH_OFF:
        "Match their energy — keep it extremely brief, under 3 sentences. Deliver a single high-value micro-insight relevant to their role or industry that they can act on without a meeting. Close with a micro-insight ask: 'Happy to — would 3 bullet points on how [Persona] teams are solving [Pain] be useful?'",
    NO_NEED:
        "Thank them for the clarity and be graceful. Ask one soft referral question: is there someone else in their org this would be more relevant to. If they confirm no fit, bow out warmly and leave the door open. Close with a soft permission ask: 'Understood — mind if I keep you posted on updates relevant to [their space]?'",
    DECISION_MAKER:
        "Acknowledge and validate that they are not the right person to evaluate this. Ask who owns the problem space directly and offer to help make the introduction easy. Close with a referral request: 'Who on your team manages [Problem Area]? Happy to send something brief they can review in under 2 minutes.'",
    MORE_INFO:
        "Answer the question directly and concisely — one paragraph max, no padding. Then suggest a brief call as the fastest path to address their remaining questions. Close with a clarification ask: 'Does that address what you were looking for, or would it be easier to run through the details on a quick call?'",
    GENERAL_INTEREST:
        "Match their warm energy. Move to a concrete next step immediately. Ask for a specific 15-minute window over the next 1–2 weeks. Close with a commitment CTA: 'Do you have 15 minutes next week for a quick demo — I can work around your schedule.'",
    NONE:
        "Write a warm, professional reply. Move toward a concrete next step: suggest a brief call over the next week or two and let them know you will send a calendar invite accordingly.",
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

function shouldForceHumanReview(category: ObjectionCategory, confidence: number): boolean {
    return SENSITIVE_CATEGORIES.has(category) || confidence < 0.92;
}

async function detectObjection(params: {
    replyBody: string;
    intent: ReplyIntent;
    messageId: string;
}): Promise<ObjectionAnalysis> {
    const { replyBody, intent, messageId } = params;

    let payload: ObjectionAnalysisOutput;
    try {
        const proposal = await callGeminiWithResilience(
            () =>
                callGateway<ObjectionAnalysisOutput>({
                    agentName: "objection-handler.detector",
                    model: MODELS.REVIEW,
                    responseMode: "text",
                    outputSchema: ObjectionAnalysisSchema,
                    systemPrompt: `You are a B2B sales objection analyst. Classify the objection(s) in a prospect's reply.

Return ONLY JSON:
{
  "category": one of "PRICING" | "TIMING" | "INCUMBENT_VENDOR" | "SECURITY_COMPLIANCE" | "INTEGRATION_TECHNICAL" | "BRUSH_OFF" | "NO_NEED" | "DECISION_MAKER" | "MORE_INFO" | "GENERAL_INTEREST" | "NONE",
  "secondaryCategory": one of the same values except "NONE", or null — only set this if a second, genuinely distinct objection is also present,
  "extractedObjection": string — the exact objection in 1 sentence, or empty string if none
}

Category definitions:
- PRICING: mentions cost, budget, expensive, can't justify the spend
- TIMING: not now, bad timing, next quarter, too busy, check back later
- INCUMBENT_VENDOR: already have a solution, using a competitor (Salesforce, HubSpot, etc.)
- SECURITY_COMPLIANCE: questions about SOC2, GDPR, ISO 27001, data residency, privacy, legal review
- INTEGRATION_TECHNICAL: questions about API compatibility, CRM integrations, SSO, tech stack fit
- BRUSH_OFF: polite dismissal — "send me an email", "not interested right now", vague deflection
- NO_NEED: don't need this, not relevant to their business, not a priority
- DECISION_MAKER: not the right person, need to check with someone else, buying committee
- MORE_INFO: asking a specific question about the product, pricing tiers, or features
- GENERAL_INTEREST: interested but no specific objection
- NONE: clear positive with no friction

Most replies carry a single objection — leave secondaryCategory null unless the prospect clearly raises two separate, distinct concerns.`,
                    userPrompt: `Intent: ${intent}\n\nReply:\n${replyBody}`,
                    proposalContext: { requestFingerprint: messageId },
                    metadata: { messageId },
                    temperature: 0.1,
                }),
            GEMINI_TIMEOUT_MS,
        );
        payload = proposal.payload;
    } catch (err) {
        logger.warn(
            { messageId, err: err instanceof Error ? err.message : String(err) },
            "[objection-handler.agent] Objection detection failed — falling back to NONE",
        );
        return { category: "NONE", secondaryCategory: null, extractedObjection: "" };
    }

    if (!isValidObjectionCore(payload)) {
        logger.warn(
            { messageId },
            "[objection-handler.agent] Invalid ObjectionAnalysis from gateway — falling back to NONE",
        );
        return { category: "NONE", secondaryCategory: null, extractedObjection: "" };
    }

    const category = payload.category as ObjectionCategory;
    const extractedObjection = (payload.extractedObjection as string) ?? "";
    const rawSecondary = payload.secondaryCategory;

    let secondaryCategory: ObjectionCategory | null = null;
    if (
        category !== "NONE" &&
        isObjectionCategory(rawSecondary) &&
        rawSecondary !== category
    ) {
        secondaryCategory = rawSecondary;
    }

    return { category, secondaryCategory, extractedObjection };
}

async function generateDraftWithFramework(params: {
    objection: ObjectionAnalysis;
    originalSubject: string;
    originalBody?: string;
    leadFirstName?: string;
    companyName?: string;
    title?: string;
    replyBody: string;
    messageId: string;
    winPatterns?: WinPattern[];
    frameworkOverrides?: ObjectionFrameworkOverrides;
    threadHistory?: Array<{ role: "prospect" | "sender"; body: string; sentAt?: string }>;
}): Promise<DraftReply> {
    const {
        objection,
        originalSubject,
        originalBody,
        leadFirstName,
        companyName,
        title,
        replyBody,
        messageId,
        winPatterns,
        frameworkOverrides,
        threadHistory,
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

    const originalBodyBlock = originalBody
        ? `\n\nOriginal outreach email we sent:\n${originalBody.slice(0, 800)}`
        : "";

    const threadHistoryBlock = threadHistory && threadHistory.length > 0
        ? "\n\nPRIOR THREAD HISTORY:\n" +
          threadHistory.map((t) => `[${t.role.toUpperCase()}]: ${t.body}`).join("\n\n")
        : "";

    const timeoutMs = resolveDraftTimeoutMs({
        hasWinPatterns: Boolean(winPatterns && winPatterns.length > 0),
        isHybridObjection: Boolean(secondaryCategory),
    });

    const proposal = await callGeminiWithResilience(
        () =>
            callGateway<DraftReplyOutput>({
                agentName: "objection-handler.drafter",
                model: MODELS.REVIEW,
                responseMode: "text",
                outputSchema: DraftReplyOutputSchema,
                systemPrompt: `You are a senior B2B sales rep drafting a reply to a prospect's inbound email.

Hard rules — violating any of these is a failure:
- Maximum 75 words total in the body
- Never start a sentence with "I" or "We"
- Never use AI clichés ("I hope this finds you well", "In today's fast-paced landscape", "Great question")
- Never include a calendar scheduling link or specific time slots
- Never be pushy or assumptive — always ask permission before progressing
- Apply the response framework as your strategic guide
- Use the CTA style specified in the framework — do not substitute a meeting invite for a low-friction ask
- If win patterns are provided, use them for tonal inspiration only — do not copy verbatim${winPatternsBlock}

Return ONLY JSON:
{
  "subject": string,
  "body": string
}`,
                userPrompt: `Response framework: ${framework}

Objection detected: ${objection.extractedObjection || "none"}

Original subject: ${originalSubject}
Lead: ${leadFirstName ?? "there"} at ${companyName ?? "their company"}
Their title: ${title ?? "unknown"}${originalBodyBlock}${threadHistoryBlock}

Their reply:
${replyBody}`,
                proposalContext: { requestFingerprint: messageId },
                metadata: {
                    messageId,
                    objectionCategory: objection.category,
                    secondaryObjectionCategory: secondaryCategory ?? undefined,
                },
                temperature: 0.5,
            }),
        timeoutMs,
    );

    const payload = proposal.payload;

    if (!isValidDraftReply(payload)) {
        throw new Error(
            `[objection-handler.agent] Invalid DraftReply from gateway for message ${messageId}`,
        );
    }

    return {
        ...payload,
        subject: payload.subject.trim(),
        body: payload.body.trim(),
    };
}

export async function generateObjectionAwareDraftFromContext(params: {
    replyBody: string;
    intent: ReplyIntent;
    originalSubject: string;
    originalBody?: string;
    leadFirstName?: string;
    companyName?: string;
    title?: string;
    messageId: string;
    targetIndustry?: string;
    targetRegion?: string;
    confidence?: number;
    frameworkOverrides?: ObjectionFrameworkOverrides;
    threadHistory?: Array<{ role: "prospect" | "sender"; body: string; sentAt?: string }>;
}): Promise<ObjectionAwareDraftResult> {
    const {
        replyBody,
        intent,
        originalSubject,
        originalBody,
        leadFirstName,
        companyName,
        title,
        messageId,
        targetIndustry,
        targetRegion,
        confidence,
        frameworkOverrides,
        threadHistory,
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
        originalBody,
        leadFirstName,
        companyName,
        title,
        replyBody,
        messageId,
        winPatterns,
        frameworkOverrides,
        threadHistory,
    });

    const requiresHumanReview = shouldForceHumanReview(objection.category, confidence ?? 0);

    return {
        subject: draft.subject,
        body: draft.body,
        objectionCategory: objection.category,
        secondaryObjectionCategory: objection.secondaryCategory,
        requiresHumanReview,
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
        originalBody: reply.outreachMessage.body,
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
            intent: { in: ["POSITIVE", "MEETING_REQUEST", "QUESTION", "NOT_INTERESTED"] },
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