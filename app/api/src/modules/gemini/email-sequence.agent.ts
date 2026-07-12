import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { callGeminiWithTools, MODELS, SchemaType, ToolDefinition } from "./gemini.client";
import { auditMessage } from "./compliance.agent";

const MAX_BATCH = 30;
const PERSONALIZATION_CONCURRENCY = 5;
const MIN_BODY_WORDS = 20;
const MAX_BODY_WORDS = 800;
const MAX_SUBJECT_LENGTH = 100;
const SPAM_RISK_MAX = 0.3;
const PERSONALIZATION_MIN = 0.7;

const MERGE_TAG_RE = /\{(firstName|lastName|companyName|title)\}/g;
const UNSUBSCRIBE_RE = /unsubscribe|opt[\s-]?out|remove\s+(?:me|yourself)\s+from/i;
const PLACEHOLDER_RE =
    /\[\s*(?:first[\s_]?name|last[\s_]?name|full[\s_]?name|your\s+name|company(?:\s+name)?|website|email|title|name)\s*\]|\{\{\s*(?:first[\s_]?name|last[\s_]?name|company(?:_name)?|name|title)\s*\}\}|\{\s*(?:first[\s_]?name|last[\s_]?name|company(?:_name)?|name|title)\s*\}|\{\{[^{}]+\}\}|%[A-Z_]+%|\[\[[^\]]+\]\]/gi;

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function wordCount(text: string): number {
    const trimmed = text.trim();
    return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

function applyMergeTags(
    template: string,
    lead: {
        firstName: string | null;
        lastName: string | null;
        title: string | null;
        companyName: string;
    },
): { result: string; unresolvedTags: string[] } {
    const result = template
        .replace(/\{firstName\}/g, lead.firstName ?? "there")
        .replace(/\{lastName\}/g, lead.lastName ?? "")
        .replace(/\{companyName\}/g, lead.companyName)
        .replace(/\{title\}/g, lead.title ?? "professional")
        .trim();

    MERGE_TAG_RE.lastIndex = 0;
    const unresolvedTags = Array.from(new Set((result.match(MERGE_TAG_RE) ?? [])));

    return { result, unresolvedTags };
}

interface PersonalizedEmail {
    subject: string;
    body: string;
    spamRiskScore: number;
    personalizationScore: number;
}

interface ComplianceCheckResult {
    passed: boolean;
    violations: string[];
}

function runComplianceGate(
    email: PersonalizedEmail,
    unsubscribeFooter: string,
    leadCountry: string | null,
    consentBasis?: string | null,
): ComplianceCheckResult {
    const violations: string[] = [];

    PLACEHOLDER_RE.lastIndex = 0;
    if (PLACEHOLDER_RE.test(`${email.subject} ${email.body}`)) {
        violations.push("unfilled_placeholder");
    }

    MERGE_TAG_RE.lastIndex = 0;
    if (MERGE_TAG_RE.test(`${email.subject} ${email.body}`)) {
        violations.push("unresolved_merge_tag");
    }

    if (email.subject.length === 0) {
        violations.push("empty_subject");
    } else if (email.subject.length > MAX_SUBJECT_LENGTH) {
        violations.push(`subject_too_long:${email.subject.length}`);
    }

    const words = wordCount(email.body);
    if (words < MIN_BODY_WORDS) {
        violations.push(`body_too_short:${words}`);
    } else if (words > MAX_BODY_WORDS) {
        violations.push(`body_too_long:${words}`);
    }

    if (email.spamRiskScore >= SPAM_RISK_MAX) {
        violations.push(`high_spam_risk:${email.spamRiskScore.toFixed(2)}`);
    }

    if (email.personalizationScore < PERSONALIZATION_MIN) {
        violations.push(`low_personalization:${email.personalizationScore.toFixed(2)}`);
    }

    const sharedViolations = auditMessage(email.subject, email.body, leadCountry, consentBasis, unsubscribeFooter);
    for (const v of sharedViolations) {
        const code = v.detail !== undefined ? `${v.code}:${v.detail}` : v.code;
        if (!violations.includes(code)) {
            violations.push(code);
        }
    }

    return { passed: violations.length === 0, violations };
}


const PERSONALIZE_TOOL: ToolDefinition = {
    declaration: {
        name: "returnResult",
        description: "Return the personalized email with quality scores.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                subject: {
                    type: SchemaType.STRING,
                    description: "Refined subject line — max 9 words, no clickbait. If two or more strong personal hooks exist (location, alma mater, mutual connection, personal interest), use a plus-delimited sequence of tokens e.g. 'Geneva + Dogs + L\'Auberge + [Sender Company]'. Otherwise refine the template subject.",
                },
                body: {
                    type: SchemaType.STRING,
                    description:
                        "Personalized email body — 4–6 sentences, plain text, no bullet points. Must end with the unsubscribe footer exactly as provided.",
                },
                spamRiskScore: {
                    type: SchemaType.NUMBER,
                    description:
                        "Your honest spam risk assessment 0.0–1.0 (lower is better). Penalize generic openers, excessive urgency, calendar links, or pushy CTAs.",
                },
                personalizationScore: {
                    type: SchemaType.NUMBER,
                    description:
                        "Your honest personalization depth 0.0–1.0 (higher is better). Score higher when the email references specific company signals, role context, or industry triggers.",
                },
            },
            required: ["subject", "body", "spamRiskScore", "personalizationScore"],
        },
    },
    handler: async (args) => args,
};

function parsePersonalizedEmail(raw: unknown): PersonalizedEmail | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;

    if (!isNonEmptyString(obj.subject)) return null;
    if (!isNonEmptyString(obj.body)) return null;
    if (!isFiniteNumber(obj.spamRiskScore)) return null;
    if (!isFiniteNumber(obj.personalizationScore)) return null;

    return {
        subject: obj.subject.trim(),
        body: obj.body.trim(),
        spamRiskScore: Math.min(1, Math.max(0, obj.spamRiskScore)),
        personalizationScore: Math.min(1, Math.max(0, obj.personalizationScore)),
    };
}

async function personalizeEmail(params: {
    baseSubject: string;
    baseBody: string;
    lead: {
        id: string;
        firstName: string | null;
        lastName: string | null;
        title: string | null;
        companyName: string;
        website: string | null;
        email: string | null;
    };
    signals: Array<{ signalType: string; value: string; explanation: string | null }>;
    icpDescription: string;
    campaignName: string;
    unsubscribeFooter: string;
}): Promise<PersonalizedEmail> {
    const { baseSubject, baseBody, lead, signals, icpDescription, campaignName, unsubscribeFooter } =
        params;

    const signalBlock =
        signals.length > 0
            ? signals
                .map((s) => `• ${s.signalType}: ${s.value}${s.explanation ? ` (${s.explanation})` : ""}`)
                .join("\n")
            : "No enriched signals available — personalise from the company name and role context only.";

    const { result } = await callGeminiWithTools<unknown>({
        agentName: "email-sequence.personalizer",
        model: MODELS.GENERATE,
        systemPrompt: `You are an expert B2B cold email personalizer. You receive a templated sequence email and recipient context, and rewrite it to feel natural and individually crafted.

SIGNAL HIERARCHY — always prioritise in this order:
1. HUMAN signals (personal interests, alma mater, mutual connections, location, pets, personal achievements) — rarest and most powerful, lead with one if available.
2. COMPANY signals (press releases, charity, funding, leadership changes, executive podcasts/articles, values) — use when no Human signal is present.
3. SPACE/VERTICAL signals (hiring patterns, tech stack, industry-specific challenges) — use as supporting context or fallback.

FIRST SENTENCE — use exactly one of these two patterns:
Option A (Polite Peer Intro): "Hi [Lead FirstName], we have yet to be properly introduced — I'm [infer sender name from domain] and..." — signals peer context.
Option B (Direct SMYKM Hook): Launch immediately into the strongest personal or company observation: "Hi [Lead FirstName], [specific observation]..."

VALUE PROPOSITION — pitch the challenge solved, not features. Preempt the most obvious objection inline in one sentence.

CTA RULES (mandatory):
- Never include a calendar scheduling link (Calendly, Cal.com, HubSpot meetings, etc.).
- Never request specific timelines like "15 minutes tomorrow" or "Monday at 1 PM".
- Close with this polite formula (verbatim or near-verbatim): "Do you have time over the next week or two to learn more? Let me know what works for you and I'll send a calendar invite along accordingly."

ADDITIONAL RULES:
- Keep the core value proposition from the template unchanged
- Subject line: 6–9 words, no clickbait, no ALL CAPS (or use plus-delimited personal hooks if available)
- Body: 4–6 sentences, plain text, no bullet points
- Never use exclamation marks
- Never open with "I hope this email finds you well", "Hope you're having a good week", or any similar pleasantry
- Adapt vocabulary to the recipient's vertical
- Warm, peer-to-peer tone — never salesy or robotic
- Never mention AI, automation, or that this was generated
- Append the unsubscribe footer verbatim as the final line of body, separated by two newlines
- Score your own output honestly — penalize generic phrases and any calendar link in CTA`,
        userPrompt: `Campaign: ${campaignName}
ICP: ${icpDescription}

Recipient:
- Name: ${lead.firstName ?? "there"}${lead.lastName ? ` ${lead.lastName}` : ""}
- Title: ${lead.title ?? "professional"}
- Company: ${lead.companyName}
- Website: ${lead.website ?? "unknown"}

Top signals (classified by tier):
${signalBlock}

Template subject: ${baseSubject}

Template body:
${baseBody}

Unsubscribe footer to append:
${unsubscribeFooter}

Rewrite the email to feel personal and relevant to this specific recipient while keeping the template's intent.`,
        tools: [PERSONALIZE_TOOL],
        metadata: { leadId: lead.id },
        temperature: 0.7,
    });

    const parsed = parsePersonalizedEmail(result);
    if (!parsed) {
        throw new Error("Personalization response failed shape validation");
    }

    return parsed;
}

async function scheduleNextEmailStep(
    leadId: string,
    campaignId: string,
    currentStepIndex: number,
): Promise<void> {
    const nextStep = await prisma.sequenceStep.findFirst({
        where: {
            campaignId,
            stepIndex: currentStepIndex + 1,
            channel: "EMAIL",
        },
    });
    if (!nextStep) return;

    const scheduledAt = new Date(Date.now() + nextStep.delayDays * 24 * 60 * 60_000);

    await prisma.leadStepStatus.upsert({
        where: { stepId_leadId: { stepId: nextStep.id, leadId } },
        create: { stepId: nextStep.id, leadId, status: "SCHEDULED", scheduledAt },
        update: { status: "SCHEDULED", scheduledAt },
    });

    logger.info(
        { leadId, nextStepIndex: nextStep.stepIndex, scheduledAt, trigger: nextStep.trigger },
        "[email-sequence.agent] Next email step scheduled",
    );
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
    let cursor = 0;

    async function runNext(): Promise<void> {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            await worker(items[index]);
        }
    }

    const workers = Array.from({ length: Math.min(limit, items.length) }, () => runNext());
    await Promise.all(workers);
}

export async function runEmailSequenceAgent(
    campaignId: string,
): Promise<{ processed: number; skipped: number; failed: number; heldForReview: number }> {
    const now = new Date();

    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: {
            name: true,
            icpDescription: true,
            createdById: true,
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

    const pendingStatuses = await prisma.leadStepStatus.findMany({
        where: {
            status: "SCHEDULED",
            scheduledAt: { lte: now },
            step: {
                campaignId,
                channel: "EMAIL",
            },
        },
        include: {
            step: {
                select: {
                    id: true,
                    stepIndex: true,
                    channel: true,
                    trigger: true,
                    messageTemplate: true,
                    subjectTemplate: true,
                    campaignId: true,
                },
            },
            lead: {
                select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    title: true,
                    companyName: true,
                    email: true,
                    website: true,
                    enrichmentData: true,
                    signals: {
                        where: { isActive: true },
                        orderBy: { confidence: "desc" },
                        take: 5,
                        select: { signalType: true, value: true, explanation: true },
                    },
                },
            },
        },
        orderBy: { scheduledAt: "asc" },
        take: MAX_BATCH,
    });

    logger.info(
        { campaignId, count: pendingStatuses.length },
        "[email-sequence.agent] Processing pending email steps",
    );

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let heldForReview = 0;

    await runWithConcurrency(pendingStatuses, PERSONALIZATION_CONCURRENCY, async (status) => {
        const { lead, step } = status;

        if (step.campaignId !== campaignId) {
            logger.error(
                { statusId: status.id, stepCampaignId: step.campaignId, campaignId },
                "[email-sequence.agent] Step campaignId mismatch — skipping",
            );
            await prisma.leadStepStatus.update({
                where: { id: status.id },
                data: { status: "SKIPPED", executedAt: now, errorMsg: "Step campaignId did not match run campaignId" },
            });
            skipped++;
            return;
        }

        if (!lead.email) {
            await prisma.leadStepStatus.update({
                where: { id: status.id },
                data: { status: "SKIPPED", executedAt: now, errorMsg: "Lead has no email address" },
            });
            skipped++;
            return;
        }

        if (!isNonEmptyString(step.messageTemplate) || !isNonEmptyString(step.subjectTemplate)) {
            await prisma.leadStepStatus.update({
                where: { id: status.id },
                data: {
                    status: "SKIPPED",
                    executedAt: now,
                    errorMsg: "Step missing messageTemplate or subjectTemplate",
                },
            });
            skipped++;
            return;
        }

        const locked = await prisma.leadStepStatus.updateMany({
            where: { id: status.id, status: "SCHEDULED" },
            data: { status: "EXECUTING" },
        });
        if (locked.count === 0) {
            logger.warn({ statusId: status.id }, "[email-sequence.agent] Status already executing — skipping");
            skipped++;
            return;
        }

        try {
            const subjectResult = applyMergeTags(step.subjectTemplate, lead);
            const bodyResult = applyMergeTags(step.messageTemplate, lead);
            const unresolvedTemplateTags = Array.from(
                new Set([...subjectResult.unresolvedTags, ...bodyResult.unresolvedTags]),
            );

            if (unresolvedTemplateTags.length > 0) {
                throw new Error(`Template has unresolved merge tags: ${unresolvedTemplateTags.join(", ")}`);
            }

            const personalized = await personalizeEmail({
                baseSubject: subjectResult.result,
                baseBody: bodyResult.result,
                lead,
                signals: lead.signals,
                icpDescription: campaign.icpDescription,
                campaignName: campaign.name,
                unsubscribeFooter,
            });

            const leadEd = (typeof lead.enrichmentData === "object" && lead.enrichmentData !== null && !Array.isArray(lead.enrichmentData))
                ? lead.enrichmentData as Record<string, unknown>
                : {};
            const leadCountry = (typeof leadEd.country === "string" && leadEd.country.trim().length > 0)
                ? leadEd.country
                : (typeof leadEd.countryCode === "string" && leadEd.countryCode.trim().length > 0)
                    ? leadEd.countryCode
                    : null;
            const consentBasis = typeof leadEd.consentBasis === "string" ? leadEd.consentBasis : null;

            const compliance = runComplianceGate(personalized, unsubscribeFooter, leadCountry, consentBasis);

            const createData: Prisma.OutreachMessageUncheckedCreateInput = {
                leadId: lead.id,
                channel: "EMAIL",
                subject: personalized.subject,
                body: personalized.body,
                approvalStatus: compliance.passed ? "APPROVED" : "PENDING",
                deliveryState: compliance.passed ? "QUEUED" : "DRAFT",
                spamRiskScore: personalized.spamRiskScore,
                personalizationScore: personalized.personalizationScore,
                leadingSignal: lead.signals[0]?.signalType ?? null,
                generationConfidence: personalized.personalizationScore,
            };

            if (!compliance.passed) {
                createData.enrichmentData = {
                    complianceViolations: compliance.violations,
                } as Prisma.InputJsonValue;
            }

            await prisma.$transaction(async (tx) => {
                await tx.outreachMessage.create({ data: createData });

                await tx.leadStepStatus.update({
                    where: { id: status.id },
                    data: { status: "DONE", executedAt: now },
                });
            });

            if (compliance.passed) {
                await scheduleNextEmailStep(lead.id, step.campaignId, step.stepIndex);
                processed++;
            } else {
                heldForReview++;
                logger.warn(
                    { leadId: lead.id, stepIndex: step.stepIndex, violations: compliance.violations },
                    "[email-sequence.agent] Email held for review — compliance gate failed",
                );
            }

            logger.info(
                {
                    leadId: lead.id,
                    stepIndex: step.stepIndex,
                    spamRiskScore: personalized.spamRiskScore,
                    personalizationScore: personalized.personalizationScore,
                    compliancePassed: compliance.passed,
                },
                "[email-sequence.agent] Email step done",
            );
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.error(
                { error, errorMessage: msg, leadId: lead.id, stepId: step.id },
                "[email-sequence.agent] Step failed",
            );
            await prisma.leadStepStatus.update({
                where: { id: status.id },
                data: { status: "FAILED", executedAt: now, errorMsg: msg.slice(0, 500) },
            });
            failed++;
        }
    });

    logger.info(
        { campaignId, processed, skipped, failed, heldForReview },
        "[email-sequence.agent] Batch complete",
    );
    return { processed, skipped, failed, heldForReview };
}