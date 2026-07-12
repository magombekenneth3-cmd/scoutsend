import { Prisma, EmailStatus } from "@prisma/client";
import pLimit from "p-limit";
import { prisma } from "../../lib/prisma";
import { callGemini, extractJSON, MODELS } from "./gemini.client";
import { getWinPatterns } from "../memory/memory.service";
import { runReviewAgent } from "./review.agent";
import { logger } from "../../lib/logger";
import { resolveOOOReturnDate } from "./reply.agent";

interface GeneratedFollowUp {
    subject: string;
    subjectVariant: string;
    body: string;
}

type EngagementSignal = "OPENED" | "NOT_OPENED";

const EXHAUSTION_RATE_THRESHOLD = 0.6;
const OOO_FALLBACK_RETRY_DAYS = 7;
const MAX_ORIGINAL_BODY_CHARS = 4000;

/**
 * SMYKM weekend-sensitive delay.
 * If the original email was sent on Thursday (4) or Friday (5), we target a
 * Saturday-or-Sunday bump so the prospect sees it over the weekend when inbox
 * volume is lower. Otherwise we honour the configured followUpDelayDays.
 */
function computeStep1DelayDays(sentAt: Date, configuredDelayDays: number): number {
    const dayOfWeek = sentAt.getUTCDay(); // 0=Sun … 6=Sat
    if (dayOfWeek === 4 || dayOfWeek === 5) {
        // Thursday → Saturday (2 days), Friday → Saturday (1 day)
        return dayOfWeek === 4 ? 2 : 1;
    }
    // For all other days honour configured delay but cap at 2 for step 1 per SMYKM
    return Math.min(configuredDelayDays, 2);
}

function truncateForPrompt(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    return `${text.slice(0, maxChars)}...`;
}

function isValidGeneratedFollowUp(value: unknown): value is GeneratedFollowUp {
    if (!value || typeof value !== "object") return false;
    const v = value as Record<string, unknown>;
    return (
        typeof v.subject === "string" && v.subject.trim().length > 0 &&
        typeof v.subjectVariant === "string" && v.subjectVariant.trim().length > 0 &&
        typeof v.body === "string" && v.body.trim().length > 0
    );
}

async function generateFollowUp(params: {
    step: number;
    maxFollowUpSteps: number;
    engagementSignal: EngagementSignal;
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
        step === 1
            ? "a brief first follow-up (3–4 sentences). Reference the original email naturally. One soft CTA."
            : step >= maxFollowUpSteps
                ? "a short final bump (2–3 sentences). Acknowledge this is your last reach-out. Make it easy to say no."
                : "a brief follow-up (3–4 sentences) taking a new angle from the earlier attempts without repeating prior phrasing. One soft CTA. Close with the polite timing CTA: \"Do you have time over the next week or two to learn more? Let me know what works for you and I'll send a calendar invite along accordingly.\"";

    const engagementInstruction = {
        OPENED: `The original email WAS OPENED but received no reply. This means the subject line worked — keep the subject similar or lightly rework it. The body did not convert. Change the angle: use a different signal, reframe the value proposition, or lead with a question instead of a statement. Do not repeat the same opening. For "subjectVariant", produce a light variation of the primary subject — both are refinements of a line that already earned an open. Never include a calendar scheduling link. Close with the polite timing formula: "Do you have time over the next week or two to learn more? Let me know what works for you and I'll send a calendar invite along accordingly."`,
        NOT_OPENED: `No open was recorded for the original email — this may mean the subject line did not land, or that open tracking was blocked by the recipient's mail client. Prioritise a new subject line — try a different structure (question, specific signal name-drop, or pattern interrupt). Keep the body shorter and lighter than the original; the goal is to earn the open first. Produce two distinct subject candidates in "subject" and "subjectVariant" so the sender can A/B test which angle breaks through. Never include a calendar scheduling link. Close with the polite timing formula: "Do you have time over the next week or two to learn more? Let me know what works for you and I'll send a calendar invite along accordingly."`,
    }[engagementSignal];

    const { text } = await callGemini({
        agentName: `followup.writer.step${step}.${engagementSignal.toLowerCase()}`,
        model: MODELS.GENERATE,
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
- If fresh signals are provided, evaluate whether one is stronger than the original hook — if so, lead with it instead

ENGAGEMENT CONTEXT:
${engagementInstruction}

Return ONLY JSON:
{
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

Original subject:
${originalSubject}

Original body:
${truncateForPrompt(originalBody, MAX_ORIGINAL_BODY_CHARS)}${freshSignalsBlock}${winPatternHints}`,
        metadata: { campaignId, leadId, step, engagementSignal },
        temperature: 0.7,
    });

    const parsed = extractJSON<unknown>(text);
    if (!isValidGeneratedFollowUp(parsed)) {
        throw new Error(
            `[followup.agent] Invalid LLM output for lead ${leadId} step ${step}: ${JSON.stringify(parsed)}`
        );
    }
    return parsed;
}

async function generateBreakUpEmail(params: {
    maxFollowUpSteps: number;
    engagementSignal: EngagementSignal;
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

    const { text } = await callGemini({
        agentName: `followup.break-up.${engagementSignal.toLowerCase()}`,
        model: MODELS.GENERATE,
        systemPrompt: `You are an expert B2B cold email copywriter writing a final break-up email.

This is the LAST email in the sequence. Your goal is to leave a positive, memorable impression and offer one concrete piece of value before stepping away.

Rules:
- Do NOT start with "I" or "Just following up"
- Never use "checking in", "circling back", or "touching base"
- Never use exclamation marks
- Never open with pleasantries like "I hope this email finds you well"
- 3–4 sentences maximum — shorter is better
- Acknowledge this is your last reach-out, but frame it positively (e.g., "I don't want to keep flooding your inbox")
- Offer ONE high-value resource asset relevant to their role and industry — choose the most compelling from:
    • A relevant case study or customer story
    • An industry benchmark report or data insight
    • An ROI calculator or framework specific to their function
    • A short checklist or playbook for a problem they likely face
- Make the resource feel like a genuine gift, not a bait-and-switch
- Do NOT include a calendar scheduling link
- End with: "If timing ever changes, I'm here. Wishing you a great quarter."
- Tone: warm, peer-to-peer, no desperation

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

Original subject:
${originalSubject}

Original body:
${truncateForPrompt(originalBody, MAX_ORIGINAL_BODY_CHARS)}${freshSignalsBlock}${winPatternHints}

Choose the most relevant resource asset for this person's role and company context. Describe it in 1 sentence in the "resourceAsset" field (e.g., "SaaS churn reduction playbook with 3 case studies from mid-market companies"). Weave it naturally into the email body.`,
        metadata: { campaignId, leadId, step: "break-up", engagementSignal },
        temperature: 0.7,
    });

    const parsed = extractJSON<unknown>(text);
    if (!isValidGeneratedFollowUp(parsed)) {
        throw new Error(
            `[followup.agent] Invalid break-up LLM output for lead ${leadId}: ${JSON.stringify(parsed)}`
        );
    }
    return parsed;
}

/**
 * SMYKM Step 1 ("popping-in") bump.
 * Returns a threaded follow-up that preserves the exact original subject (prefixed
 * with "Re:") and sends a short, warm nudge — no new pitch, no calendar link.
 */
function buildPoppingInBump(params: {
    originalSubject: string;
    leadFirstName: string;
    companyName: string;
    senderCompanyHint: string;
}): GeneratedFollowUp {
    const { originalSubject, leadFirstName, companyName, senderCompanyHint } = params;
    const threadedSubject = originalSubject.startsWith("Re:")
        ? originalSubject
        : `Re: ${originalSubject}`;

    const body =
        `Hey ${leadFirstName}, wanted to quickly pop in and see if you've had a chance to read my email below.\n\n` +
        `I'd still love the opportunity to chat about how ${senderCompanyHint} can support ${companyName}. ` +
        `Do you have time over the next week or two to learn more? ` +
        `Let me know what works for you and I'll send a calendar invite along accordingly.`;

    return {
        subject: threadedSubject,
        subjectVariant: threadedSubject,
        body,
    };
}

type LeadOutcome = { status: "generated" } | { status: "skipped" } | { status: "errored"; reason: unknown };

export async function runFollowUpAgent(campaignId: string): Promise<void> {
    const ACTIVE_CAMPAIGN_STATUSES = ["QUEUED", "SENDING"];

    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        include: {
            senderDomain: { select: { domain: true } },
            senderMailbox: { select: { emailAddress: true } },
        },
    });

    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    if (!ACTIVE_CAMPAIGN_STATUSES.includes(campaign.status)) return;

    const followUpDelayDays = campaign.followUpDelayDays ?? 3;
    const maxFollowUpSteps = campaign.followUpMaxSteps ?? 2;
    const cutoff = new Date(Date.now() - followUpDelayDays * 24 * 60 * 60 * 1000);

    const senderDomain =
        campaign.senderDomain?.domain ??
        campaign.senderMailbox?.emailAddress?.split("@")[1];
    const senderCompanyHint = senderDomain ? senderDomain.split(".")[0] : "my company";

    const BLOCKED_EMAIL_STATUSES = [
        EmailStatus.INVALID,
        EmailStatus.BOUNCED,
        EmailStatus.SUPPRESSED,
    ];

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
                    deliveryState: { in: ["DRAFT", "QUEUED", "SENDING"] },
                },
            },
        },
        include: {
            outreachMessages: {
                where: {
                    deliveryState: { in: ["SENT", "DELIVERED", "OPENED"] },
                },
                orderBy: { sentAt: "desc" },
                take: 1,
            },
            signals: {
                orderBy: { confidence: "desc" },
                take: 20,
            },
            replies: {
                where: { intent: "OUT_OF_OFFICE" },
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { id: true, body: true, oooReturnDate: true },
            },
            _count: {
                select: { outreachMessages: { where: { isFollowUp: true } } },
            },
        },
    });

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
                        `Pattern ${i + 1}: signal "${p.signalType}" | subject: ${p.subjectPattern} | tone: ${p.tone ?? "N/A"}`
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
        "[followup.agent] Checking leads"
    );

    const limit = pLimit(5);

    const outcomes = await Promise.all(
        leads.map((lead) =>
            limit(async (): Promise<LeadOutcome> => {
                try {
                    const latestMessage = lead.outreachMessages[0];

                    if (!latestMessage || !latestMessage.sentAt) {
                        return { status: "skipped" };
                    }

                    if (latestMessage.sentAt > cutoff) {
                        return { status: "skipped" };
                    }

                    const existingFollowUps = lead._count.outreachMessages;

                    if (existingFollowUps >= maxFollowUpSteps) {
                        return { status: "skipped" };
                    }

                    const latestLeadState = await prisma.lead.findUnique({
                        where: { id: lead.id },
                        select: {
                            replies: {
                                select: { id: true, intent: true },
                            },
                        },
                    });

                    const nonOOOReplies = (latestLeadState?.replies ?? []).filter(
                        (r) => r.intent !== "OUT_OF_OFFICE"
                    );

                    if (nonOOOReplies.length > 0) {
                        return { status: "skipped" };
                    }

                    const oooReply = lead.replies?.[0] ?? null;
                    let nextRetryAt: Date | null = null;

                    if (oooReply) {
                        if (oooReply.oooReturnDate) {
                            nextRetryAt = oooReply.oooReturnDate;
                        } else {
                            const resolved = oooReply.body
                                ? await resolveOOOReturnDate({
                                    body: oooReply.body,
                                    messageId: oooReply.id,
                                })
                                : null;

                            if (resolved === null) {
                                logger.warn(
                                    { leadId: lead.id, messageId: oooReply.id },
                                    "[followup.agent] OOO date parse returned null — defaulting to configured retry days"
                                );
                            }

                            nextRetryAt =
                                resolved ??
                                new Date(Date.now() + OOO_FALLBACK_RETRY_DAYS * 24 * 60 * 60 * 1000);

                            await prisma.reply.update({
                                where: { id: oooReply.id },
                                data: { oooReturnDate: nextRetryAt },
                            });
                        }
                    }

                    if (nextRetryAt && nextRetryAt > new Date()) {
                        return { status: "skipped" };
                    }

                    const currentCampaign = await prisma.campaign.findUnique({
                        where: { id: campaignId },
                        select: { status: true },
                    });

                    if (!currentCampaign || !ACTIVE_CAMPAIGN_STATUSES.includes(currentCampaign.status)) {
                        return { status: "skipped" };
                    }

                    const engagementSignal: EngagementSignal =
                        latestMessage.openedAt !== null || latestMessage.deliveryState === "OPENED"
                            ? "OPENED"
                            : "NOT_OPENED";

                    const freshSignals = lead.signals
                        .filter((s) => s.createdAt > latestMessage.sentAt!)
                        .slice(0, 3);

                    const freshSignalsBlock =
                        freshSignals.length > 0
                            ? "\n\nFRESH SIGNALS — appeared since the original email was sent. Consider leading with one if it's a stronger hook than the original:\n" +
                            freshSignals
                                .map(
                                    (s) =>
                                        `• ${s.signalType}: ${s.value} (confidence: ${s.confidence.toFixed(2)})`
                                )
                                .join("\n")
                            : "";

                    const step = existingFollowUps + 1;

                    // SMYKM rule: Step 1 is always the short "popping-in" bump.
                    // Use LLM only for step 2+ where a fresh angle is genuinely needed.
                    let followUp: GeneratedFollowUp;
                    if (step === 1) {
                        const step1Delay = computeStep1DelayDays(latestMessage.sentAt, followUpDelayDays);
                        const step1Cutoff = new Date(Date.now() - step1Delay * 24 * 60 * 60 * 1000);
                        if (latestMessage.sentAt > step1Cutoff) {
                            return { status: "skipped" };
                        }
                        followUp = buildPoppingInBump({
                            originalSubject: latestMessage.subject,
                            leadFirstName: lead.firstName ?? "there",
                            companyName: lead.companyName,
                            senderCompanyHint,
                        });
                    } else if (step >= maxFollowUpSteps) {
                        followUp = await generateBreakUpEmail({
                            maxFollowUpSteps,
                            engagementSignal,
                            originalSubject: latestMessage.subject,
                            originalBody: latestMessage.body,
                            leadFirstName: lead.firstName ?? "there",
                            companyName: lead.companyName,
                            title: lead.title ?? "professional",
                            icpDescription: campaign.icpDescription,
                            senderDomain,
                            winPatternHints,
                            freshSignalsBlock,
                            campaignId,
                            leadId: lead.id,
                        });
                    } else {
                        followUp = await generateFollowUp({
                            step,
                            maxFollowUpSteps,
                            engagementSignal,
                            originalSubject: latestMessage.subject,
                            originalBody: latestMessage.body,
                            leadFirstName: lead.firstName ?? "there",
                            companyName: lead.companyName,
                            title: lead.title ?? "professional",
                            icpDescription: campaign.icpDescription,
                            senderDomain,
                            winPatternHints,
                            freshSignalsBlock,
                            campaignId,
                            leadId: lead.id,
                        });
                    }

                    try {
                        await prisma.outreachMessage.create({
                            data: {
                                leadId: lead.id,
                                subject: followUp.subject,
                                subjectVariant: followUp.subjectVariant,
                                body: followUp.body,
                                approvalStatus: "PENDING",
                                deliveryState: "DRAFT",
                                isFollowUp: true,
                                followUpStep: step,
                                ...(nextRetryAt ? { nextRetryAt } : {}),
                                diffVector: {
                                    engagementSignal,
                                    freshSignalCount: freshSignals.length,
                                    followUpStrategy:
                                        step === 1
                                            ? "smykm-popping-in: threaded subject, short bump body"
                                            : step >= maxFollowUpSteps
                                                ? "break-up: resource asset offer, final reach-out"
                                                : engagementSignal === "OPENED"
                                                    ? "body-variant: subject worked, new angle in body"
                                                    : "subject-variant: new subject line, lighter body",
                                    ...(step >= maxFollowUpSteps && (followUp as GeneratedFollowUp & { resourceAsset?: string }).resourceAsset
                                        ? { resourceAsset: (followUp as GeneratedFollowUp & { resourceAsset?: string }).resourceAsset }
                                        : {}),
                                },
                            },
                        });
                    } catch (error) {
                        if (
                            error instanceof Prisma.PrismaClientKnownRequestError &&
                            error.code === "P2002"
                        ) {
                            return { status: "skipped" };
                        }
                        throw error;
                    }

                    logger.info(
                    { campaignId, leadId: lead.id, step, engagementSignal, nextRetryAt, strategy: step === 1 ? "popping-in" : step >= maxFollowUpSteps ? "break-up" : "llm-generated" },
                        "[followup.agent] Follow-up created, pending review"
                    );

                    return { status: "generated" };
                } catch (error) {
                    logger.error(
                        { err: error, leadId: lead.id },
                        "[followup.agent] Failed for lead"
                    );
                    return { status: "errored", reason: error };
                }
            })
        )
    );

    const generated = outcomes.filter((o) => o.status === "generated").length;
    const skipped = outcomes.filter((o) => o.status === "skipped").length;
    const errored = outcomes.filter((o) => o.status === "errored").length;

    logger.info(
        { campaignId, generated, skipped, errored },
        "[followup.agent] Generation done, running review"
    );

    if (leads.length >= 10) {
        const generatedLeadIds = new Set(
            leads
                .filter((_, i) => outcomes[i].status === "generated")
                .map((l) => l.id)
        );

        const atMaxLeadIds = leads
            .filter((lead) => {
                const countAfterRun =
                    lead._count.outreachMessages + (generatedLeadIds.has(lead.id) ? 1 : 0);
                return countAfterRun >= maxFollowUpSteps;
            })
            .map((lead) => lead.id);

        if (atMaxLeadIds.length > 0) {
            const openedLeadIds = new Set(
                (
                    await prisma.outreachMessage.findMany({
                        where: {
                            leadId: { in: atMaxLeadIds },
                            OR: [{ openedAt: { not: null } }, { deliveryState: "OPENED" }],
                        },
                        select: { leadId: true },
                        distinct: ["leadId"],
                    })
                ).map((m) => m.leadId)
            );

            const exhaustedCount = atMaxLeadIds.filter((id) => !openedLeadIds.has(id)).length;
            const exhaustionRate = exhaustedCount / leads.length;

            if (exhaustionRate >= EXHAUSTION_RATE_THRESHOLD) {
                await prisma.deliverabilityEvent.create({
                    data: {
                        type: "SUBJECT_LINE_EXHAUSTION",
                        severity: "WARNING",
                        metadata: {
                            campaignId,
                            exhaustionRate: parseFloat(exhaustionRate.toFixed(2)),
                            exhaustedCount,
                            totalLeads: leads.length,
                        },
                    },
                });

                logger.warn(
                    { campaignId, exhaustionRate, exhaustedCount },
                    "[followup.agent] Subject line exhaustion threshold hit — flagged for review"
                );
            }
        }
    }

    if (generated > 0) {
        await runReviewAgent(campaignId, { followUpPass: true });
    }
}