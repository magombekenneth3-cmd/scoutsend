

import type { Prisma } from "@prisma/client";
import {
    callGateway,
    GeneratedMessageSchema,
    createContextHash,
    buildMessageGenerationContextBundle,
    createProposalHash,
    type AgentProposal,
    type GeneratedMessage,
} from "../../lib/llm-gateway";
import { MODELS, SchemaType, type ToolDefinition } from "./gemini.client";
import type { FewShotExample } from "../learning/learning.service";
import type { WinPattern, LossPattern } from "../memory/memory.service";
import { logger } from "../../lib/logger";
import type { RejectionReason } from "./review.agent";
import z from "zod";

export type { FewShotExample, WinPattern, LossPattern, RejectionReason };
export type { GeneratedMessage };

export type GeneratedMessagePayload = GeneratedMessage & {
    rawLlmConfidence?: number;
    heuristicScore?: number;
    bannedPhraseCount?: number;
    spamRiskScore?: number;
    estimatedPromptTokens?: number;
};

const SPAM_RISK_WARN_THRESHOLD = 0.7;
const HIGH_QUALITY_PERSON_THRESHOLD = 0.85;
const HIGH_QUALITY_SPAM_THRESHOLD = 0.2;

const CHARS_PER_TOKEN_ESTIMATE = 4;
const MAX_DYNAMIC_CONTEXT_TOKENS = 4_000;
const MAX_DYNAMIC_CONTEXT_CHARS = MAX_DYNAMIC_CONTEXT_TOKENS * CHARS_PER_TOKEN_ESTIMATE;

const GENERATION_HEURISTIC_WEIGHT = 0.6;
const GENERATION_LLM_CONFIDENCE_WEIGHT = 1 - GENERATION_HEURISTIC_WEIGHT;

const MAX_SIGNALS_FOR_PROMPT = 2;
const SIGNAL_POOL_SIZE = 8;
const MAX_READABLE_GRADE_LEVEL = 9;
const MIN_PERSONALIZATION_DENSITY = 0.3;
const WEAK_SIGNAL_CONFIDENCE_CEILING = 0.45;

export type LeadWithSignals = Prisma.LeadGetPayload<{
    include: {
        signals: true;
        company: { include: { signals: true } };
    };
}> & {
    competitorSignal?: boolean;
    competitorTech?: string[];
};

export interface HeuristicContext {
    signals: LeadWithSignals["signals"];
    companyName: string;
    firstName: string;
    hasStrongSignal: boolean;
}

export interface HeuristicEvaluation {
    score: number;
    bannedPhraseCount: number;
    spamRiskScore: number;
}

export interface IndustryPlaybook {
    matches: string[];
    focusAreas: string[];
    vocabulary: string[];
}

export interface StructuredCompanyFacts {
    products: string;
    targetCustomers: string;
    differentiators: string;
    recentLaunches: string;
    techStack: string;
}

function mergeSignals(
    leadSignals: LeadWithSignals["signals"],
    companySignals: NonNullable<LeadWithSignals["company"]>["signals"],
    take = SIGNAL_POOL_SIZE,
): LeadWithSignals["signals"] {
    const seen = new Set();
    const merged: LeadWithSignals["signals"] = [];
    for (const s of [...leadSignals, ...companySignals]) {
        const key = `${s.signalType}:${s.value}`;
        if (!seen.has(key)) {
            seen.add(key);
            merged.push(s as LeadWithSignals["signals"][number]);
        }
    }
    return merged.sort((a, b) => b.confidence - a.confidence).slice(0, take);
}

function clampScore(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(1, Math.max(0, value));
}

function estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

function takeFormattedWithinBudget<T>(
    items: T[],
    budget: { charsRemaining: number },
    format: (item: T, index: number) => string,
): string[] {
    const taken: string[] = [];
    for (let i = 0; i < items.length; i++) {
        const formatted = format(items[i], i);
        if (formatted.length > budget.charsRemaining) break;
        taken.push(formatted);
        budget.charsRemaining -= formatted.length;
    }
    return taken;
}

const BANNED_PHRASES: string[] = [
    "I hope you're doing well",
    "I came across your company",
    "I was impressed by",
    "exciting news",
    "innovative platform",
    "game-changing",
    "cutting-edge",
    "help companies like yours",
    "optimize your growth",
    "drive meaningful results",
    "unlock growth",
    "accelerate your growth",
    "leverage",
    "synergies",
    "data-driven approach",
    "tailored solutions",
    "I'd love to connect",
    "worth a brief call?",
    "I hope this finds you well",
    "reach out",
    "all-in-one platform",
    "streamline workflows",
    "maximize engagement",
    "cut through the noise",
    "drive pipeline",
    "scalable solution",
    "hope this email finds you well",
    "circle back",
    "touch base",
];

const BANNED_PHRASES_PROMPT_TEXT = BANNED_PHRASES.map((phrase) => `"${phrase}"`).join(", ");

const SPAM_TRIGGER_PATTERN = /\b(act now|limited time|don't miss|risk-free|guaranteed?|no obligation|click here|order now)\b/i;

const SINGLE_WORD_PHRASES = new Set(["leverage", "synergies"]);
const APOSTROPHE_RE = /[\u2018\u2019\u2032]/g;

function normalizeBannedText(s: string): string {
    return s.toLowerCase().replace(APOSTROPHE_RE, "'");
}

function countBannedPhrases(text: string): number {
    const lower = normalizeBannedText(text);
    return BANNED_PHRASES.reduce((count, phrase) => {
        const normalizedPhrase = normalizeBannedText(phrase);
        if (SINGLE_WORD_PHRASES.has(normalizedPhrase)) {
            return new RegExp(`\\b${normalizedPhrase}\\b`, "i").test(lower) ? count + 1 : count;
        }
        return lower.includes(normalizedPhrase) ? count + 1 : count;
    }, 0);
}


function countQuestions(text: string): number {
    return (text.match(/\?/g) ?? []).length;
}

function hasDuplicateSentenceStructure(body: string): boolean {
    const sentences = body
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length > 0);
    return new Set(sentences).size !== sentences.length;
}

function countSyllables(word: string): number {
    const cleaned = word.toLowerCase().replace(/[^a-z]/g, "");
    if (!cleaned) return 0;
    const groups = cleaned.match(/[aeiouy]+/g);
    let count = groups ? groups.length : 1;
    if (cleaned.endsWith("e") && count > 1) count -= 1;
    return Math.max(1, count);
}

function fleschKincaidGradeLevel(text: string): number {
    const sentences = text.split(/[.!?]+/).map((s) => s.trim()).filter(Boolean);
    const words = text.split(/\s+/).map((w) => w.trim()).filter(Boolean);
    if (sentences.length === 0 || words.length === 0) return 0;
    const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
    return 0.39 * (words.length / sentences.length) + 11.8 * (syllables / words.length) - 15.59;
}

function computePersonalizationDensity(body: string, context: HeuristicContext): number {
    const lowerBody = body.toLowerCase();
    const tokens = [context.companyName, context.firstName, ...context.signals.map((s) => s.value)]
        .filter((t): t is string => Boolean(t && t.trim().length > 2));
    if (tokens.length === 0) return 0;
    const hits = tokens.filter((t) => lowerBody.includes(t.toLowerCase())).length;
    return hits / tokens.length;
}

function computeSpamRiskScore(body: string, bannedPhraseCount: number): number {
    const signals: number[] = [
        Math.min(1, bannedPhraseCount / 2),
        countQuestions(body) > 1 ? 1 : 0,
        /!/.test(body) ? 1 : 0,
        SPAM_TRIGGER_PATTERN.test(body) ? 1 : 0,
        /[A-Z]{5,}/.test(body) ? 1 : 0,
    ];
    return signals.reduce((a, b) => a + b, 0) / signals.length;
}

function computeGenerationHeuristicScore(
    message: GeneratedMessage,
    context: HeuristicContext,
): HeuristicEvaluation {
    const checks: boolean[] = [];

    const leadingSignal = message.leadingSignal?.trim() ?? "";
    checks.push(leadingSignal.length > 0);

    const isGrounded =
        leadingSignal.length > 0 &&
        context.signals.some((s) =>
            leadingSignal === s.signalType ||
            (s.value.length > 2 && message.body.toLowerCase().includes(s.value.toLowerCase())),
        );
    checks.push(isGrounded);

    const bodyWordCount = message.body.trim().split(/\s+/).filter(Boolean).length;
    checks.push(bodyWordCount >= 20 && bodyWordCount <= 130);

    const subjectWordCount = message.subject.trim().split(/\s+/).filter(Boolean).length;
    checks.push(subjectWordCount >= 4 && subjectWordCount <= 12);

    const subjectVariantWordCount = message.subjectVariant
        ? message.subjectVariant.trim().split(/\s+/).filter(Boolean).length
        : 0;
    checks.push(subjectVariantWordCount >= 4 && subjectVariantWordCount <= 12);

    const company = context.companyName.trim();
    const mentionsCompany = company.length > 2 && message.body.toLowerCase().includes(company.toLowerCase());
    checks.push(mentionsCompany);

    checks.push(countQuestions(message.body) <= 1);
    checks.push(!hasDuplicateSentenceStructure(message.body));
    checks.push(fleschKincaidGradeLevel(message.body) <= MAX_READABLE_GRADE_LEVEL);

    const bannedPhraseCount =
        countBannedPhrases(message.subject) +
        countBannedPhrases(message.body) +
        countBannedPhrases(message.subjectVariant ?? "");
    checks.push(bannedPhraseCount === 0);

    const personalizationDensity = computePersonalizationDensity(message.body, context);
    checks.push(personalizationDensity >= MIN_PERSONALIZATION_DENSITY);

    checks.push(context.hasStrongSignal || message.confidence <= WEAK_SIGNAL_CONFIDENCE_CEILING);

    const spamRiskScore = computeSpamRiskScore(message.body, bannedPhraseCount);
    checks.push(spamRiskScore <= HIGH_QUALITY_SPAM_THRESHOLD);

    const passed = checks.filter(Boolean).length;
    const score = checks.length > 0 ? passed / checks.length : 0;

    return { score, bannedPhraseCount, spamRiskScore };
}

function sanitizePlaceholderTokens(text: string, firstName: string, companyName: string): string {
    if (!text) return text;
    const safeFirstName = (firstName && firstName !== "null" && firstName !== "undefined" && firstName.trim())
        ? firstName.trim()
        : "there";
    const safeCompanyName = (companyName && companyName !== "null" && companyName !== "undefined" && companyName.trim())
        ? companyName.trim()
        : "your team";

    return text
        .replace(/\[(?:First\s*Name|firstName|FirstName|name)\]/gi, safeFirstName)
        .replace(/\[(?:Company\s*Name|companyName|CompanyName|company)\]/gi, safeCompanyName)
        .replace(/\b(Hi|Hello|Hey)\s+(null|undefined)\b/gi, `$1 ${safeFirstName}`)
        .replace(/\b(null|undefined)\b/gi, safeFirstName);
}

function normalizeGenerated(
    raw: GeneratedMessage,
    context: HeuristicContext,
): GeneratedMessagePayload {
    const rawSubject = typeof raw.subject === "string" ? raw.subject.trim() : "";
    const rawBody = typeof raw.body === "string" ? raw.body.trim() : "";
    const subject = sanitizePlaceholderTokens(rawSubject, context.firstName, context.companyName);
    const body = sanitizePlaceholderTokens(rawBody, context.firstName, context.companyName);
    const leadingSignal = typeof raw.leadingSignal === "string" ? raw.leadingSignal.trim() : undefined;
    const ctaTier =
        raw.ctaTier === "WEAK" || raw.ctaTier === "MODERATE" || raw.ctaTier === "STRONG"
            ? raw.ctaTier
            : undefined;
    const candidateSubjectVariant = typeof raw.subjectVariant === "string" ? raw.subjectVariant.trim() : "";
    const sanitizedVariant = sanitizePlaceholderTokens(candidateSubjectVariant, context.firstName, context.companyName);
    const subjectVariant = sanitizedVariant && sanitizedVariant !== subject
        ? sanitizedVariant
        : undefined;

    const rawLlmConfidence = clampScore(raw.confidence);

    const normalized: GeneratedMessage = {
        ...raw,
        subject,
        body,
        leadingSignal,
        ctaTier,
        subjectVariant,
        confidence: rawLlmConfidence,
    };

    const { score: heuristicScore, bannedPhraseCount, spamRiskScore } = computeGenerationHeuristicScore(normalized, context);

    const spamPenalty = spamRiskScore >= SPAM_RISK_WARN_THRESHOLD ? spamRiskScore - SPAM_RISK_WARN_THRESHOLD : 0;

    const blendedConfidence = clampScore(
        GENERATION_HEURISTIC_WEIGHT * heuristicScore +
        GENERATION_LLM_CONFIDENCE_WEIGHT * rawLlmConfidence -
        spamPenalty,
    );
    const finalConfidence = context.hasStrongSignal
        ? blendedConfidence
        : Math.min(blendedConfidence, WEAK_SIGNAL_CONFIDENCE_CEILING);

    return {
        ...normalized,
        confidence: finalConfidence,
        rawLlmConfidence,
        heuristicScore,
        bannedPhraseCount,
        spamRiskScore,
    };
}

function rankSignalsByRelevance(
    signals: LeadWithSignals["signals"],
    replyRateBySignalType: Map<string, number>,
): LeadWithSignals["signals"] {
    return [...signals]
        .map((signal) => {
            const historicalReplyRate = replyRateBySignalType.get(signal.signalType);
            const relevanceScore = historicalReplyRate !== undefined
                ? clampScore(0.5 * signal.confidence + 0.5 * historicalReplyRate)
                : signal.confidence;
            return { signal, relevanceScore };
        })
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .map((entry) => entry.signal);
}

const INDUSTRY_PLAYBOOKS: IndustryPlaybook[] = [
    {
        matches: ["healthcare", "health", "medical", "clinic", "hospital"],
        focusAreas: ["patient throughput", "staffing", "compliance"],
        vocabulary: ["patients", "census", "care team"],
    },
    {
        matches: ["law", "legal", "law firm", "attorney"],
        focusAreas: ["billable hours", "client acquisition", "partner productivity"],
        vocabulary: ["clients", "matters", "partners"],
    },
    {
        matches: ["construction", "contracting", "general contractor"],
        focusAreas: ["bids", "project scheduling", "subcontractors"],
        vocabulary: ["projects", "bids", "crews"],
    },
    {
        matches: ["real estate", "property management", "realty"],
        focusAreas: ["listing velocity", "lead response time", "commission cycles"],
        vocabulary: ["listings", "closings", "agents"],
    },
    {
        matches: ["saas", "software", "technology"],
        focusAreas: ["pipeline predictability", "rep ramp time", "churn"],
        vocabulary: ["ARR", "seats", "accounts"],
    },
    {
        matches: ["financial services", "fintech", "banking", "insurance"],
        focusAreas: ["compliance overhead", "client onboarding time", "risk exposure"],
        vocabulary: ["clients", "accounts", "portfolios"],
    },
    {
        matches: ["manufacturing", "industrial"],
        focusAreas: ["downtime", "supply chain reliability", "throughput"],
        vocabulary: ["plant", "line", "units"],
    },
];

function resolveIndustryPlaybook(targetIndustry?: string | null): IndustryPlaybook | null {
    if (!targetIndustry) return null;
    const normalized = targetIndustry.toLowerCase();
    return INDUSTRY_PLAYBOOKS.find((playbook) => playbook.matches.some((match) => normalized.includes(match))) ?? null;
}

const GENERATE_EMAIL_TOOL: ToolDefinition = {
    declaration: {
        name: "returnResult",
        description: "Return the generated cold email.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                subject: {
                    type: SchemaType.STRING,
                    description: "Subject line: 6–9 words, no clickbait, no ALL CAPS.",
                },
                subjectVariant: {
                    type: SchemaType.STRING,
                    description:
                        "Alternative subject line. If two or more strong personal hooks exist (e.g. location, alma mater, personal interest, mutual connection), produce a plus-delimited sequence of those tokens followed by the sender company name — e.g. 'Geneva + Dogs + L'Auberge + [Sender Company]'. This format makes the subject meaningless to anyone except the recipient and dramatically improves open rates. Otherwise fall back to a different structural angle (question vs. statement, or lead with the signal instead of the company name). Max 9 words. Must be meaningfully different — never identical or a trivial reword.",
                },
                body: {
                    type: SchemaType.STRING,
                    description: "Email body. Plain prose. No bullet points. No numbered lists. No unsubscribe text. Separate paragraphs with a blank line (\\n\\n). Length: aim for 45–120 words. Shorter is better when complete — never pad.",
                },
                confidence: {
                    type: SchemaType.NUMBER,
                    description: "Your confidence in the quality of this email 0.0–1.0.",
                },
                leadingSignal: {
                    type: SchemaType.STRING,
                    description: "The exact signalType value (from the Top signals list) that you opened with. Must match one of the provided signal types verbatim, not a paraphrase.",
                },
                ctaTier: {
                    type: SchemaType.STRING,
                    description: "Which CTA calibration tier from HARD RULE 12 you used: WEAK, MODERATE, or STRONG.",
                },
            },
            required: [
                "subject",
                "subjectVariant",
                "body",
                "confidence",
                "leadingSignal",
                "ctaTier",
            ],
        },
    },
    handler: async (args) => args,
};

export interface GenerateMessageParams {
    lead: LeadWithSignals;
    campaignId: string;
    icpDescription: string;
    campaignName: string;
    senderDomain?: string;
    targetIndustry?: string | null;
    targetRegion?: string | null;
    fewShotExamples?: FewShotExample[];
    winPatterns?: WinPattern[];
    lossPatterns?: LossPattern[];
    feedbackContext?: string;
    tone?: string;
    businessDescription?: string | null;
    valueProposition?: string | null;
    provenStats?: Array<{ metric: string; value: string; context: string }> | null;
    replyRateBySignalType?: Map<string, number>;
    structuredFactsCache?: Map<string, Promise<StructuredCompanyFacts | null>>;
}

/**
 * Pure LLM Agent proposal generator.
 * Produces an AgentProposal<GeneratedMessage> bound to a SHA-256 context hash.
 * Does NOT perform any DB operations.
 */
export async function generateMessageProposalForLead(
    params: GenerateMessageParams,
): Promise<AgentProposal<GeneratedMessage>> {
    const { lead, campaignId, icpDescription, campaignName, senderDomain, targetIndustry, feedbackContext, tone,
        businessDescription, valueProposition, provenStats, replyRateBySignalType } = params;

    const firstName = (lead.firstName && lead.firstName.trim().toLowerCase() !== "null" && lead.firstName.trim().toLowerCase() !== "undefined" && lead.firstName.trim().length > 0)
        ? lead.firstName.trim()
        : "there";
    const companyName = (lead.companyName && lead.companyName.trim().toLowerCase() !== "null" && lead.companyName.trim().toLowerCase() !== "undefined" && lead.companyName.trim().length > 0)
        ? lead.companyName.trim()
        : "your team";
    const title = (lead.title && lead.title.trim().toLowerCase() !== "null" && lead.title.trim().toLowerCase() !== "undefined" && lead.title.trim().length > 0)
        ? lead.title.trim()
        : "professional";

    const signalPool = mergeSignals(lead.signals, lead.company?.signals ?? [], SIGNAL_POOL_SIZE);
    const rankedSignals = rankSignalsByRelevance(signalPool, replyRateBySignalType ?? new Map());
    const mergedSignals = rankedSignals.slice(0, MAX_SIGNALS_FOR_PROMPT);
    const hasStrongSignal = (mergedSignals[0]?.confidence ?? 0) >= HIGH_QUALITY_PERSON_THRESHOLD;

    const topSignals = mergedSignals
        .map((s) => `• ${s.signalType}: ${s.value} (${s.explanation})`)
        .join("\n");

    const contextBudget = { charsRemaining: MAX_DYNAMIC_CONTEXT_CHARS };

    const feedbackBlock = feedbackContext
        ? `\n\nQUALITY GATE FAILURE — previous version of this email was rejected:\n${feedbackContext}`
        : "";
    contextBudget.charsRemaining = Math.max(0, contextBudget.charsRemaining - feedbackBlock.length);

    const winPatternsItems =
        params.winPatterns && params.winPatterns.length > 0
            ? takeFormattedWithinBudget(params.winPatterns, contextBudget, (p, i) =>
                `Pattern ${i + 1} (outcome: ${p.replyIntent}, recency: ${p.recencyScore}):\n` +
                `  Signal type that worked: ${p.signalType}\n` +
                `  Subject structure: ${p.subjectPattern}\n` +
                `  Opening structure: ${p.bodyOpeningPattern}\n` +
                `  Tone: ${p.tone ?? "not specified"}`,
            )
            : [];

    const winPatternsBlock =
        winPatternsItems.length > 0
            ? "\n\nWIN PATTERNS — signal types and structures that generated replies in similar campaigns. Use for tonal and structural inspiration only — never copy verbatim:\n" +
            winPatternsItems.join("\n\n")
            : "";

    const lossPatternsItems =
        params.lossPatterns && params.lossPatterns.length > 0
            ? takeFormattedWithinBudget(params.lossPatterns, contextBudget, (p, i) =>
                `Pattern ${i + 1} (recency: ${p.recencyScore}):\n` +
                `  Objection raised: ${p.inferredObjection}\n` +
                `  Opening that failed: ${p.bodyPattern ?? "not recorded"}\n` +
                `  Tone that backfired: ${p.tone ?? "not specified"}`,
            )
            : [];

    const lossPatternsBlock =
        lossPatternsItems.length > 0
            ? "\n\nLOSS PATTERNS — angles and objections that historically triggered negative or uninterested replies in similar campaigns. Actively avoid these structures:\n" +
            lossPatternsItems.join("\n\n")
            : "";

    const fewShotItems =
        params.fewShotExamples && params.fewShotExamples.length > 0
            ? takeFormattedWithinBudget(params.fewShotExamples, contextBudget, (ex, i) =>
                `Example ${i + 1}:\n` +
                `BEFORE subject: ${ex.original.subject}\n` +
                `BEFORE body: ${ex.original.body}\n` +
                `AFTER subject: ${ex.improved.subject}\n` +
                `AFTER body: ${ex.improved.body}\n` +
                `Why: ${ex.improvementReason}`,
            )
            : [];

    const fewShotBlock =
        fewShotItems.length > 0
            ? "\n\nLEARNED IMPROVEMENTS — examples of edits that improved past emails:\n" +
            fewShotItems.join("\n\n")
            : "";

    const isCompetitorLead = lead.competitorSignal === true;
    const competitorTools = (lead.competitorTech ?? []).join(", ");

    const competitorBlock = isCompetitorLead && competitorTools
        ? `\n\nCOMPETITOR DISPLACEMENT — This prospect currently uses: ${competitorTools}. State the exact challenge you solve. Then preempt their most likely objection inline in a single sentence: acknowledge they likely already have a vendor or internal team handling this, then differentiate by focusing on execution quality, measurable outcomes, and business impact — not software features. Do NOT name the competitor directly. Tone: confident, peer-to-peer, not aggressive.`
        : isCompetitorLead
            ? `\n\nCOMPETITOR DISPLACEMENT — This prospect uses a competing product. State the challenge you solve, then preempt the obvious objection: acknowledge they have a solution already, and differentiate on outcomes and execution. Confident, peer-to-peer tone.`
            : "";

    const businessContextBlock = businessDescription
        ? `\n\nWHAT THE SENDER ACTUALLY DOES:\n${businessDescription}`
        : "";

    const valuePropBlock = valueProposition
        ? `\n\nSENDER VALUE PROPOSITION (in their own words — use this as the basis for the pitch):\n${valueProposition}`
        : "";

    const hasProvenStats = Array.isArray(provenStats) && provenStats.length > 0;
    const provenStatsBlock = hasProvenStats
        ? `\n\nPROVEN STATS — cite at most ONE, use the number and context verbatim, never alter or round it:\n` +
        provenStats!.map((s) => `- ${s.metric}: ${s.value} (${s.context})`).join("\n")
        : "";

    const toneText = tone
        ? `Tone: ${tone.toLowerCase()} cold email tone`
        : "Tone: warm, peer-to-peer, not salesy";

    const seniorityBlock = (() => {
        const t = title.toLowerCase();
        if (t.includes("founder") || t.includes("ceo") || t.includes("chief executive")) {
            return "RECIPIENT SENIORITY: Founder / C-Suite. Focus on growth, efficiency, and strategic priorities. Frame everything as a business lever, not a tool.";
        }
        if (t.includes("vp") || t.includes("vice president") || t.includes("head of sales") || t.includes("cro") || t.includes("revenue")) {
            return "RECIPIENT SENIORITY: VP Sales / Revenue Leader. Focus on pipeline, rep productivity, conversion, and revenue predictability.";
        }
        if (t.includes("marketing") || t.includes("demand") || t.includes("growth") || t.includes("cmo")) {
            return "RECIPIENT SENIORITY: Marketing / Growth Leader. Focus on acquisition, demand generation, CAC, and attribution.";
        }
        if (t.includes("sdr") || t.includes("bdr") || t.includes("sales development") || t.includes("sales manager") || t.includes("sales enablement")) {
            return "RECIPIENT SENIORITY: SDR / Sales Enablement Manager. Focus on rep productivity, research time saved, personalization at scale, and meetings booked per rep.";
        }
        return "RECIPIENT SENIORITY: Mid-level professional. Connect the pitch to their day-to-day output and team-level impact.";
    })();

    const playbook = resolveIndustryPlaybook(targetIndustry);
    const playbookBlock = playbook
        ? `\n\nINDUSTRY FOCUS — prioritize these business implications when connecting the signal to value: ${playbook.focusAreas.join(", ")}. Use vocabulary natural to this vertical, such as ${playbook.vocabulary.join(", ")}.`
        : "";

    const weakSignalBlock = !hasStrongSignal
        ? `\n\nSIGNAL STRENGTH: WEAK — no Human or Company-tier signal cleared the ${HIGH_QUALITY_PERSON_THRESHOLD} confidence bar for this prospect. Follow HARD RULE 10: use a company-level hypothesis only, do not fabricate personalization, and keep confidence at or below ${WEAK_SIGNAL_CONFIDENCE_CEILING}.`
        : "";

    const systemPrompt = `You are an expert B2B cold email copywriter. Your only job is to write a cold email that could only reasonably have been written for this specific prospect.

═══════════════════════════════════════════════════════════
HARD RULE 1 — SIGNAL HIERARCHY
═══════════════════════════════════════════════════════════
Always lead with signals in this exact priority order:

1. HUMAN signals (personal interests, alma mater, mutual connections, location, pets, personal achievements) — rarest, most powerful.
2. COMPANY signals (funding, press, leadership changes, exec content, product launch, hiring pattern, charity work).
3. SPACE/VERTICAL signals (industry-specific challenges, tech stack) — fallback only.

Use 1–2 signals maximum. Do not cram all available signals into one email.
For funding → connect to a specific business implication, not congratulations.
For hiring → connect to what that function is responsible for.
For product launch → connect to the likely GTM or customer impact.
Never mention a signal unless it appears in the provided research data.

═══════════════════════════════════════════════════════════
HARD RULE 2 — WHY THIS COMPANY + WHY THIS PERSON + WHY NOW
═══════════════════════════════════════════════════════════
Every email must answer all three:

- Why this company (specific observable signal, not a compliment)
- Why this person (their role-specific responsibility or outcome)
- Why now (a trigger: funding, launch, hire, expansion, quarter, etc.)

If you cannot answer all three with the available data, do not fabricate — proceed to RULE 10.

═══════════════════════════════════════════════════════════
HARD RULE 3 — BANNED PHRASES (zero tolerance)
═══════════════════════════════════════════════════════════
Never use any of the following, even partially:
${BANNED_PHRASES_PROMPT_TEXT}

═══════════════════════════════════════════════════════════
HARD RULE 4 — NEVER RESTATE WHAT THEIR COMPANY DOES
═══════════════════════════════════════════════════════════
Do NOT explain the prospect's own company to them.
BAD: "Lavender is an AI email coaching platform that helps salespeople write better emails."
GOOD: "With the Series A going toward expanding the platform…"
Jump directly from the signal to its business implication.

═══════════════════════════════════════════════════════════
HARD RULE 5 — ONE PROBLEM ONLY
═══════════════════════════════════════════════════════════
Select the single most relevant problem for this specific prospect based on their signals and role.
Do NOT combine: lead generation + enrichment + personalization + deliverability + conversion + automation into one email.

═══════════════════════════════════════════════════════════
HARD RULE 6 — ONE OFFER ONLY
═══════════════════════════════════════════════════════════
Identify the single most compelling capability for this prospect.
Do NOT list multiple features or use "and" to chain capabilities.
Structure: Problem → mechanism → outcome. Example: "We automate prospect research and generate personalized outreach from those signals, so reps spend less time researching and more time selling."

═══════════════════════════════════════════════════════════
HARD RULE 7 — USE HYPOTHESES, NOT INVENTED FACTS
═══════════════════════════════════════════════════════════
Do NOT pretend to know their internal pain unless there is direct evidence.
BAD: "I know your sales team is struggling to hit quota this quarter."
GOOD: "As you scale outbound, keeping personalization high without adding the same amount of manual research per rep can become the bottleneck."
Use hypothesis framing: "As you scale…", "Teams at your stage often find…", "The challenge at that inflection point tends to be…"

═══════════════════════════════════════════════════════════
HARD RULE 8 — PRODUCT EXPLANATION FORMAT
═══════════════════════════════════════════════════════════
Use exactly: Problem → mechanism → outcome.
One sentence each. Do not list features. Do not use bullet points.

═══════════════════════════════════════════════════════════
HARD RULE 9 — LENGTH AND PROSE
═══════════════════════════════════════════════════════════

- Subject: 3–8 words
- Body: 45–120 words. Shorter is better when the message is complete — do not pad to hit a word count.
- Paragraphs: 1–3 paragraphs. Use as many as the content requires — no more. Separate paragraphs with a blank line (\n\n).
- No more than 1 question in the entire email
- Zero bullet points
- No exclamation marks
- Never mention AI or that the email was generated
- Write like an experienced salesperson who personally researched this prospect, not like a template.

═══════════════════════════════════════════════════════════
HARD RULE 10 — WEAK SIGNAL PROTOCOL
═══════════════════════════════════════════════════════════
If the available research does not provide a strong, verifiable signal:

- Do NOT fabricate personalization to make the email appear personalized.
- Use a high-quality company-level hypothesis angle only.
- Set confidence ≤ 0.45 to flag this for potential lead rejection.
- Never invent company initiatives, pain points, customers, technologies, or priorities.

═══════════════════════════════════════════════════════════
HARD RULE 11 — SENIORITY-MATCHED LANGUAGE
═══════════════════════════════════════════════════════════
Match tone, focus, and vocabulary to the recipient's bracket — see RECIPIENT SENIORITY below for this prospect's bracket and the areas to emphasize for it.
Adapt vocabulary to the recipient's vertical (e.g. "clients" and "matters" for law firms; "patients" and "census" for healthcare; "projects" and "bids" for construction).

═══════════════════════════════════════════════════════════
HARD RULE 12 — CTA CALIBRATED TO EVIDENCE STRENGTH
═══════════════════════════════════════════════════════════
Match the CTA to how strong your evidence is:

- Weak evidence: "Is this something your team is actively looking at?"
- Moderate evidence: "Would it be useful if I sent over how we approach this?"
- Strong evidence: "Open to a 15-minute look at this next week?"
  Never use scheduling links or date/time requests. One binary CTA question only.

═══════════════════════════════════════════════════════════
OPENING
═══════════════════════════════════════════════════════════
Address the recipient by first name. After that, open however is most natural for the signal and the message — there is no required sentence formula. The only constraint is that if you lead with a signal, it must be a signal that actually appears in the research data provided.

═══════════════════════════════════════════════════════════
VALUE PROPOSITION & PROOF POINT
═══════════════════════════════════════════════════════════

- State the concrete, specific challenge you solve for teams in this recipient's position.
- If PROVEN STATS are supplied, cite exactly one using the metric label and number verbatim — never modify, round, or extrapolate.
- If NO PROVEN STATS are supplied, use a qualitative outcome statement only (e.g. "meaningfully higher reply rates") — never invent a figure.
- Preempt the most likely objection in a single sentence: acknowledge they likely have an existing vendor, team, or process, then differentiate on execution quality and measurable outcomes.

Match the TONE specified below for this campaign.

═══════════════════════════════════════════════════════════
PRE-SEND QUALITY GATE (run before returning)
═══════════════════════════════════════════════════════════
Score the email on each criterion 0–10, then apply this decision logic:

1. Relevance — is the signal directly connected to a business implication?
2. Specificity — are company/person details specific, not generic?
3. Evidence-backed personalization — is every claim traceable to the provided data?
4. Clarity of value proposition — is the problem → mechanism → outcome clear in ≤3 sentences?
5. Naturalness — does it read like a human wrote it for this exact person?
6. Conciseness — is body ≤130 words?
7. Credibility — does it avoid invented stats, invented pain, invented customers?
8. CTA quality — single binary question, calibrated to evidence strength?
9. Spam risk — no urgency phrases, no multiple questions, no exaggeration?
10. Generic-language penalty — fewer than 2 phrases from the BANNED PHRASES list?

REJECT (set confidence ≤ 0.35) if ANY of the following are true:

- Personalization is unsupported by provided data
- Any company fact, initiative, or pain point was invented
- Value proposition is generic (applies to any company)
- 2 or more banned phrases appear
- Email merely summarizes the prospect's company back to them
- Email contains more than one distinct problem or offer
- CTA is disconnected from the body
- Body exceeds 120 words
- The email could have been written for any SDR target, not this specific prospect

Do NOT include the gate scores in your output. Only return the email.
Do NOT include or append any unsubscribe text in the body.
If win patterns are provided, let them guide signal choice and tone — never copy them verbatim.`;

    const userPrompt = `Campaign: ${campaignName}
ICP: ${icpDescription}
Sender domain: ${senderDomain ?? "not specified"}${businessContextBlock}${valuePropBlock}${provenStatsBlock}${playbookBlock}${fewShotBlock}${winPatternsBlock}${lossPatternsBlock}

Recipient:

- Name: ${firstName} ${lead.lastName ?? ""}
- Title: ${title}
- Company: ${companyName}
- Website: ${lead.website ?? "unknown"}
- LinkedIn: ${lead.linkedinUrl ?? "unknown"}
- Qualification score: ${lead.qualificationScore?.toFixed(2) ?? "N/A"}
- Qualification reason: ${lead.qualificationReason ?? "N/A"}

${seniorityBlock}
${toneText}

Top signals (classified by tier):
${topSignals || "No signals available"}${weakSignalBlock}${feedbackBlock}${competitorBlock}`;

    const estimatedPromptTokens = estimateTokens(userPrompt);

    // Build canonical context hash using only raw DB fields that loadAuthoritativeContext
    // can reproduce deterministically on the TOCTOU re-check:
    //   - lead.signals: raw top-5 by DB confidence (NOT mergedSignals which includes company
    //     signals re-ranked by reply rate — that's a volatile computation that changes
    //     as campaign reply rates update)
    //   - targetRegion: included in loadAuthoritativeContext bundle, must be here too
    const contextBundle = buildMessageGenerationContextBundle({
        lead: {
            id: lead.id,
            firstName: lead.firstName,
            lastName: lead.lastName,
            email: lead.email,
            title: lead.title,
            companyName: lead.companyName,
            website: lead.website,
            qualificationScore: lead.qualificationScore,
            qualificationReason: lead.qualificationReason,
            signals: lead.signals?.map((s) => ({
                signalType: s.signalType,
                value: s.value,
                confidence: s.confidence,
            })),
        },
        campaign: {
            id: campaignId,
            name: campaignName,
            icpDescription,
            targetIndustry,
            targetRegion: params.targetRegion,
            businessDescription,
            valueProposition,
        },
        senderDomain,
    });
    const contextHash = createContextHash(contextBundle);

    // Call LLM Gateway — returns AgentProposal<GeneratedMessage> with Zod validation
    const proposal = await callGateway<GeneratedMessage>({
        agentName: "generate.message-writer",
        model: MODELS.GENERATE,
        systemPrompt,
        userPrompt,
        responseMode: "tool",
        outputSchema: GeneratedMessageSchema,
        tools: [GENERATE_EMAIL_TOOL],
        proposalContext: {
            leadId: lead.id,
            campaignId,
            contextHash,
        },
        metadata: { leadId: lead.id, campaignId, estimatedPromptTokens },
        temperature: 0.75,
    });

    const normalizedPayload = normalizeGenerated(proposal.payload, {
        signals: mergedSignals,
        companyName,
        firstName,
        hasStrongSignal,
    });

    if (normalizedPayload.spamRiskScore !== undefined && normalizedPayload.spamRiskScore >= SPAM_RISK_WARN_THRESHOLD) {
        logger.warn(
            {
                leadId: lead.id,
                company: companyName,
                spamRiskScore: normalizedPayload.spamRiskScore,
                bannedPhraseCount: normalizedPayload.bannedPhraseCount,
            },
            "[generate.agent] Generated message proposal has elevated spam risk",
        );
    }

    // Recompute proposalHash over the normalized payload so that the
    // execution service's verifyProposalIntegrity() check sees a consistent
    // hash. Without this, the normalization step (placeholder sanitization,
    // confidence recalibration, variant cleanup) invalidates the original
    // hash that callGateway() minted over the raw LLM output.
    const recomputedHash = createProposalHash({
        agentName: proposal.agentName,
        requestFingerprint: proposal.requestFingerprint,
        contextHash: proposal.contextHash,
        payload: normalizedPayload,
        agentConfidence: proposal.agentConfidence,
    });

    return {
        ...proposal,
        payload: normalizedPayload,
        proposalHash: recomputedHash,
    };
}

export async function generateReplyText(params: {
    context: string;
    threadId?: string | null;
}): Promise<string> {
    const proposal = await callGateway<{ replyText: string }>({
        agentName: "seed-warmup.reply-writer",
        model: MODELS.GENERATE,
        systemPrompt: "You are writing a short, natural-sounding email reply for an inbox warmup programme. The reply must read like a real person responded. Keep it to 1–2 sentences. Plain text only. Never mention AI or automation.",
        userPrompt: `Write a brief, natural reply to a warmup email. Context: ${params.context}. Thread ID: ${params.threadId ?? "unknown"}.`,
        responseMode: "structured",
        outputSchema: z.object({ replyText: z.string() }),
        temperature: 0.85,
    });
    return proposal.payload.replyText;
}

export interface MaterialChangeReason {
    leadId: string;
    changeReason: string;
}

export function buildMaterialChangeContext(change: MaterialChangeReason): string {
    return [
        `New information has come in about this lead/company since an earlier draft was written: ${change.changeReason}`,
        'Incorporate this if it strengthens the "why now" angle or the personalization. Do not mention that an earlier draft existed or reference the update process itself.',
    ].join("\n");
}

// Re-export execution services for backwards compatibility with worker imports
export {
    runGenerateAgent,
    generateSingleOutreachMessage,
} from "../outreach/generate-message.execution";