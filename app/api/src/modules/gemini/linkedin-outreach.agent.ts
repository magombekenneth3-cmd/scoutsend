import { Channel } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { createLinkedInProvider } from "../../lib/linkedIn";
import { callGeminiWithTools, MODELS, SchemaType, ToolDefinition } from "./gemini.client";
import { logger } from "../../lib/logger";
import type { ProviderError, ProviderErrorCode } from "../../lib/linkedIn/linkedin.provider";
import { checkTextSpam } from "./compliance.agent";

class InvitationLimitError extends Error {
    constructor() {
        super("LinkedIn invitation limit reached — halting batch");
        this.name = "InvitationLimitError";
    }
}

class BatchAbortError extends Error {
    constructor(public readonly lastCode: string, public readonly count: number) {
        super(`LinkedIn batch aborted: ${count} consecutive provider errors (last: ${lastCode})`);
        this.name = "BatchAbortError";
    }
}

const MAX_BATCH = 20;
const CONNECT_NOTE_MAX = 300;
const MESSAGE_MAX = 1_900;

const LI_DELAY_MIN_MS = 2_000;
const LI_DELAY_MAX_MS = 6_000;

const MAX_CONSECUTIVE_ERRORS = 2;

const LEAD_SPECIFIC_CODES = new Set<ProviderErrorCode>([
    "PROFILE_NOT_FOUND",
    "MESSAGE_BLOCKED",
]);

function liDelay(): Promise<void> {
    const ms = LI_DELAY_MIN_MS + Math.random() * (LI_DELAY_MAX_MS - LI_DELAY_MIN_MS);
    return new Promise((r) => setTimeout(r, ms));
}

function extractProviderCode(error: unknown): ProviderErrorCode {
    if (error && typeof error === "object" && "code" in error) {
        return (error as { code: ProviderErrorCode }).code;
    }
    const msg = error instanceof Error ? error.message : String(error);
    const match = /\b(RATE_LIMIT|AUTH_EXPIRED|PROFILE_NOT_FOUND|INVITATION_LIMIT|MESSAGE_BLOCKED|TIMEOUT|NETWORK_ERROR)\b/.exec(msg);
    return (match?.[1] as ProviderErrorCode) ?? "UNKNOWN";
}

const LINKEDIN_CHANNELS = new Set<Channel>([
    "LINKEDIN_VISIT",
    "LINKEDIN_CONNECT",
    "LINKEDIN_MESSAGE",
    "LINKEDIN_INMAIL",
    "LINKEDIN_POST_CONNECT",
]);

/**
 * Channels that SMYKM guidelines have soft-deprecated for cold outbound.
 * We skip them with a logged warning rather than a hard error so existing
 * sequence steps do not blow up — campaign builders should migrate to
 * LINKEDIN_CONNECT + LINKEDIN_POST_CONNECT instead.
 */
const DEPRECATED_LINKEDIN_CHANNELS = new Set<Channel>([
    "LINKEDIN_VISIT",
    "LINKEDIN_INMAIL",
]);

interface GeneratedLinkedInCopy {
    message: string;
}

const LINKEDIN_COPY_TOOL: ToolDefinition = {
    declaration: {
        name: "returnResult",
        description: "Return the composed LinkedIn message.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                message: {
                    type: SchemaType.STRING,
                    description: "The composed message text.",
                },
            },
            required: ["message"],
        },
    },
    handler: async (args) => args,
};

async function generateLinkedInCopy(opts: {
    channel: Channel;
    stepIndex: number;
    lead: {
        firstName: string | null;
        lastName: string | null;
        title: string | null;
        companyName: string;
    };
    icpDescription: string;
    template: string | null;
    priorEmailCount?: number;
}): Promise<string> {
    const { channel, stepIndex, lead, icpDescription, template, priorEmailCount = 0 } = opts;

    if (template) {
        return template
            .replace(/\{firstName\}/g, lead.firstName ?? "there")
            .replace(/\{lastName\}/g, lead.lastName ?? "")
            .replace(/\{companyName\}/g, lead.companyName)
            .replace(/\{title\}/g, lead.title ?? "professional")
            .trim()
            .slice(0, channel === "LINKEDIN_CONNECT" ? CONNECT_NOTE_MAX : MESSAGE_MAX);
    }

    const isConnectNote = channel === "LINKEDIN_CONNECT";
    const isPostConnect = channel === "LINKEDIN_POST_CONNECT";
    const maxChars = isConnectNote ? CONNECT_NOTE_MAX : MESSAGE_MAX;

    // SMYKM: post-connection note is always the same polite formula — no LLM needed.
    if (isPostConnect) {
        return `Thank you so much for connecting, ${lead.firstName ?? "there"}. I look forward to staying in touch.`
            .slice(0, MESSAGE_MAX);
    }

    const connectNoteContext = isConnectNote && priorEmailCount > 0
        ? `\n\nIMPORTANT CONTEXT: This prospect has already received ${priorEmailCount} email(s) from the sender. Your connection note MUST reference that: e.g. "My name might look familiar as I've reached out via email. I would still be grateful for the chance to chat about how [sender company] can support ${lead.companyName}. If you're ever up for a chat, please let me know." Keep it under 300 characters. Never pitch features — polite and peer-to-peer only.`
        : isConnectNote
            ? `\n\nIMPORTANT CONTEXT: Write a short, warm connection request note. Introduce yourself and your company briefly, express genuine interest in staying in touch, and invite conversation without pitching. Under 300 characters.`
            : "";

    const { result } = await callGeminiWithTools<GeneratedLinkedInCopy>({
        agentName: `linkedin.copy.${channel.toLowerCase()}.step${stepIndex}`,
        model: MODELS.GENERATE,
        systemPrompt: `You are writing a LinkedIn ${isConnectNote ? "connection request note" : "direct message"} for B2B outreach.\n\nRules:\n- Maximum ${maxChars} characters — hard limit\n- No "I saw your profile" or "checking in" openers\n- Reference their company or role specifically\n- One clear, soft CTA (connect / quick call / short reply)\n- Peer-to-peer tone — warm, direct, no corporate buzzwords\n- Never mention AI, automation, or sales tools\n- Never include calendar scheduling links\n${isConnectNote ? "- Connection notes MUST be under 300 characters. Be extremely concise." : ""}\n\nReturn the message text using the returnResult tool.${connectNoteContext}`,
        userPrompt: `Write a ${isConnectNote ? "LinkedIn connection note" : "LinkedIn direct message"} for:\n\nLead: ${lead.firstName ?? ""} ${lead.lastName ?? ""}, ${lead.title ?? "professional"} at ${lead.companyName}\nICP context: ${icpDescription}\nSequence step: ${stepIndex + 1}\n\nWrite it now.`,
        tools: [LINKEDIN_COPY_TOOL],
        temperature: 0.75,
        maxTurns: 3,
    });

    return (result.message ?? "").trim().slice(0, maxChars);
}

const LINKEDIN_URL_RE = /https?:\/\/[^\s]+/gi;
const LINKEDIN_PLACEHOLDER_RE = /\{\{[^}]+\}\}|\[[^\]]+\]|%[A-Z_]+%/g;

interface LinkedInAuditResult {
    violations: string[];
    charCount: number;
}

function auditLinkedInCopy(text: string, channel: Channel, allowedLinks: string[] = []): LinkedInAuditResult {
    const violations: string[] = [];
    const charCount = text.length;
    const maxChars = channel === "LINKEDIN_CONNECT" ? CONNECT_NOTE_MAX : MESSAGE_MAX;

    if (charCount > maxChars) {
        violations.push(`too_long:${charCount}`);
    }

    LINKEDIN_PLACEHOLDER_RE.lastIndex = 0;
    if (LINKEDIN_PLACEHOLDER_RE.test(text)) {
        violations.push("unfilled_placeholder");
    }

    const { matchesCount } = checkTextSpam(text);
    if (matchesCount > 0) {
        violations.push(`spam_triggers:${matchesCount}`);
    }

    LINKEDIN_URL_RE.lastIndex = 0;
    const urls = text.match(LINKEDIN_URL_RE) ?? [];
    const unsolicited = urls.some((u) => !allowedLinks.some((a) => u.startsWith(a)));
    if (unsolicited) {
        violations.push("unsolicited_url");
    }

    return { violations, charCount };
}

async function scheduleNextStep(
    leadId: string,
    campaignId: string,
    currentStepIndex: number,
): Promise<void> {
    const nextStep = await prisma.sequenceStep.findFirst({
        where: { campaignId, stepIndex: currentStepIndex + 1 },
    });
    if (!nextStep) return;
    if (
        nextStep.trigger === "ON_CONNECT_ACCEPT" ||
        nextStep.trigger === "ON_NO_ACCEPT"
    ) {
        logger.info(
            { leadId, nextStepIndex: nextStep.stepIndex, trigger: nextStep.trigger },
            "[linkedin.agent] Next step uses event-driven trigger — skipping time-based scheduling",
        );
        return;
    }

    const scheduledAt = new Date(
        Date.now() + nextStep.delayDays * 24 * 60 * 60_000,
    );

    await prisma.leadStepStatus.upsert({
        where: { stepId_leadId: { stepId: nextStep.id, leadId } },
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
        { leadId, nextStepIndex: nextStep.stepIndex, scheduledAt, channel: nextStep.channel },
        "[linkedin.agent] Next step scheduled",
    );
}

export async function runLinkedInOutreachAgent(
    campaignId: string,
): Promise<{ processed: number; skipped: number; failed: number }> {
    const linkedin = await createLinkedInProvider(campaignId);
    if (!linkedin) {
        logger.debug({ campaignId }, "[linkedin.agent] No provider — skipping");
        return { processed: 0, skipped: 0, failed: 0 };
    }

    const { provider, account } = linkedin;
    const now = new Date();

    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { createdById: true, enrichmentData: true },
    });
    if (!campaign) {
        return { processed: 0, skipped: 0, failed: 0 };
    }

    const brandSettings = await prisma.brandSettings.findUnique({
        where: { userId: campaign.createdById },
        select: { website: true },
    });

    const allowedLinks: string[] = [];
    if (brandSettings?.website) {
        allowedLinks.push(brandSettings.website.trim());
    }
    if (process.env.CALENDLY_URL) {
        allowedLinks.push(process.env.CALENDLY_URL.trim());
    }

    const campEd = (campaign.enrichmentData ?? {}) as Record<string, unknown>;
    const approvedLinks = Array.isArray(campEd.approvedLinks)
        ? campEd.approvedLinks.filter((u): u is string => typeof u === "string")
        : [];
    for (const link of approvedLinks) {
        allowedLinks.push(link.trim());
    }

    const pendingStatuses = await prisma.leadStepStatus.findMany({
        where: {
            status: "SCHEDULED",
            scheduledAt: { lte: now },
            step: {
                campaignId,
                channel: { in: [...LINKEDIN_CHANNELS] as Channel[] },
            },
        },
        include: {
            step: {
                select: {
                    id: true,
                    stepIndex: true,
                    channel: true,
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
                    linkedinUrl: true,
                    campaign: {
                        select: { icpDescription: true },
                    },
                },
            },
        },
        orderBy: { scheduledAt: "asc" },
        take: MAX_BATCH,
    });

    logger.info(
        { campaignId, count: pendingStatuses.length },
        "[linkedin.agent] Processing pending steps",
    );

    // Pre-fetch email send counts per lead for SMYKM connect note context.
    const leadIds = pendingStatuses.map((s) => s.lead.id);
    const emailCounts = await prisma.outreachMessage.groupBy({
        by: ["leadId"],
        where: { leadId: { in: leadIds } },
        _count: { id: true },
    });
    const emailCountByLead = new Map(emailCounts.map((r) => [r.leadId, r._count.id]));

    let processed = 0;
    let skipped = 0;
    let failed = 0;

    let consecutiveErrors = 0;

    try {
        for (const status of pendingStatuses) {
            const { lead, step } = status;

        if (!lead.linkedinUrl) {
            await prisma.leadStepStatus.update({
                where: { id: status.id },
                data: {
                    status: "SKIPPED",
                    executedAt: now,
                    errorMsg: "Lead has no linkedinUrl",
                },
            });
            skipped++;
            continue;
        }

        const locked = await prisma.leadStepStatus.updateMany({
            where: { id: status.id, status: "SCHEDULED" },
            data: { status: "EXECUTING" },
        });
        if (locked.count === 0) {
            logger.warn({ statusId: status.id }, "[linkedin.agent] Status already executing — skipping");
            skipped++;
            continue;
        }

        const profile = { profileUrl: lead.linkedinUrl };
        const errMsg = (e: unknown) => e instanceof Error ? e.message : String(e);

        try {
            let providerRef: string | undefined;
            let messageSent: string | undefined;
            let qualityFlags: { violations: string[]; charCount: number } | undefined;

            // SMYKM: soft-deprecate VISIT and INMAIL for cold outbound.
            if (DEPRECATED_LINKEDIN_CHANNELS.has(step.channel)) {
                logger.warn(
                    { leadId: lead.id, channel: step.channel, stepId: step.id },
                    `[linkedin.agent] SMYKM: ${step.channel} is soft-deprecated for cold outbound. Skipping — replace with LINKEDIN_CONNECT + LINKEDIN_POST_CONNECT in your sequence.`,
                );
                await prisma.leadStepStatus.update({
                    where: { id: status.id },
                    data: {
                        status: "SKIPPED",
                        executedAt: now,
                        errorMsg: `smykm_deprecated:${step.channel}`,
                    },
                });
                skipped++;
                await scheduleNextStep(lead.id, step.campaignId, step.stepIndex);
                continue;
            }

            switch (step.channel as Channel) {
                case "LINKEDIN_VISIT": {
                    const res = await provider.visitProfile(account, profile);
                    if ("error" in res) throw new Error(errMsg(res.error));
                    break;
                }

                case "LINKEDIN_CONNECT": {
                    const contactCheck = await provider.canContact(account, profile);
                    if (!contactCheck.allowed) {
                        logger.info(
                            { leadId: lead.id, reason: contactCheck.reason },
                            "[linkedin.agent] canContact returned false — skipping CONNECT step",
                        );
                        await prisma.leadStepStatus.update({
                            where: { id: status.id },
                            data: {
                                status: "SKIPPED",
                                executedAt: now,
                                errorMsg: `canContact: ${contactCheck.reason ?? "not allowed"}`,
                            },
                        });
                        skipped++;
                        await scheduleNextStep(lead.id, step.campaignId, step.stepIndex);
                        continue;
                    }

                    const note = await generateLinkedInCopy({
                        channel: step.channel,
                        stepIndex: step.stepIndex,
                        lead,
                        icpDescription: lead.campaign.icpDescription,
                        template: step.messageTemplate,
                        priorEmailCount: emailCountByLead.get(lead.id) ?? 0,
                    });

                    const audit = auditLinkedInCopy(note, step.channel, allowedLinks);
                    if (audit.violations.some((v) => v.startsWith("unfilled_placeholder") || v.startsWith("too_long") || v.startsWith("spam_triggers") || v.startsWith("unsolicited_url"))) {
                        logger.warn({ leadId: lead.id, violations: audit.violations }, "[linkedin.agent] CONNECT note blocked by pre-send audit");
                        await prisma.leadStepStatus.update({
                            where: { id: status.id },
                            data: { status: "SKIPPED", executedAt: now, errorMsg: `pre_send_audit:${audit.violations.join(",")}` },
                        });
                        skipped++;
                        continue;
                    }

                    const res = await provider.sendConnectionRequest(account, profile, note);
                    if ("error" in res) {
                        const provErr = res.error as ProviderError;
                        if (provErr.code === "INVITATION_LIMIT") {
                            logger.warn(
                                { leadId: lead.id, stepId: step.id },
                                "[linkedin.agent] INVITATION_LIMIT reached — halting batch",
                            );
                            throw new InvitationLimitError();
                        }
                        throw new Error(errMsg(res.error));
                    }
                    if (res.async) throw new Error("Async connection request not supported");
                    providerRef = res.result.invitationId;
                    messageSent = note;
                    qualityFlags = audit;
                    break;
                }

                case "LINKEDIN_MESSAGE": {
                    const rel = await provider.checkConnectionStatus(account, profile);
                    if (!rel.connected) {
                        logger.info({ leadId: lead.id }, "[linkedin.agent] Not connected — skipping DM step");
                        await prisma.leadStepStatus.update({
                            where: { id: status.id },
                            data: {
                                status: "SKIPPED",
                                executedAt: now,
                                errorMsg: "Not a 1st-degree connection",
                            },
                        });
                        skipped++;
                        await scheduleNextStep(lead.id, step.campaignId, step.stepIndex);
                        continue;
                    }

                    const msg = await generateLinkedInCopy({
                        channel: step.channel,
                        stepIndex: step.stepIndex,
                        lead,
                        icpDescription: lead.campaign.icpDescription,
                        template: step.messageTemplate,
                    });

                    const msgAudit = auditLinkedInCopy(msg, step.channel, allowedLinks);
                    if (msgAudit.violations.some((v) => v.startsWith("unfilled_placeholder") || v.startsWith("too_long") || v.startsWith("spam_triggers") || v.startsWith("unsolicited_url"))) {
                        logger.warn({ leadId: lead.id, violations: msgAudit.violations }, "[linkedin.agent] DM blocked by pre-send audit");
                        await prisma.leadStepStatus.update({
                            where: { id: status.id },
                            data: { status: "SKIPPED", executedAt: now, errorMsg: `pre_send_audit:${msgAudit.violations.join(",")}` },
                        });
                        skipped++;
                        continue;
                    }

                    const res = await provider.sendMessage(account, profile, { text: msg });
                    if ("error" in res) throw new Error(errMsg(res.error));
                    if (res.async) throw new Error("Async message not supported");
                    providerRef = res.result.messageId;
                    messageSent = msg;
                    qualityFlags = msgAudit;
                    break;
                }

                case "LINKEDIN_INMAIL": {
                    // This branch is unreachable after the soft-deprecation guard above,
                    // but retained for type-safety / exhaustive switch handling.
                    logger.warn({ leadId: lead.id }, "[linkedin.agent] INMAIL reached switch — should have been caught by deprecation guard");
                    skipped++;
                    break;
                }

                case "LINKEDIN_POST_CONNECT": {
                    const rel = await provider.checkConnectionStatus(account, profile);
                    if (!rel.connected) {
                        logger.info({ leadId: lead.id }, "[linkedin.agent] POST_CONNECT: not yet connected — skipping");
                        await prisma.leadStepStatus.update({
                            where: { id: status.id },
                            data: { status: "SKIPPED", executedAt: now, errorMsg: "Not yet connected" },
                        });
                        skipped++;
                        await scheduleNextStep(lead.id, step.campaignId, step.stepIndex);
                        continue;
                    }

                    const thankYouMsg = await generateLinkedInCopy({
                        channel: step.channel,
                        stepIndex: step.stepIndex,
                        lead,
                        icpDescription: lead.campaign.icpDescription,
                        template: step.messageTemplate,
                    });

                    const tyAudit = auditLinkedInCopy(thankYouMsg, "LINKEDIN_MESSAGE", allowedLinks);
                    const res = await provider.sendMessage(account, profile, { text: thankYouMsg });
                    if ("error" in res) throw new Error(errMsg(res.error));
                    if (res.async) throw new Error("Async message not supported");
                    providerRef = res.result.messageId;
                    messageSent = thankYouMsg;
                    qualityFlags = tyAudit;
                    break;
                }

                default:
                    throw new Error(`Unexpected LinkedIn channel: ${step.channel}`);
            }

            await prisma.$transaction(async (tx) => {
                const activity = await tx.linkedInActivity.create({
                    data: {
                        activityType: step.channel,
                        leadId: lead.id,
                        providerRef: providerRef ?? null,
                        message: messageSent ?? null,
                        status: "SENT",
                        sentAt: now,
                        ...(qualityFlags && {
                            qualityFlags: qualityFlags as unknown as import("@prisma/client").Prisma.InputJsonValue,
                        }),
                    },
                });

                await tx.leadStepStatus.update({
                    where: { id: status.id },
                    data: {
                        status: "DONE",
                        executedAt: now,
                        linkedInActivityId: activity.id,
                    },
                });
            });

            await scheduleNextStep(lead.id, step.campaignId, step.stepIndex);

            logger.info(
                { leadId: lead.id, stepIndex: step.stepIndex, channel: step.channel },
                "[linkedin.agent] Step done",
            );

            consecutiveErrors = 0;
            processed++;

        } catch (error) {

            if (error instanceof InvitationLimitError) {
                logger.warn({ campaignId }, "[linkedin.agent] Stopping batch due to invitation limit");
                try {
                    await prisma.leadStepStatus.update({
                        where: { id: status.id },
                        data: {
                            status: "SCHEDULED",
                            scheduledAt: new Date(Date.now() + 24 * 60 * 60_000),
                            errorMsg: "LinkedIn invitation limit reached — rescheduled for tomorrow",
                        },
                    });
                } catch (resetErr) {
                    logger.error(
                        { err: resetErr, leadId: lead.id },
                        "[linkedin.agent] Failed to reset lead step status on invitation limit",
                    );
                }
                break;
            }

            const msg = error instanceof Error ? error.message : String(error);
            const providerCode = extractProviderCode(error);

            await prisma.leadStepStatus.update({
                where: { id: status.id },
                data: {
                    status: "FAILED",
                    executedAt: now,
                    errorMsg: msg.slice(0, 500),
                },
            });
            failed++;

            if (LEAD_SPECIFIC_CODES.has(providerCode)) {
                consecutiveErrors = 0;
                logger.warn(
                    { leadId: lead.id, stepId: step.id, providerCode },
                    "[linkedin.agent] Lead-specific failure — continuing batch",
                );
            } else {
                consecutiveErrors++;
                logger.error(
                    {
                        leadId: lead.id,
                        stepId: step.id,
                        providerCode,
                        consecutiveErrors,
                        threshold: MAX_CONSECUTIVE_ERRORS,
                    },
                    "[linkedin.agent] Account-level provider error",
                );

                if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    throw new BatchAbortError(providerCode, consecutiveErrors);
                }
            }
        }

        await liDelay();
    }
    } catch (error) {
        if (error instanceof BatchAbortError) {
            logger.warn(
                {
                    campaignId,
                    consecutiveErrors: error.count,
                    lastCode: error.lastCode,
                    event: "linkedin_circuit_breaker_tripped",
                },
                "[linkedin.agent] Circuit breaker tripped — aborting batch to protect account",
            );
        } else {
            throw error;
        }
    }

    logger.info(
        { campaignId, processed, skipped, failed },
        "[linkedin.agent] Batch complete",
    );
    return { processed, skipped, failed };
}

export async function initializeLeadSequence(
    leadId: string,
    campaignId: string,
): Promise<void> {
    const firstStep = await prisma.sequenceStep.findFirst({
        where: { campaignId, stepIndex: 0 },
        orderBy: { stepIndex: "asc" },
    });
    if (!firstStep) return;

    const scheduledAt = new Date(
        Date.now() + firstStep.delayDays * 24 * 60 * 60_000,
    );

    await prisma.leadStepStatus.upsert({
        where: { stepId_leadId: { stepId: firstStep.id, leadId } },
        create: { stepId: firstStep.id, leadId, status: "SCHEDULED", scheduledAt },
        update: {},
    });

    logger.info(
        { leadId, firstStepChannel: firstStep.channel, scheduledAt },
        "[linkedin.agent] Lead sequence initialised",
    );
}