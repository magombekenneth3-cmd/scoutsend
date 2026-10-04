import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { callGeminiWithTools, MODELS, SchemaType, ToolDefinition } from "./gemini.client";
import { auditMessage } from "./compliance.agent";
import { logAudit } from "../audit/audit.service";
import { AUDIT_EVENTS, CROSS_SYSTEM_SEND_COORDINATION_GUARD_HOURS } from "../../lib/constants";
import { logLeadJourneyEvent } from "../../lib/leads/lead-journey.service";
import { sanitizePlaceholderTokens } from "./generate.agent";

const MAX_BATCH = 30;
const PERSONALIZATION_CONCURRENCY = 5;
const MIN_BODY_WORDS = 20;
const MAX_BODY_WORDS = 800;
const MAX_SUBJECT_LENGTH = 100;
const SPAM_RISK_MAX = 0.3;
const PERSONALIZATION_MIN = 0.7;

const MERGE_TAG_RE = /\{(firstName|lastName|companyName|title)\}/g;
const PLACEHOLDER_RE =
    /\[\s*(?:first?name|last[\s_]?name|full[\s_]?name|your\s+name|company(?:\s+name)?|website|email|title|name)\s*\]|\{\{\s*(?:first?name|last[\s_]?name|company(?:\s+name)?|name|title)\s*\}\}|\{\s*(?:first?name|last[\s_]?name|company(?:\s+name)?|name|title)\s*\}|\{\{[^{}]+\}\}|%[A-Z*]+%|\[\[[^\]]+\]\]/gi;

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
        .replace(/{firstName}/g, lead.firstName ?? "there")
        .replace(/{lastName}/g, lead.lastName ?? "")
        .replace(/{companyName}/g, lead.companyName)
        .replace(/{title}/g, lead.title ?? "professional")
        .trim();

    MERGE_TAG_RE.lastIndex = 0;
    const unresolvedTags = Array.from(new Set(result.match(MERGE_TAG_RE) ?? []));

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

interface CompetitorInsightRecord {
    tool: string;
    painPoint: string;
    userNote: string | null;
}

interface NextEmailStep {
    id: string;
    stepIndex: number;
    trigger: string;
    delayDays: number;
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

    const sharedViolations = auditMessage(
        email.subject,
        email.body,
        leadCountry,
        consentBasis,
        unsubscribeFooter,
    );

    for (const violation of sharedViolations) {
        const code =
            violation.detail !== undefined
                ? `${violation.code}:${violation.detail}`
                : violation.code;

        if (!violations.includes(code)) {
            violations.push(code);
        }
    }

    return {
        passed: violations.length === 0,
        violations,
    };
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
                    description:
                        "Refined subject line — max 9 words, no clickbait. If two or more strong personal hooks exist (location, alma mater, mutual connection, personal interest), use a plus-delimited sequence of tokens e.g. 'Geneva + Dogs + L'Auberge + [Sender Company]'. Otherwise refine the template subject.",
                },
                body: {
                    type: SchemaType.STRING,
                    description:
                        "Personalized email body structured into exactly 3 paragraphs separated by blank lines (double newline \\n\\n). No bullet points. No unsubscribe text.",
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
            required: [
                "subject",
                "body",
                "spamRiskScore",
                "personalizationScore",
            ],
        },
    },
    handler: async (args) => args,
};

function parsePersonalizedEmail(raw: unknown): PersonalizedEmail | null {
    if (typeof raw !== "object" || raw === null) {
        return null;
    }

    const obj = raw as Record<string, unknown>;

    if (!isNonEmptyString(obj.subject)) {
        return null;
    }

    if (!isNonEmptyString(obj.body)) {
        return null;
    }

    if (!isFiniteNumber(obj.spamRiskScore)) {
        return null;
    }

    if (!isFiniteNumber(obj.personalizationScore)) {
        return null;
    }

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
    signals: Array<{
        signalType: string;
        value: string;
        explanation: string | null;
    }>;
    icpDescription: string;
    campaignName: string;
    competitorSignal: boolean;
    competitorTech: string[];
    competitorInsights: CompetitorInsightRecord[];
    previousMessages?: Array<{ subject: string; body: string }>;
}): Promise<PersonalizedEmail> {
    const {
        baseSubject,
        baseBody,
        lead,
        signals,
        icpDescription,
        campaignName,
        competitorSignal,
        competitorTech,
        competitorInsights,
        previousMessages,
    } = params;

    const signalBlock =
        signals.length > 0
            ? signals
                .map(
                    (signal) =>
                        `• ${signal.signalType}: ${signal.value}${signal.explanation
                            ? ` (${signal.explanation})`
                            : ""
                        }`,
                )
                .join("\n")
            : "No enriched signals available — personalise from the company name and role context only.";

    const STATIC_ANGLES: Record<string, string> = {
        "apollo.io":
            "Apollo's database is often 12–18 months stale and its sequences are template-blasted — lead with data freshness and AI-written 1:1 personalisation as the gap.",
        "outreach.io":
            "Outreach is built for 500-seat enterprise teams; mid-market teams pay enterprise pricing for features they rarely use — lead with cost-to-outcome ratio and simplicity.",
        "salesloft.com":
            "Salesloft's cadence model optimises for volume, not reply quality — lead with reply-rate benchmarks and per-lead AI depth.",
        "instantly.ai":
            "Instantly's high-volume spray damages sender reputation and domain health over time — lead with deliverability rates and compliance posture.",
        "lemlist.com":
            "Lemlist excels at visual personalisation but has weak signal intelligence and ICP targeting — lead with enrichment depth and intent signals.",
        "smartlead.ai":
            "Smartlead is volume-first with minimal true personalisation — lead with AI-written 1:1 copy and inbox-placement rates.",
        "clay.com":
            "Clay is a workflow builder with no native sequencing or sending — lead with full-stack delivery and the fact that Clay users still need a separate sending tool.",
    };

    let competitorBlock = "";

    if (competitorSignal && competitorTech.length > 0) {
        const confirmedByTool = new Map<string, CompetitorInsightRecord[]>();

        for (const insight of competitorInsights) {
            const existing = confirmedByTool.get(insight.tool);

            if (existing) {
                existing.push(insight);
            } else {
                confirmedByTool.set(insight.tool, [insight]);
            }
        }

        const angleLines = competitorTech
            .map((tool) => {
                const confirmed = confirmedByTool.get(tool) ?? [];

                if (confirmed.length > 0) {
                    const fixes = confirmed
                        .map((insight) =>
                            insight.userNote
                                ? `${insight.painPoint} (your fix: ${insight.userNote})`
                                : insight.painPoint,
                        )
                        .join("; ");

                    return `• ${tool}: Users complain — ${fixes}. Your product directly addresses these gaps.`;
                }

                return STATIC_ANGLES[tool]
                    ? `• ${tool}: ${STATIC_ANGLES[tool]}`
                    : `• ${tool}: acknowledge they already have outbound tooling in this category and show a specific gap in reply quality, data freshness, or deliverability.`;
            })
            .join("\n");

        competitorBlock =
            `\n\nCOMPETITOR CONTEXT (treat as the highest-priority signal):\n` +
            `This company currently uses: ${competitorTech.join(", ")}.\n` +
            `Displacement angles for their stack:\n${angleLines}\n` +
            `Do NOT name or mock these tools by brand in the email. Reference "your current stack" or "most [category] tools". Never say "switch" — use "add on top of" or "complement what you have".`;
    }

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

VALUE PROPOSITION & PROOF POINT:

- State the concrete challenge solved.
- Immediately follow with a realistic proof point or outcome reference relevant to the recipient's industry.
- Preempt the most likely objection in one sentence — acknowledge they may already have a vendor or internal process, then differentiate on execution quality.

COMPETITOR DISPLACEMENT (activate only when COMPETITOR CONTEXT appears in the user prompt):

- This prospect already pays for outbound tooling. Treat them as a sophisticated buyer who knows the space.
- Structure: Specific gap observation → Proof of the alternative → Low-friction CTA.
- Use the displacement angle supplied — data freshness, reply rates, deliverability, cost, or personalisation depth.
- Never name or mock a competitor brand. Use "your current stack", "most tools in this category", or "teams using [generic category name]".
- Never use the word "switch". Use "complement", "add on top of", or "run alongside".
- End the CTA with an acknowledgment of switching cost: e.g. "Not asking you to rip anything out — worth 15 minutes to see where we'd sit alongside what you have?"
- Score personalizationScore higher when using this mode — competitor context is the strongest possible signal.

BANNED PHRASES (zero tolerance):

- "cut through the noise", "maximize engagement", "drive pipeline", "all-in-one platform"
- "streamline workflows", "hope this email finds you well", "reach out"
- "synergy", "leverage" (as a verb), "scalable solution", any abstract marketing filler

CTA RULES (mandatory):

- Keep the CTA low-friction, casual, and binary — no scheduling links, no specific date/time requests.
- Use one of these patterns (adapt wording to the recipient's industry):
  - "Worth a brief call to see how this works for [Company/Industry]?"
  - "Want me to send over a short breakdown of how we do this?"
  - "Should we do a quick exchange to see if there's a fit?"

ADDITIONAL RULES:

- Keep the core value proposition from the template unchanged
- Subject line: 6–9 words, no clickbait, no ALL CAPS (or use plus-delimited personal hooks if available)
- Structure the body into exactly 3 paragraphs separated by blank lines (\\n\\n):
  - Paragraph 1: The personalized observation or hook.
  - Paragraph 2: Value proposition + proof point + objection preemption.
  - Paragraph 3: The low-friction CTA question.
- Never use exclamation marks
- Never open with "I hope this email finds you well", "Hope you're having a good week", or any similar pleasantry
- Adapt vocabulary to the recipient's vertical (e.g. "clients" and "matters" for law firms; "patients" and "census" for healthcare; "projects" and "bids" for construction; "pipeline" and "conversion" for tech)
- Warm, peer-to-peer tone — never salesy or robotic
- Never mention AI, automation, or that this was generated
- Do NOT include or append any unsubscribe text in the body. The template renderer handles compliance footers automatically.
- Score your own output honestly — penalize generic phrases, banned clichés, and any calendar link in CTA`,
        userPrompt: `Campaign: ${campaignName}
ICP: ${icpDescription}

Recipient:

- Name: ${lead.firstName ?? "there"}${lead.lastName ? ` ${lead.lastName}` : ""}
- Title: ${lead.title ?? "professional"}
- Company: ${lead.companyName}
- Website: ${lead.website ?? "unknown"}

Top signals (classified by tier):
${signalBlock}${competitorBlock}${previousMessages && previousMessages.length > 0
    ? `\n\nPREVIOUSLY SENT EMAILS (do NOT repeat these hooks, angles, opening observations, or value proposition framings — approach from a completely different angle):\n${previousMessages.map((m, i) => `Step ${i + 1}:\n  Subject: ${m.subject}\n  Opening: ${m.body.split(/\n/)[0].slice(0, 200)}`).join("\n")}`
    : ""}

Template subject: ${baseSubject}

Template body:
${baseBody}

Rewrite the email to feel personal and relevant to this specific recipient while keeping the template's intent.`,
        tools: [PERSONALIZE_TOOL],
        metadata: { leadId: lead.id },
        temperature: 0.7,
    });

    const parsed = parsePersonalizedEmail(result);

    if (!parsed) {
        throw new Error("Personalization response failed shape validation");
    }

    const sanitizedSubject = sanitizePlaceholderTokens(parsed.subject, lead.firstName ?? "", lead.companyName);
    const sanitizedBody = sanitizePlaceholderTokens(parsed.body, lead.firstName ?? "", lead.companyName);

    return {
        ...parsed,
        subject: sanitizedSubject,
        body: sanitizedBody,
    };
}

async function scheduleNextEmailStep(
    leadId: string,
    nextStep: NextEmailStep | undefined,
): Promise<void> {
    if (!nextStep) {
        return;
    }

    const scheduledAt = new Date(
        Date.now() + nextStep.delayDays * 24 * 60 * 60_000,
    );

    await prisma.leadStepStatus.upsert({
        where: {
            stepId_leadId: {
                stepId: nextStep.id,
                leadId,
            },
        },
        create: {
            stepId: nextStep.id,
            leadId,
            status: "SCHEDULED",
            scheduledAt,
        },
        update: {
            status: "SCHEDULED",
            scheduledAt,
        },
    });

    logger.info(
        {
            leadId,
            nextStepIndex: nextStep.stepIndex,
            scheduledAt,
            trigger: nextStep.trigger,
        },
        "[email-sequence.agent] Next email step scheduled",
    );
}

async function runWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>,
): Promise<void> {
    let cursor = 0;

    async function runNext(): Promise<void> {
        while (true) {
            const index = cursor++;

            if (index >= items.length) {
                return;
            }

            await worker(items[index]);
        }
    }

    const workers = Array.from(
        { length: Math.min(limit, items.length) },
        () => runNext(),
    );

    await Promise.all(workers);
}

export async function runEmailSequenceAgent(
    campaignId: string,
): Promise<{
    processed: number;
    skipped: number;
    failed: number;
    heldForReview: number;
}> {
    const now = new Date();

    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: {
            name: true,
            icpDescription: true,
            createdById: true,
        },
    });

    if (!campaign) {
        throw new Error("Campaign not found");
    }

    const brandSettings = await prisma.brandSettings.findUnique({
        where: { userId: campaign.createdById },
        select: { unsubscribeText: true },
    });

    const unsubscribeFooter =
        brandSettings?.unsubscribeText ??
        "You received this email because you match our ideal customer profile. To unsubscribe, reply with 'unsubscribe'.";

    const guardCutoff = new Date(
        now.getTime() -
        CROSS_SYSTEM_SEND_COORDINATION_GUARD_HOURS * 60 * 60 * 1000,
    );

    const pendingStatuses = await prisma.leadStepStatus.findMany({
        where: {
            status: "SCHEDULED",
            scheduledAt: { lte: now },
            step: {
                campaignId,
                channel: "EMAIL",
            },
            lead: {
                outreachMessages: {
                    none: {
                        isFollowUp: true,
                        createdAt: { gte: guardCutoff },
                    },
                },
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
                    delayDays: true,
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
                    competitorSignal: true,
                    competitorTech: true,
                    signals: {
                        where: { isActive: true },
                        orderBy: { confidence: "desc" },
                        take: 5,
                        select: {
                            signalType: true,
                            value: true,
                            explanation: true,
                        },
                    },
                },
            },
        },
        orderBy: { scheduledAt: "asc" },
        take: MAX_BATCH,
    });

    logger.info(
        {
            campaignId,
            count: pendingStatuses.length,
        },
        "[email-sequence.agent] Processing pending email steps",
    );

    if (pendingStatuses.length === 0) {
        logger.info(
            {
                campaignId,
                processed: 0,
                skipped: 0,
                failed: 0,
                heldForReview: 0,
            },
            "[email-sequence.agent] Batch complete",
        );

        return {
            processed: 0,
            skipped: 0,
            failed: 0,
            heldForReview: 0,
        };
    }

    const competitorTools = Array.from(
        new Set(
            pendingStatuses.flatMap(({ lead }) =>
                lead.competitorSignal && lead.competitorTech.length > 0
                    ? lead.competitorTech
                    : [],
            ),
        ),
    );

    const competitorInsights =
        competitorTools.length > 0
            ? await prisma.competitorInsight.findMany({
                where: {
                    userId: campaign.createdById,
                    tool: { in: competitorTools },
                    userFixesIt: true,
                },
                select: {
                    tool: true,
                    painPoint: true,
                    userNote: true,
                },
            })
            : [];

    const nextStepIndexes = Array.from(
        new Set(
            pendingStatuses
                .map(({ step }) => step.stepIndex + 1)
                .filter((stepIndex) => Number.isInteger(stepIndex)),
        ),
    );

    const nextSteps =
        nextStepIndexes.length > 0
            ? await prisma.sequenceStep.findMany({
                where: {
                    campaignId,
                    channel: "EMAIL",
                    stepIndex: { in: nextStepIndexes },
                },
                select: {
                    id: true,
                    stepIndex: true,
                    trigger: true,
                    delayDays: true,
                },
            })
            : [];

    const nextStepByIndex = new Map<number, NextEmailStep>();

    for (const nextStep of nextSteps) {
        nextStepByIndex.set(nextStep.stepIndex, nextStep);
    }

    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let heldForReview = 0;

    await runWithConcurrency(
        pendingStatuses,
        PERSONALIZATION_CONCURRENCY,
        async (status) => {
            const { lead, step } = status;

            const locked = await prisma.leadStepStatus.updateMany({
                where: {
                    id: status.id,
                    status: "SCHEDULED",
                },
                data: {
                    status: "EXECUTING",
                },
            });

            if (locked.count === 0) {
                logger.warn(
                    { statusId: status.id },
                    "[email-sequence.agent] Status already executing — skipping",
                );
                skipped++;
                return;
            }

            try {
                if (step.campaignId !== campaignId) {
                    throw new Error(
                        "Step campaignId did not match run campaignId",
                    );
                }

                if (!isNonEmptyString(lead.email)) {
                    await prisma.leadStepStatus.update({
                        where: { id: status.id },
                        data: {
                            status: "SKIPPED",
                            executedAt: now,
                            errorMsg: "Lead has no email address",
                        },
                    });
                    skipped++;
                    return;
                }

                if (
                    !isNonEmptyString(step.messageTemplate) ||
                    !isNonEmptyString(step.subjectTemplate)
                ) {
                    await prisma.leadStepStatus.update({
                        where: { id: status.id },
                        data: {
                            status: "SKIPPED",
                            executedAt: now,
                            errorMsg:
                                "Step missing messageTemplate or subjectTemplate",
                        },
                    });
                    skipped++;
                    return;
                }

                const subjectResult = applyMergeTags(
                    step.subjectTemplate,
                    lead,
                );

                const bodyResult = applyMergeTags(
                    step.messageTemplate,
                    lead,
                );

                const unresolvedTemplateTags = Array.from(
                    new Set([
                        ...subjectResult.unresolvedTags,
                        ...bodyResult.unresolvedTags,
                    ]),
                );

                if (unresolvedTemplateTags.length > 0) {
                    throw new Error(
                        `Template has unresolved merge tags: ${unresolvedTemplateTags.join(", ")}`,
                    );
                }

                const previousMessages =
                    step.stepIndex > 0
                        ? await prisma.outreachMessage.findMany({
                            where: {
                                leadId: lead.id,
                                isFollowUp: true,
                                deliveryState: { in: ["SENT", "QUEUED"] },
                            },
                            select: { subject: true, body: true },
                            orderBy: { createdAt: "asc" },
                            take: 3,
                        })
                        : undefined;

                const personalized = await personalizeEmail({
                    baseSubject: subjectResult.result,
                    baseBody: bodyResult.result,
                    lead,
                    signals: lead.signals,
                    icpDescription: campaign.icpDescription,
                    campaignName: campaign.name,
                    competitorSignal: lead.competitorSignal,
                    competitorTech: lead.competitorTech,
                    competitorInsights,
                    previousMessages,
                });

                const leadEd =
                    typeof lead.enrichmentData === "object" &&
                        lead.enrichmentData !== null &&
                        !Array.isArray(lead.enrichmentData)
                        ? (lead.enrichmentData as Record<string, unknown>)
                        : {};

                const leadCountry =
                    typeof leadEd.country === "string" &&
                        leadEd.country.trim().length > 0
                        ? leadEd.country
                        : typeof leadEd.countryCode === "string" &&
                            leadEd.countryCode.trim().length > 0
                            ? leadEd.countryCode
                            : null;

                const consentBasis =
                    typeof leadEd.consentBasis === "string"
                        ? leadEd.consentBasis
                        : null;

                const compliance = runComplianceGate(
                    personalized,
                    unsubscribeFooter,
                    leadCountry,
                    consentBasis,
                );

                const createData: Prisma.OutreachMessageUncheckedCreateInput =
                {
                    leadId: lead.id,
                    channel: "EMAIL",
                    subject: personalized.subject,
                    body: personalized.body,
                    approvalStatus: compliance.passed
                        ? "APPROVED"
                        : "PENDING",
                    deliveryState: compliance.passed ? "QUEUED" : "DRAFT",
                    spamRiskScore: personalized.spamRiskScore,
                    personalizationScore:
                        personalized.personalizationScore,
                    leadingSignal:
                        lead.signals[0]?.signalType ?? null,
                    generationConfidence:
                        personalized.personalizationScore,
                };

                if (!compliance.passed) {
                    createData.enrichmentData = {
                        complianceViolations: compliance.violations,
                    } as Prisma.InputJsonValue;
                }

                const createdMessage = await prisma.$transaction(
                    async (tx) => {
                        const created = await tx.outreachMessage.create({
                            data: createData,
                        });

                        await tx.leadStepStatus.update({
                            where: { id: status.id },
                            data: {
                                status: "DONE",
                                executedAt: now,
                            },
                        });

                        return created;
                    },
                );

                if (compliance.passed) {
                    await logLeadJourneyEvent({
                        leadId: lead.id,
                        eventType: "SEQUENCE_STEP_EXECUTED",
                        channel: "EMAIL",
                        outreachMessageId: createdMessage.id,
                        metadata: {
                            stepIndex: step.stepIndex,
                            campaignId: step.campaignId,
                        },
                    });

                    await scheduleNextEmailStep(
                        lead.id,
                        nextStepByIndex.get(step.stepIndex + 1),
                    );

                    processed++;
                } else {
                    heldForReview++;

                    logger.warn(
                        {
                            leadId: lead.id,
                            stepIndex: step.stepIndex,
                            violations: compliance.violations,
                        },
                        "[email-sequence.agent] Email held for review — compliance gate failed",
                    );

                    logAudit({
                        userId: campaign.createdById,
                        action: AUDIT_EVENTS.COMPLIANCE_BLOCKED,
                        entityType: "OutreachMessage",
                        entityId: lead.id,
                        metadata: {
                            violations: compliance.violations,
                            stepIndex: step.stepIndex,
                            campaignId: step.campaignId,
                        },
                    }).catch(() => { });
                }

                logger.info(
                    {
                        leadId: lead.id,
                        stepIndex: step.stepIndex,
                        spamRiskScore: personalized.spamRiskScore,
                        personalizationScore:
                            personalized.personalizationScore,
                        compliancePassed: compliance.passed,
                    },
                    "[email-sequence.agent] Email step done",
                );
            } catch (error) {
                const msg =
                    error instanceof Error ? error.message : String(error);

                logger.error(
                    {
                        error,
                        errorMessage: msg,
                        leadId: lead.id,
                        stepId: step.id,
                    },
                    "[email-sequence.agent] Step failed",
                );

                await prisma.leadStepStatus.update({
                    where: { id: status.id },
                    data: {
                        status: "FAILED",
                        executedAt: now,
                        errorMsg: msg.slice(0, 500),
                    },
                });

                failed++;
            }
        },
    );

    logger.info(
        {
            campaignId,
            processed,
            skipped,
            failed,
            heldForReview,
        },
        "[email-sequence.agent] Batch complete",
    );

    return {
        processed,
        skipped,
        failed,
        heldForReview,
    };
}