import pLimit from "p-limit";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { callGeminiWithTools, MODELS, SchemaType, ToolDefinition } from "./gemini.client";
import { getFewShotExamples, FewShotExample, createLearningEvent } from "../learning/learning.service";
import { getWinPatterns, getLossPatterns, WinPattern, LossPattern } from "../memory/memory.service";
import { LEARNING_EVENT_TYPES, LEARNING_OUTCOMES } from "../../lib/constants";
import { logger } from "../../lib/logger";
import { emitCampaignEvent } from "../../lib/campaign-events";
import { RejectionReason } from "./review.agent";

const DEFAULT_QUALIFICATION_THRESHOLD = 0.5;
const SPAM_RISK_WARN_THRESHOLD = 0.7;
const HIGH_QUALITY_PERSON_THRESHOLD = 0.85;
const HIGH_QUALITY_SPAM_THRESHOLD = 0.2;

const CHARS_PER_TOKEN_ESTIMATE = 4;
const MAX_DYNAMIC_CONTEXT_TOKENS = 4_000;
const MAX_DYNAMIC_CONTEXT_CHARS = MAX_DYNAMIC_CONTEXT_TOKENS * CHARS_PER_TOKEN_ESTIMATE;

const GENERATION_HEURISTIC_WEIGHT = 0.6;
const GENERATION_LLM_CONFIDENCE_WEIGHT = 1 - GENERATION_HEURISTIC_WEIGHT;

interface GeneratedMessage {
    subject: string;
    subjectVariant?: string;
    body: string;
    confidence: number;
    leadingSignal?: string;
    rawLlmConfidence?: number;
    heuristicScore?: number;
    estimatedPromptTokens?: number;
}

type LeadWithSignals = Prisma.LeadGetPayload<{
    include: {
        signals: true;
        company: { include: { signals: true } };
    };
}> & {
    competitorSignal?: boolean;
    competitorTech?: string[];
};

/** Merge lead-level and company-level signals, deduplicate by (type+value), sort by confidence desc. */
function mergeSignals(
    leadSignals: LeadWithSignals["signals"],
    companySignals: NonNullable<LeadWithSignals["company"]>["signals"],
    take = 5
): LeadWithSignals["signals"] {
    const seen = new Set<string>();
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

function computeGenerationHeuristicScore(
    message: GeneratedMessage,
    context: { signals: LeadWithSignals["signals"]; companyName: string },
): number {
    const checks: boolean[] = [];

    const leadingSignal = message.leadingSignal?.trim() ?? "";
    checks.push(leadingSignal.length > 0);

    const isGrounded =
        leadingSignal.length > 0 &&
        context.signals.some((s) => leadingSignal.includes(s.signalType));
    checks.push(isGrounded);

    const bodyWordCount = message.body.trim().split(/\s+/).filter(Boolean).length;
    checks.push(bodyWordCount >= 25 && bodyWordCount <= 160);

    const subjectWordCount = message.subject.trim().split(/\s+/).filter(Boolean).length;
    checks.push(subjectWordCount >= 4 && subjectWordCount <= 12);

    checks.push(Boolean(message.subjectVariant));

    const company = context.companyName.trim();
    const mentionsCompany = company.length > 2 && message.body.toLowerCase().includes(company.toLowerCase());
    checks.push(mentionsCompany);

    const passed = checks.filter(Boolean).length;
    return checks.length > 0 ? passed / checks.length : 0;
}

function normalizeGenerated(
    raw: GeneratedMessage,
    context: { signals: LeadWithSignals["signals"]; companyName: string },
): GeneratedMessage {
    const subject = raw.subject;
    const subjectVariant =
        raw.subjectVariant && raw.subjectVariant.trim() !== subject.trim()
            ? raw.subjectVariant
            : undefined;

    const rawLlmConfidence = clampScore(raw.confidence);

    const normalized: GeneratedMessage = {
        ...raw,
        subjectVariant,
        confidence: rawLlmConfidence,
    };

    const heuristicScore = computeGenerationHeuristicScore(normalized, context);
    const blendedConfidence = clampScore(
        GENERATION_HEURISTIC_WEIGHT * heuristicScore +
        GENERATION_LLM_CONFIDENCE_WEIGHT * rawLlmConfidence,
    );

    return {
        ...normalized,
        confidence: blendedConfidence,
        rawLlmConfidence,
        heuristicScore,
    };
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
                        "Alternative subject line. If two or more strong personal hooks exist (e.g. location, alma mater, personal interest, mutual connection), produce a plus-delimited sequence of those tokens followed by the sender company name — e.g. 'Geneva + Dogs + L\'Auberge + [Sender Company]'. This format makes the subject meaningless to anyone except the recipient and dramatically improves open rates. Otherwise fall back to a different structural angle (question vs. statement, or lead with the signal instead of the company name). Max 9 words. Must be meaningfully different — never identical or a trivial reword.",
                },
                body: {
                    type: SchemaType.STRING,
                    description: "Email body: 4–6 sentences, plain text, no bullet points.",
                },
                confidence: {
                    type: SchemaType.NUMBER,
                    description: "Your confidence in the quality of this email 0.0–1.0.",
                },
                leadingSignal: {
                    type: SchemaType.STRING,
                    description: "The signal type you opened with, e.g. HIRING_SIGNAL.",
                },
            },
            required: [
                "subject",
                "subjectVariant",
                "body",
                "confidence",
                "leadingSignal",
            ],
        },
    },
    handler: async (args) => args,
};

async function generateMessageForLead(params: {
    lead: LeadWithSignals;
    campaignId: string;
    icpDescription: string;
    campaignName: string;
    senderDomain?: string;
    fewShotExamples?: FewShotExample[];
    winPatterns?: WinPattern[];
    lossPatterns?: LossPattern[];
    feedbackContext?: string;
    unsubscribeFooter?: string;
}): Promise<GeneratedMessage> {
    const { lead, campaignId, icpDescription, campaignName, senderDomain, feedbackContext, unsubscribeFooter } = params;

    const firstName = lead.firstName ?? "there";
    const companyName = lead.companyName;
    const title = lead.title ?? "professional";

    const mergedSignals = mergeSignals(lead.signals, lead.company?.signals ?? []);
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

    const enrichmentData = (lead.enrichmentData as Record<string, unknown> | null) ?? {};
    const rawScrapedText = typeof enrichmentData.scrapedHomepageText === "string"
        ? enrichmentData.scrapedHomepageText
        : null;
    const scrapedTextCap = Math.max(0, Math.min(1_500, contextBudget.charsRemaining));
    const scrapedText = rawScrapedText ? rawScrapedText.slice(0, scrapedTextCap) : null;
    if (scrapedText) contextBudget.charsRemaining -= scrapedText.length;

    const websiteBlock = scrapedText
        ? `\n\nCOMPANY WEBSITE CONTENT (use for additional context, do not quote verbatim):\n${scrapedText}`
        : "";

    const isCompetitorLead = lead.competitorSignal === true;
    const competitorTools = (lead.competitorTech ?? []).join(", ");

    const competitorBlock = isCompetitorLead && competitorTools
        ? `\n\nCOMPETITOR DISPLACEMENT — This prospect currently uses: ${competitorTools}. State the exact challenge you solve. Then preempt their most likely objection inline in a single sentence: acknowledge they likely already have a vendor or internal team handling this, then differentiate by focusing on execution quality, measurable outcomes, and business impact — not software features. Do NOT name the competitor directly. Tone: confident, peer-to-peer, not aggressive.`
        : isCompetitorLead
            ? `\n\nCOMPETITOR DISPLACEMENT — This prospect uses a competing product. State the challenge you solve, then preempt the obvious objection: acknowledge they have a solution already, and differentiate on outcomes and execution. Confident, peer-to-peer tone.`
            : "";

    const systemPrompt = `You are an expert B2B cold email copywriter. Write highly personalised, concise cold outreach emails.

SIGNAL HIERARCHY — always prioritise in this order:
1. HUMAN signals (personal interests, alma mater, mutual connections, location, pets, personal achievements). These are the rarest and most powerful hooks. If available, lead with one.
2. COMPANY signals (press releases, charity work, funding, leadership changes, executive podcasts/articles, values). Use when no Human signal is available.
3. SPACE/VERTICAL signals (hiring patterns, tech stack, industry-specific challenges). Use as supporting context or fallback.

FIRST SENTENCE — you must use exactly one of these two patterns:
Option A (Polite Peer Intro): "Hi [Lead FirstName], we have yet to be properly introduced — I'm [infer sender name from domain] and..." — signals peer context and implies you should already know each other.
Option B (Direct SMYKM Hook): Launch immediately into the personal or company observation: "Hi [Lead FirstName], [specific observation tied to the strongest signal]..." — only use this when you have a strong Human or Company hook worth opening with.

VALUE PROPOSITION — pitch the challenge solved, not the product features. Then preempt the most obvious objection inline in a single sentence.

CTA RULES (mandatory):
- Never include a calendar scheduling link (Calendly, Cal.com, HubSpot meetings, etc.).
- Never request specific short timelines like "15 minutes tomorrow" or "Monday at 1 PM".
- Close with this polite timing formula (verbatim or near-verbatim): "Do you have time over the next week or two to learn more? Let me know what works for you and I'll send a calendar invite along accordingly."

ADDITIONAL RULES:
- Subject line: 6–9 words, no clickbait, no ALL CAPS
- Body: 4–6 sentences max, plain text, no bullet points
- Never use exclamation marks
- Never mention "AI" or that the email was generated
- Tone: warm, peer-to-peer, not salesy
- Adapt your vocabulary to the recipient's vertical (e.g. "clients" and "business development" for law firms; "leads" and "pipeline" for tech companies)
- If win patterns are provided, let them guide your signal choice and tone — do not copy them verbatim
- Append the unsubscribe footer exactly as given at the very end of the body, after two newlines — do not modify or omit it`;

    const userPrompt = `Campaign: ${campaignName}
ICP: ${icpDescription}
Sender domain: ${senderDomain ?? "not specified"}

Recipient:
- Name: ${firstName} ${lead.lastName ?? ""}
- Title: ${title}
- Company: ${companyName}
- Website: ${lead.website ?? "unknown"}
- LinkedIn: ${lead.linkedinUrl ?? "unknown"}
- Qualification score: ${lead.qualificationScore?.toFixed(2) ?? "N/A"}
- Qualification reason: ${lead.qualificationReason ?? "N/A"}

Top signals (classified by tier):
${topSignals || "No signals available"}${websiteBlock}${fewShotBlock}${winPatternsBlock}${lossPatternsBlock}${feedbackBlock}${competitorBlock}${unsubscribeFooter ? `\n\nUnsubscribe footer to append verbatim:\n${unsubscribeFooter}` : ""}`;

    const estimatedPromptTokens = estimateTokens(userPrompt);

    const { result } = await callGeminiWithTools<GeneratedMessage>({
        agentName: "generate.message-writer",
        model: MODELS.GENERATE,
        systemPrompt,
        userPrompt,
        tools: [GENERATE_EMAIL_TOOL],
        metadata: { leadId: lead.id, campaignId, estimatedPromptTokens },
        temperature: 0.75,
    });

    const normalized = normalizeGenerated(result, { signals: mergedSignals, companyName });

    return { ...normalized, estimatedPromptTokens };
}

function buildFeedbackContext(rejection: RejectionReason): string {
    const lines: string[] = [`Reasons: ${rejection.reasons.join(", ")}`];

    if (rejection.reasons.some((r) => r.startsWith("spam_too_high"))) {
        lines.push(
            "Fix spam: remove generic/urgency phrases, strip pushy CTAs, open with a specific observation instead of a question.",
        );
    }
    if (rejection.reasons.some((r) => r.startsWith("personalization_too_low"))) {
        lines.push(
            "Fix personalization: lead with a company-specific signal, reference exact signal values, tie the CTA to the recipient's role.",
        );
    }

    return lines.join("\n");
}

export async function runGenerateAgent(
    campaignId: string,
    options: { feedbackMap?: Record<string, RejectionReason> } = {},
): Promise<void> {
    const { feedbackMap } = options;
    const isRegenerationPass = feedbackMap != null && Object.keys(feedbackMap).length > 0;

    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        include: {
            senderDomain: { select: { domain: true } },
        },
    });

    if (!campaign) throw new Error("Campaign not found");

    const brandSettings = await prisma.brandSettings.findUnique({
        where: { userId: campaign.createdById },
        select: { unsubscribeText: true },
    });

    const unsubscribeFooter =
        brandSettings?.unsubscribeText ??
        "You received this email because you match our ideal customer profile. To unsubscribe, reply with 'unsubscribe'.";

    const qualificationThreshold =
        campaign.qualificationThreshold ?? DEFAULT_QUALIFICATION_THRESHOLD;
    const isLinkedInCampaign = !!campaign.linkedInAccountId;

    let leads: LeadWithSignals[];

    if (isRegenerationPass) {
        const leadIds = Object.keys(feedbackMap!);

        await prisma.outreachMessage.deleteMany({
            where: {
                leadId: { in: leadIds },
                approvalStatus: "PENDING",
                deliveryState: "DRAFT",
            },
        });

        leads = await prisma.lead.findMany({
            where: {
                id: { in: leadIds },
                campaignId,
                ...(!isLinkedInCampaign && {
                    email: { not: null },
                    emailStatus: "FOUND",
                }),
                deletedAt: null,
            },
            include: {
                signals: { orderBy: { confidence: "desc" }, take: 5 },
                company: { include: { signals: { orderBy: { confidence: "desc" }, take: 5 } } },
            },
        });
    } else {
        leads = await prisma.lead.findMany({
            where: {
                campaignId,
                ...(!isLinkedInCampaign && {
                    email: { not: null },
                    emailStatus: "FOUND",
                }),
                outreachMessages: { none: {} },
                qualificationScore: { gte: qualificationThreshold },
                deletedAt: null,
            },
            include: {
                signals: { orderBy: { confidence: "desc" }, take: 5 },
                company: { include: { signals: { orderBy: { confidence: "desc" }, take: 5 } } },
            },
            orderBy: { qualificationScore: "desc" },
        });
    }

    if (leads.length === 0) {
        logger.info({ campaignId }, "[generate.agent] No qualifying leads — skipping generation");
        return;
    }

    const [fewShotExamples, winPatterns, lossPatterns] = await Promise.all([
        getFewShotExamples({
            limit: 5,
            icpDescription: campaign.icpDescription,
            targetIndustry: campaign.targetIndustry ?? undefined,
            targetRegion: campaign.targetRegion ?? undefined,
        }).catch(() => []),
        getWinPatterns({
            targetIndustry: campaign.targetIndustry ?? undefined,
            targetRegion: campaign.targetRegion ?? undefined,
            limit: 6,
        }).catch(() => []),
        getLossPatterns({
            targetIndustry: campaign.targetIndustry ?? undefined,
            targetRegion: campaign.targetRegion ?? undefined,
            limit: 4,
        }).catch(() => []),
    ]);

    logger.info(
        {
            campaignId,
            leadCount: leads.length,
            fewShotCount: fewShotExamples.length,
            winPatternCount: winPatterns.length,
            lossPatternCount: lossPatterns.length,
            isRegenerationPass,
        },
        "[generate.agent] Generating messages",
    );

    const limit = pLimit(5);
    let completed = 0;
    const total = leads.length;

    await Promise.allSettled(
        leads.map((lead) =>
            limit(async () => {
                try {
                    const rejection = feedbackMap?.[lead.id];
                    const feedbackContext = rejection
                        ? buildFeedbackContext(rejection)
                        : undefined;

                    const generated = await generateMessageForLead({
                        lead,
                        campaignId,
                        icpDescription: campaign.icpDescription,
                        campaignName: campaign.name,
                        senderDomain: campaign.senderDomain?.domain,
                        fewShotExamples,
                        winPatterns,
                        lossPatterns,
                        feedbackContext,
                        unsubscribeFooter,
                    });

                    await prisma.outreachMessage.create({
                        data: {
                            leadId: lead.id,
                            subject: generated.subject,
                            body: generated.body,
                            leadingSignal: generated.leadingSignal ?? null,
                            generationConfidence: generated.confidence,
                            approvalStatus: "PENDING",
                            deliveryState: "DRAFT",
                            ...(generated.subjectVariant && {
                                diffVector: {
                                    subjectVariant: generated.subjectVariant,
                                } as Prisma.InputJsonValue,
                            }),
                        },
                    });

                    logger.info(
                        {
                            company: lead.companyName,
                            leadingSignal: generated.leadingSignal,
                            confidence: generated.confidence,
                            rawLlmConfidence: generated.rawLlmConfidence,
                            heuristicScore: generated.heuristicScore,
                            estimatedPromptTokens: generated.estimatedPromptTokens,
                            hasSubjectVariant: Boolean(generated.subjectVariant),
                        },
                        "[generate.agent] Message created",
                    );

                    completed++;
                    if (completed % 3 === 0 || completed === total) {
                        emitCampaignEvent({
                            campaignId,
                            type: "progress",
                            jobName: "run-generate",
                            label: "Message Generation",
                            progress: Math.round((completed / total) * 100),
                            detail: `Generating ${completed}/${total}`,
                        });
                    }
                } catch (err) {
                    logger.error(
                        { err, leadId: lead.id, company: lead.companyName },
                        "[generate.agent] Failed for lead",
                    );
                }
            }),
        ),
    );

    emitCampaignEvent({
        campaignId,
        type: "completed",
        jobName: "run-generate",
        label: "Message Generation",
        detail: `${completed} messages created`,
    });
    logger.info({ campaignId }, "[generate.agent] Done. Returning control to orchestrator.");
}

export async function generateSingleOutreachMessage(
    leadId: string,
    userId: string,
) {
    const lead = await prisma.lead.findFirst({
        where: { id: leadId, deletedAt: null },
        include: {
            signals: { orderBy: { confidence: "desc" }, take: 5 },
            company: { include: { signals: { orderBy: { confidence: "desc" }, take: 5 } } },
        },
    });

    if (!lead) throw new Error("Lead not found");

    const campaign = await prisma.campaign.findUnique({
        where: { id: lead.campaignId },
        include: {
            senderDomain: { select: { domain: true } },
        },
    });

    if (!campaign) throw new Error("Campaign not found");

    if (campaign.createdById !== userId) {
        throw new Error("Unauthorized");
    }

    const brandSettings = await prisma.brandSettings.findUnique({
        where: { userId: campaign.createdById },
        select: { unsubscribeText: true },
    });

    const unsubscribeFooter =
        brandSettings?.unsubscribeText ??
        "You received this email because you match our ideal customer profile. To unsubscribe, reply with 'unsubscribe'.";

    const [fewShotExamples, winPatterns, lossPatterns] = await Promise.all([
        getFewShotExamples({
            limit: 5,
            icpDescription: campaign.icpDescription,
            targetIndustry: campaign.targetIndustry ?? undefined,
            targetRegion: campaign.targetRegion ?? undefined,
        }).catch(() => []),
        getWinPatterns({
            targetIndustry: campaign.targetIndustry ?? undefined,
            targetRegion: campaign.targetRegion ?? undefined,
            limit: 6,
        }).catch(() => []),
        getLossPatterns({
            targetIndustry: campaign.targetIndustry ?? undefined,
            targetRegion: campaign.targetRegion ?? undefined,
            limit: 4,
        }).catch(() => []),
    ]);

    const generated = await generateMessageForLead({
        lead,
        campaignId: lead.campaignId,
        icpDescription: campaign.icpDescription,
        campaignName: campaign.name,
        senderDomain: campaign.senderDomain?.domain,
        fewShotExamples,
        winPatterns,
        lossPatterns,
        unsubscribeFooter,
    });

    return prisma.outreachMessage.create({
        data: {
            leadId: lead.id,
            subject: generated.subject,
            body: generated.body,
            leadingSignal: generated.leadingSignal ?? null,
            generationConfidence: generated.confidence,
            approvalStatus: "PENDING",
            deliveryState: "DRAFT",
            ...(generated.subjectVariant && {
                diffVector: {
                    subjectVariant: generated.subjectVariant,
                } as Prisma.InputJsonValue,
            }),
        },
        include: {
            lead: {
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                    companyName: true,
                    campaignId: true,
                },
            },
        },
    });
}