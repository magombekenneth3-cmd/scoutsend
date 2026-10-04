import { Prisma, EmailStatus, PipelineStage } from "@prisma/client";
import pLimit from "p-limit";
import { prisma } from "../../lib/prisma";
import { MODELS } from "./gemini.client";
import { callGateway, FollowUpOutputSchema } from "../../lib/llm-gateway";
import type { FollowUpOutput } from "../../lib/llm-gateway";
import { getWinPatterns } from "../memory/memory.service";
import { runReviewAgent } from "./review.agent";
import { logger } from "../../lib/logger";
import { resolveOOOReturnDate } from "./reply.agent";
import {
    getRecentLeadJourney,
    summarizeLeadJourney,
} from "../../lib/leads/lead-journey.service";
import { CROSS_SYSTEM_SEND_COORDINATION_GUARD_HOURS } from "../../lib/constants";
import { sanitizePlaceholderTokens } from "./generate.agent";

type FollowUpStrategy =
    | "subject_rework"
    | "soft_nudge"
    | "signal_led"
    | "new_angle";

interface GeneratedFollowUp {
    subject: string;
    subjectVariant: string;
    body: string;
    strategy?: FollowUpStrategy;
    reason?: string;
    resourceAsset?: string;
}

type EngagementSignal = "OPENED" | "NOT_OPENED";

type LeadOutcome =
    | { status: "generated" }
    | { status: "skipped" }
    | { status: "errored"; reason: unknown };

const ACTIVE_CAMPAIGN_STATUSES = ["QUEUED", "SENDING"];
const EXHAUSTION_RATE_THRESHOLD = 0.6;
const OOO_FALLBACK_RETRY_DAYS = 7;
const MAX_ORIGINAL_BODY_CHARS = 4000;
const MAX_SUBJECT_CHARS = 200;
const MAX_BODY_CHARS = 12000;
const MAX_REASON_CHARS = 300;
const VALID_STRATEGIES = new Set<FollowUpStrategy>([
    "subject_rework",
    "soft_nudge",
    "signal_led",
    "new_angle",
]);

const BLOCKED_EMAIL_STATUSES = [
    EmailStatus.INVALID,
    EmailStatus.BOUNCED,
    EmailStatus.SUPPRESSED,
];

function computeStep1DelayDays(
    sentAt: Date,
    configuredDelayDays: number,
): number {
    const dayOfWeek = sentAt.getUTCDay();

    if (dayOfWeek === 4 || dayOfWeek === 5) {
        return dayOfWeek === 4 ? 2 : 1;
    }

    return Math.min(Math.max(configuredDelayDays, 1), 2);
}

function computeAdaptiveFollowUpPacing(params: {
    baseDelayDays: number;
    baseMaxSteps: number;
    qualificationScore: number | null;
    pipelineStage: PipelineStage;
}): { delayDays: number; maxSteps: number } {
    const {
        baseDelayDays,
        baseMaxSteps,
        qualificationScore,
        pipelineStage,
    } = params;

    const safeBaseDelay = Math.max(1, baseDelayDays);
    const safeBaseMaxSteps = Math.max(1, baseMaxSteps);

    const isHighEngagement =
        pipelineStage === "HOT" || pipelineStage === "ENGAGED";
    const isHighScore = (qualificationScore ?? 0) >= 0.8;
    const isLowScore =
        qualificationScore !== null && qualificationScore < 0.4;

    if (isHighEngagement || isHighScore) {
        return {
            delayDays: Math.max(1, Math.round(safeBaseDelay * 0.7)),
            maxSteps: safeBaseMaxSteps + 1,
        };
    }

    if (isLowScore) {
        return {
            delayDays: Math.max(1, Math.round(safeBaseDelay * 1.5)),
            maxSteps: Math.max(1, safeBaseMaxSteps - 1),
        };
    }

    return {
        delayDays: safeBaseDelay,
        maxSteps: safeBaseMaxSteps,
    };
}

function summarizeFreshSignalsByType(
    signals: Array<{ signalType: string }>,
): string {
    if (signals.length === 0) return "none";

    const counts = new Map<string, number>();

    for (const signal of signals) {
        counts.set(
            signal.signalType,
            (counts.get(signal.signalType) ?? 0) + 1,
        );
    }

    return Array.from(counts.entries())
        .map(([type, count]) => `${type} x${count}`)
        .join(", ");
}

function qualificationTierLabel(
    score: number | null,
): "high" | "medium" | "low" | "unknown" {
    if (score === null) return "unknown";
    if (score >= 0.8) return "high";
    if (score >= 0.4) return "medium";
    return "low";
}

function normalizeStrategy(value: unknown): FollowUpStrategy | undefined {
    if (
        typeof value === "string" &&
        VALID_STRATEGIES.has(value as FollowUpStrategy)
    ) {
        return value as FollowUpStrategy;
    }

    return undefined;
}

function truncateForPrompt(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}...`;
}

function containsSchedulingUrl(text: string): boolean {
    return /https?:\/\/[^\s<>"']+/i.test(text);
}

function normalizeGeneratedText(text: string, maxChars: number): string {
    return text.trim().slice(0, maxChars);
}

function isValidGeneratedFollowUp(
    value: unknown,
): value is GeneratedFollowUp {
    if (!value || typeof value !== "object") return false;

    const v = value as Record<string, unknown>;

    if (
        typeof v.subject !== "string" ||
        v.subject.trim().length === 0 ||
        v.subject.trim().length > MAX_SUBJECT_CHARS
    ) {
        return false;
    }

    if (
        typeof v.subjectVariant !== "string" ||
        v.subjectVariant.trim().length === 0 ||
        v.subjectVariant.trim().length > MAX_SUBJECT_CHARS
    ) {
        return false;
    }

    if (
        typeof v.body !== "string" ||
        v.body.trim().length === 0 ||
        v.body.trim().length > MAX_BODY_CHARS
    ) {
        return false;
    }

    if (
        containsSchedulingUrl(v.subject) ||
        containsSchedulingUrl(v.subjectVariant) ||
        containsSchedulingUrl(v.body)
    ) {
        return false;
    }

    return true;
}

async function generateFollowUp(params: {
    step: number;
    maxFollowUpSteps: number;
    engagementSignal: EngagementSignal;
    situationBlock: string;
    originalSubject: string;
    originalBody: string;
    leadFirstName: string;
    companyName: string;
    title: string;
    icpDescription: string;
    senderDomain: string | undefined;
    winPatternHints: string;
    freshSignalsBlock: string;
    campaignId: string;
    leadId: string;
}): Promise<GeneratedFollowUp> {
    const {
        step,
        maxFollowUpSteps,
        engagementSignal,
        situationBlock,
        originalSubject,
        originalBody,
        leadFirstName,
        companyName,
        title,
        icpDescription,
        senderDomain,
        winPatternHints,
        freshSignalsBlock,
        campaignId,
        leadId,
    } = params;

    const stepGuidance =
        step >= maxFollowUpSteps
            ? "a short final bump (2–3 sentences). Acknowledge this is your last reach-out. Make it easy to say no."
            : "a brief follow-up (3–4 sentences) taking a new angle from the earlier attempts without repeating prior phrasing. One soft CTA. Close with a single low-friction binary CTA question (e.g. \"Worth a short exchange on this?\" or \"Open to exploring this?\").";

    const engagementInstruction =
        engagementSignal === "OPENED"
            ? `The original email WAS OPENED but received no reply. The subject likely worked. Keep the subject similar or lightly rework it. Change the body angle rather than repeating the original pitch. If a fresh buying signal is substantially stronger, use "signal_led". Otherwise prefer "soft_nudge" for strong engagement or "new_angle" for weaker engagement.`
            : `No open was recorded for the original email. Open tracking can be blocked, so do not treat this as proof that the subject failed. Prefer "subject_rework" when there is no stronger fresh signal, with two genuinely distinct subject candidates. If a fresh buying signal is substantially stronger, use "signal_led".`;

    const proposal = await callGateway<FollowUpOutput>({
        agentName: `followup.writer.step${step}.${engagementSignal.toLowerCase()}`,
        model: MODELS.GENERATE,
        responseMode: "text",
        outputSchema: FollowUpOutputSchema,
        systemPrompt: `You are an expert B2B cold email copywriter writing follow-up emails.

Rules:

- Do NOT start with "I" or "Just following up"
- Never use "checking in", "circling back", or "touching base"
- Never use exclamation marks
- Never open with "I hope this email finds you well", "Hope you're having a good week", or any similar pleasantry
- Reference something specific from the original email
- Shorter than the original
- One soft CTA
- Never mention AI
- Tone: peer-to-peer, warm, direct
- Never include any URL
- Never include a calendar scheduling link
- Close with a single low-friction binary CTA question. Never ask for a calendar invite or specific times.

ENGAGEMENT CONTEXT:
${engagementInstruction}

Choose exactly ONE strategy:
- "subject_rework": little or no engagement and no stronger fresh signal. Produce two genuinely distinct subject candidates.
- "soft_nudge": the lead has opened more than once or otherwise shows meaningful engagement, with no stronger fresh signal. Keep the subject close to the working angle and improve the body.
- "signal_led": a fresh buying signal is clearly a stronger hook than the original email. Lead with that signal.
- "new_angle": moderate or unclear engagement with no standout fresh signal. Take a genuinely different angle.

Return ONLY JSON:
{
"strategy": "subject_rework" | "soft_nudge" | "signal_led" | "new_angle",
"reason": string,
"subject": string,
"subjectVariant": string,
"body": string
}`,
        userPrompt: `Write ${stepGuidance}

ICP: ${icpDescription}
Sender domain: ${senderDomain ?? "not specified"}

Recipient:

- Name: ${leadFirstName}
- Title: ${title}
- Company: ${companyName}

SITUATION:
${situationBlock}

Original subject:
${originalSubject}

Original body:
${truncateForPrompt(originalBody, MAX_ORIGINAL_BODY_CHARS)}${freshSignalsBlock}${winPatternHints}`,
        proposalContext: { leadId, campaignId },
        metadata: { campaignId, leadId, step, engagementSignal },
        temperature: 0.7,
    });

    const followUp = proposal.payload;

    if (!isValidGeneratedFollowUp(followUp)) {
        throw new Error(
            `[followup.agent] Invalid LLM output for lead ${leadId} step ${step}: ${JSON.stringify(followUp)}`,
        );
    }

    const rawSubject = normalizeGeneratedText(followUp.subject, MAX_SUBJECT_CHARS);
    const rawSubjectVariant = normalizeGeneratedText(followUp.subjectVariant, MAX_SUBJECT_CHARS);
    const rawBody = normalizeGeneratedText(followUp.body, MAX_BODY_CHARS);

    return {
        subject: sanitizePlaceholderTokens(rawSubject, leadFirstName, companyName),
        subjectVariant: sanitizePlaceholderTokens(rawSubjectVariant, leadFirstName, companyName),
        body: sanitizePlaceholderTokens(rawBody, leadFirstName, companyName),
        strategy: normalizeStrategy(followUp.strategy),
        reason:
            typeof followUp.reason === "string"
                ? followUp.reason.trim().slice(0, MAX_REASON_CHARS)
                : undefined,
    };
}

async function generateBreakUpEmail(params: {
    maxFollowUpSteps: number;
    engagementSignal: EngagementSignal;
    situationBlock: string;
    originalSubject: string;
    originalBody: string;
    leadFirstName: string;
    companyName: string;
    title: string;
    icpDescription: string;
    senderDomain: string | undefined;
    winPatternHints: string;
    freshSignalsBlock: string;
    campaignId: string;
    leadId: string;
}): Promise<GeneratedFollowUp> {
    const {
        engagementSignal,
        situationBlock,
        originalSubject,
        originalBody,
        leadFirstName,
        companyName,
        title,
        icpDescription,
        senderDomain,
        winPatternHints,
        freshSignalsBlock,
        campaignId,
        leadId,
    } = params;

    const proposal = await callGateway<FollowUpOutput>({
        agentName: `followup.break-up.${engagementSignal.toLowerCase()}`,
        model: MODELS.GENERATE,
        responseMode: "text",
        outputSchema: FollowUpOutputSchema,
        systemPrompt: `You are an expert B2B cold email copywriter writing a final break-up email.

This is the LAST email in the sequence. Your goal is to leave a positive, memorable impression and offer one concrete piece of value before stepping away.

Rules:

- Do NOT start with "I" or "Just following up"
- Never use "checking in", "circling back", or "touching base"
- Never use exclamation marks
- Never open with pleasantries like "I hope this email finds you well"
- 3–4 sentences maximum
- Acknowledge this is your last reach-out, but frame it positively
- Offer ONE high-value resource asset relevant to their role and industry
- Choose the most compelling from:
  • A relevant case study or customer story
  • An industry benchmark report or data insight
  • An ROI calculator or framework specific to their function
  • A short checklist or playbook for a problem they likely face
- Make the resource feel like a genuine gift, not a bait-and-switch
- Do NOT include any URL
- Do NOT include a calendar scheduling link
- End with: "If timing ever changes, I'm here. Wishing you a great quarter."
- Tone: warm, peer-to-peer, no desperation
- Use the SITUATION below to pick the resource asset that is most relevant
- Do not invent a URL or claim that a resource link is attached

Return ONLY JSON:
{
"subject": string,
"subjectVariant": string,
"body": string,
"resourceAsset": string
}`,
        userPrompt: `Write a final break-up email for this prospect.

ICP: ${icpDescription}
Sender domain: ${senderDomain ?? "not specified"}

Recipient:

- Name: ${leadFirstName}
- Title: ${title}
- Company: ${companyName}

SITUATION:
${situationBlock}

Original subject:
${originalSubject}

Original body:
${truncateForPrompt(originalBody, MAX_ORIGINAL_BODY_CHARS)}${freshSignalsBlock}${winPatternHints}

Choose the most relevant resource asset for this person's role and company context. Describe it in 1 sentence in the "resourceAsset" field. Weave it naturally into the email body.`,
        proposalContext: { leadId, campaignId },
        metadata: {
            campaignId,
            leadId,
            step: "break-up",
            engagementSignal,
        },
        temperature: 0.7,
    });

    const breakUp = proposal.payload;

    if (!isValidGeneratedFollowUp(breakUp)) {
        throw new Error(
            `[followup.agent] Invalid break-up LLM output for lead ${leadId}: ${JSON.stringify(breakUp)}`,
        );
    }

    return {
        subject: normalizeGeneratedText(
            breakUp.subject,
            MAX_SUBJECT_CHARS,
        ),
        subjectVariant: normalizeGeneratedText(
            breakUp.subjectVariant,
            MAX_SUBJECT_CHARS,
        ),
        body: normalizeGeneratedText(breakUp.body, MAX_BODY_CHARS),
        resourceAsset:
            typeof breakUp.resourceAsset === "string"
                ? breakUp.resourceAsset.trim().slice(0, 500)
                : undefined,
    };
}

function buildPoppingInBump(params: {
    originalSubject: string;
    leadFirstName: string;
    companyName: string;
    senderCompanyHint: string;
}): GeneratedFollowUp {
    const {
        originalSubject,
        leadFirstName,
        companyName,
        senderCompanyHint,
    } = params;

    const threadedSubject = originalSubject.startsWith("Re:")
        ? originalSubject
        : `Re: ${originalSubject}`;

    const body =
        `Hey ${leadFirstName}, wanted to quickly pop in and see if you've had a chance to read my email below.\n\n` +
        `I'd still love the opportunity to chat about how ${senderCompanyHint} can support ${companyName}. ` +
        `Do you have time over the next week or two to learn more? ` +
        `Let me know what works for you and I'll send a calendar invite along accordingly.`;

    return {
        subject: threadedSubject.slice(0, MAX_SUBJECT_CHARS),
        subjectVariant: threadedSubject.slice(0, MAX_SUBJECT_CHARS),
        body: body.slice(0, MAX_BODY_CHARS),
    };
}

export async function runFollowUpAgent(
    campaignId: string,
): Promise<void> {
    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        include: {
            senderDomain: { select: { domain: true } },
            senderMailbox: { select: { emailAddress: true } },
        },
    });

    if (!campaign) {
        throw new Error(`Campaign ${campaignId} not found`);
    }

    if (!ACTIVE_CAMPAIGN_STATUSES.includes(campaign.status)) {
        return;
    }

    const followUpDelayDays = Math.max(
        1,
        campaign.followUpDelayDays ?? 3,
    );
    const maxFollowUpSteps = Math.max(
        1,
        campaign.followUpMaxSteps ?? 2,
    );

    const senderDomain =
        campaign.senderDomain?.domain ??
        campaign.senderMailbox?.emailAddress?.split("@")[1];

    const senderCompanyHint = senderDomain
        ? senderDomain.split(".")[0]
        : "my company";

    const crossSystemGuardCutoff = new Date(
        Date.now() -
        CROSS_SYSTEM_SEND_COORDINATION_GUARD_HOURS *
        60 *
        60 *
        1000,
    );

    const leads = await prisma.lead.findMany({
        where: {
            campaignId,
            deletedAt: null,
            emailStatus: { notIn: BLOCKED_EMAIL_STATUSES },
            replies: {
                none: {
                    intent: { not: "OUT_OF_OFFICE" },
                },
            },
            outreachMessages: {
                none: {
                    isFollowUp: true,
                    deliveryState: {
                        in: ["DRAFT", "QUEUED", "SENDING"],
                    },
                },
            },
            stepStatuses: {
                none: {
                    step: { channel: "EMAIL" },
                    OR: [
                        {
                            status: {
                                in: ["SCHEDULED", "EXECUTING"],
                            },
                        },
                        {
                            status: "DONE",
                            executedAt: {
                                gte: crossSystemGuardCutoff,
                            },
                        },
                    ],
                },
            },
        },
        include: {
            outreachMessages: {
                where: {
                    deliveryState: {
                        in: ["SENT", "DELIVERED", "OPENED"],
                    },
                },
                orderBy: { sentAt: "asc" },
            },
            signals: {
                orderBy: { confidence: "desc" },
                take: 20,
            },
            replies: {
                where: { intent: "OUT_OF_OFFICE" },
                orderBy: { createdAt: "desc" },
                take: 1,
                select: {
                    id: true,
                    body: true,
                    oooReturnDate: true,
                },
            },
            _count: {
                select: {
                    outreachMessages: {
                        where: { isFollowUp: true },
                    },
                },
            },
        },
    });

    if (leads.length === 0) {
        logger.info(
            {
                campaignId,
                leadCount: 0,
            },
            "[followup.agent] No eligible leads",
        );
        return;
    }

    const rawWinPatterns = await getWinPatterns({
        targetIndustry: campaign.targetIndustry ?? undefined,
        targetRegion: campaign.targetRegion ?? undefined,
        limit: 4,
    }).catch(() => []);

    const winPatternHints =
        rawWinPatterns.length > 0
            ? "\n\nWIN PATTERNS from similar campaigns — use for signal and tone inspiration only:\n" +
            rawWinPatterns
                .map(
                    (p, i) =>
                        `Pattern ${i + 1}: signal "${p.signalType}" | subject: ${p.subjectPattern} | tone: ${p.tone ?? "N/A"}`,
                )
                .join("\n")
            : "";

    logger.info(
        {
            campaignId,
            leadCount: leads.length,
            winPatterns: rawWinPatterns.length,
            followUpDelayDays,
            maxFollowUpSteps,
        },
        "[followup.agent] Checking leads",
    );

    const limit = pLimit(5);
    const outcomes: LeadOutcome[] = [];

    for (let index = 0; index < leads.length; index += 5) {
        const batch = leads.slice(index, index + 5);

        const currentCampaign = await prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { status: true },
        });

        if (
            !currentCampaign ||
            !ACTIVE_CAMPAIGN_STATUSES.includes(
                currentCampaign.status,
            )
        ) {
            break;
        }

        const batchOutcomes = await Promise.all(
            batch.map((lead) =>
                limit(async (): Promise<LeadOutcome> => {
                    try {
                        const latestMessage =
                            lead.outreachMessages[lead.outreachMessages.length - 1];

                        if (
                            !latestMessage ||
                            !latestMessage.sentAt
                        ) {
                            return { status: "skipped" };
                        }

                        const pacing =
                            computeAdaptiveFollowUpPacing({
                                baseDelayDays:
                                    followUpDelayDays,
                                baseMaxSteps:
                                    maxFollowUpSteps,
                                qualificationScore:
                                    lead.qualificationScore,
                                pipelineStage:
                                    lead.pipelineStage,
                            });

                        const existingFollowUps =
                            lead._count.outreachMessages;

                        const step = existingFollowUps + 1;

                        if (step > pacing.maxSteps) {
                            return { status: "skipped" };
                        }

                        const effectiveDelayDays =
                            step === 1
                                ? computeStep1DelayDays(
                                    latestMessage.sentAt,
                                    pacing.delayDays,
                                )
                                : pacing.delayDays;

                        const effectiveCutoff = new Date(
                            Date.now() -
                            effectiveDelayDays *
                            24 *
                            60 *
                            60 *
                            1000,
                        );

                        if (
                            latestMessage.sentAt >
                            effectiveCutoff
                        ) {
                            return { status: "skipped" };
                        }

                        const oooReply =
                            lead.replies?.[0] ?? null;

                        let nextRetryAt: Date | null = null;

                        if (oooReply) {
                            if (oooReply.oooReturnDate) {
                                nextRetryAt =
                                    oooReply.oooReturnDate;
                            } else {
                                const resolved =
                                    oooReply.body
                                        ? await resolveOOOReturnDate(
                                            {
                                                body: oooReply.body,
                                                messageId:
                                                    oooReply.id,
                                            },
                                        )
                                        : null;

                                if (resolved === null) {
                                    logger.warn(
                                        {
                                            leadId:
                                                lead.id,
                                            messageId:
                                                oooReply.id,
                                        },
                                        "[followup.agent] OOO date parse returned null — defaulting to configured retry days",
                                    );
                                }

                                const fallbackRetry = new Date(
                                    Date.now() +
                                    OOO_FALLBACK_RETRY_DAYS *
                                    24 *
                                    60 *
                                    60 *
                                    1000,
                                );
                                nextRetryAt =
                                    (resolved && resolved > new Date())
                                        ? resolved
                                        : fallbackRetry;

                                await prisma.reply.update({
                                    where: {
                                        id: oooReply.id,
                                    },
                                    data: {
                                        oooReturnDate:
                                            nextRetryAt,
                                    },
                                });
                            }
                        }

                        if (
                            nextRetryAt &&
                            nextRetryAt > new Date()
                        ) {
                            return { status: "skipped" };
                        }

                        const engagementSignal: EngagementSignal =
                            latestMessage.openedAt !== null ||
                                latestMessage.deliveryState ===
                                "OPENED"
                                ? "OPENED"
                                : "NOT_OPENED";

                        const freshSignals =
                            lead.signals
                                .filter(
                                    (signal) =>
                                        signal.createdAt >
                                        latestMessage.sentAt!,
                                )
                                .slice(0, 3);

                        const freshSignalsBlock =
                            freshSignals.length > 0
                                ? "\n\nFRESH SIGNALS — appeared since the original email was sent. Consider leading with one if it's a stronger hook than the original:\n" +
                                freshSignals
                                    .map(
                                        (signal) =>
                                            `• ${signal.signalType}: ${signal.value} (confidence: ${signal.confidence.toFixed(2)})`,
                                    )
                                    .join("\n")
                                : "";

                        let followUp: GeneratedFollowUp;

                        if (
                            step === 1 &&
                            step < pacing.maxSteps
                        ) {
                            followUp =
                                buildPoppingInBump({
                                    originalSubject:
                                        latestMessage.subject,
                                    leadFirstName:
                                        lead.firstName ??
                                        "there",
                                    companyName:
                                        lead.companyName,
                                    senderCompanyHint,
                                });
                        } else {
                            const [
                                journeyEvents,
                                journeySummary,
                            ] = await Promise.all([
                                getRecentLeadJourney(
                                    lead.id,
                                    20,
                                ),
                                summarizeLeadJourney(
                                    lead.id,
                                    20,
                                ),
                            ]);

                            const openCount =
                                journeyEvents.filter(
                                    (event) =>
                                        event.eventType ===
                                        "EMAIL_OPENED",
                                ).length;

                            const clickCount =
                                latestMessage.clicks ?? 0;

                            const sequenceHistoryBlock = lead.outreachMessages.length > 0
                                ? "\nPRIOR MESSAGES IN THIS SEQUENCE (maintain tone & argument consistency, do not repeat prior phrasing):\n" +
                                  lead.outreachMessages.map((m, i) => `Touchpoint ${i + 1} (${m.isFollowUp ? `Step ${i + 1}` : "Step 1 Initial"})\nSubject: ${m.subject}\nBody: ${m.body}`).join("\n\n")
                                : "";

                            const situationBlock = [
                                `Engagement on most recent email: ${engagementSignal ===
                                    "OPENED"
                                    ? `opened${openCount > 1
                                        ? ` (${openCount} opens recorded across this lead's history)`
                                        : ""
                                    }`
                                    : "not opened"
                                }${clickCount > 0
                                    ? `, clicked a link in it ${clickCount} time(s)`
                                    : ""
                                }.`,
                                `Fresh signals since last touch: ${summarizeFreshSignalsByType(
                                    freshSignals,
                                )}.`,
                                `Lead qualification: ${qualificationTierLabel(
                                    lead.qualificationScore,
                                )} (pipeline stage: ${lead.pipelineStage}).`,
                                `Journey so far: ${journeySummary}`,
                                sequenceHistoryBlock,
                            ].join("\n");

                            if (
                                step >=
                                pacing.maxSteps
                            ) {
                                followUp =
                                    await generateBreakUpEmail(
                                        {
                                            maxFollowUpSteps:
                                                pacing.maxSteps,
                                            engagementSignal,
                                            situationBlock,
                                            originalSubject:
                                                latestMessage.subject,
                                            originalBody:
                                                latestMessage.body,
                                            leadFirstName:
                                                lead.firstName ??
                                                "there",
                                            companyName:
                                                lead.companyName,
                                            title:
                                                lead.title ??
                                                "professional",
                                            icpDescription:
                                                campaign.icpDescription,
                                            senderDomain,
                                            winPatternHints,
                                            freshSignalsBlock,
                                            campaignId,
                                            leadId:
                                                lead.id,
                                        },
                                    );
                            } else {
                                followUp =
                                    await generateFollowUp({
                                        step,
                                        maxFollowUpSteps:
                                            pacing.maxSteps,
                                        engagementSignal,
                                        situationBlock,
                                        originalSubject:
                                            latestMessage.subject,
                                        originalBody:
                                            latestMessage.body,
                                        leadFirstName:
                                            lead.firstName ??
                                            "there",
                                        companyName:
                                            lead.companyName,
                                        title:
                                            lead.title ??
                                            "professional",
                                        icpDescription:
                                            campaign.icpDescription,
                                        senderDomain,
                                        winPatternHints,
                                        freshSignalsBlock,
                                        campaignId,
                                        leadId: lead.id,
                                    });
                            }
                        }

                        try {
                            await prisma.outreachMessage.create(
                                {
                                    data: {
                                        leadId: lead.id,
                                        subject:
                                            followUp.subject,
                                        subjectVariant:
                                            followUp.subjectVariant,
                                        body: followUp.body,
                                        approvalStatus:
                                            "PENDING",
                                        deliveryState:
                                            "DRAFT",
                                        isFollowUp: true,
                                        followUpStep:
                                            step,
                                        parentMessageId:
                                            latestMessage.id,
                                        ...(nextRetryAt
                                            ? {
                                                nextRetryAt,
                                            }
                                            : {}),
                                        diffVector: {
                                            engagementSignal,
                                            freshSignalCount:
                                                freshSignals.length,
                                            clickCount:
                                                latestMessage.clicks ??
                                                0,
                                            qualificationTier:
                                                qualificationTierLabel(
                                                    lead.qualificationScore,
                                                ),
                                            followUpStrategy:
                                                step === 1 &&
                                                    step <
                                                    pacing.maxSteps
                                                    ? "smykm-popping-in: threaded subject, short bump body"
                                                    : step >=
                                                        pacing.maxSteps
                                                        ? "break-up: resource asset offer, final reach-out"
                                                        : followUp.strategy ??
                                                        (engagementSignal ===
                                                            "OPENED"
                                                            ? "body-variant: subject worked, new angle in body"
                                                            : "subject-variant: new subject line, lighter body"),
                                            ...(followUp.reason
                                                ? {
                                                    strategyReason:
                                                        followUp.reason,
                                                }
                                                : {}),
                                            ...(step >=
                                                pacing.maxSteps &&
                                                followUp.resourceAsset
                                                ? {
                                                    resourceAsset:
                                                        followUp.resourceAsset,
                                                }
                                                : {}),
                                        },
                                    },
                                },
                            );
                        } catch (error) {
                            if (
                                error instanceof
                                Prisma.PrismaClientKnownRequestError &&
                                error.code === "P2002"
                            ) {
                                return {
                                    status: "skipped",
                                };
                            }

                            throw error;
                        }

                        logger.info(
                            {
                                campaignId,
                                leadId: lead.id,
                                step,
                                engagementSignal,
                                nextRetryAt,
                                strategy:
                                    step === 1 &&
                                        step < pacing.maxSteps
                                        ? "popping-in"
                                        : step >=
                                            pacing.maxSteps
                                            ? "break-up"
                                            : followUp.strategy ??
                                            "llm-generated",
                            },
                            "[followup.agent] Follow-up created, pending review",
                        );

                        return { status: "generated" };
                    } catch (error) {
                        logger.error(
                            {
                                err: error,
                                leadId: lead.id,
                            },
                            "[followup.agent] Failed for lead",
                        );

                        return {
                            status: "errored",
                            reason: error,
                        };
                    }
                }),
            ),
        );

        outcomes.push(...batchOutcomes);
    }

    const generated = outcomes.filter(
        (outcome) => outcome.status === "generated",
    ).length;

    const skipped = outcomes.filter(
        (outcome) => outcome.status === "skipped",
    ).length;

    const errored = outcomes.filter(
        (outcome) => outcome.status === "errored",
    ).length;

    logger.info(
        {
            campaignId,
            generated,
            skipped,
            errored,
        },
        "[followup.agent] Generation done, running review",
    );

    if (leads.length >= 10) {
        const generatedLeadIds = new Set(
            leads
                .slice(0, outcomes.length)
                .filter(
                    (_, index) =>
                        outcomes[index]?.status ===
                        "generated",
                )
                .map((lead) => lead.id),
        );

        const atMaxLeadIds = leads
            .filter((lead) => {
                const pacing =
                    computeAdaptiveFollowUpPacing({
                        baseDelayDays:
                            followUpDelayDays,
                        baseMaxSteps:
                            maxFollowUpSteps,
                        qualificationScore:
                            lead.qualificationScore,
                        pipelineStage:
                            lead.pipelineStage,
                    });

                const countAfterRun =
                    lead._count.outreachMessages +
                    (generatedLeadIds.has(lead.id)
                        ? 1
                        : 0);

                return (
                    countAfterRun >= pacing.maxSteps
                );
            })
            .map((lead) => lead.id);

        if (atMaxLeadIds.length > 0) {
            const openedLeadIds = new Set(
                (
                    await prisma.outreachMessage.findMany({
                        where: {
                            leadId: {
                                in: atMaxLeadIds,
                            },
                            OR: [
                                {
                                    openedAt: {
                                        not: null,
                                    },
                                },
                                {
                                    deliveryState:
                                        "OPENED",
                                },
                            ],
                        },
                        select: {
                            leadId: true,
                        },
                        distinct: ["leadId"],
                    })
                ).map((message) => message.leadId),
            );

            const exhaustedCount =
                atMaxLeadIds.filter(
                    (id) => !openedLeadIds.has(id),
                ).length;

            const exhaustionPopulation =
                atMaxLeadIds.length;

            const exhaustionRate =
                exhaustionPopulation > 0
                    ? exhaustedCount /
                    exhaustionPopulation
                    : 0;

            if (
                exhaustionRate >=
                EXHAUSTION_RATE_THRESHOLD
            ) {
                await prisma.deliverabilityEvent.create(
                    {
                        data: {
                            type: "SUBJECT_LINE_EXHAUSTION",
                            severity: "WARNING",
                            metadata: {
                                campaignId,
                                exhaustionRate:
                                    parseFloat(
                                        exhaustionRate.toFixed(
                                            2,
                                        ),
                                    ),
                                exhaustedCount,
                                totalLeads:
                                    exhaustionPopulation,
                            },
                        },
                    },
                );

                logger.warn(
                    {
                        campaignId,
                        exhaustionRate,
                        exhaustedCount,
                        exhaustionPopulation,
                    },
                    "[followup.agent] Subject line exhaustion threshold hit — flagged for review",
                );
            }
        }
    }

    if (generated > 0) {
        await runReviewAgent(campaignId, {
            followUpPass: true,
        });
    }
}