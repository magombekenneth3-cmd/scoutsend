import { z } from "zod";
import { Prisma, SignalType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { transitionState } from "../../lib/state/transition-state";
import { createOutboxEvent, buildEmailSendIdempotencyKey } from "../outbox/outbox.service";
import {
  createReplySchema,
  updateReplySchema,
  getRepliesQuerySchema,
} from "./repliess.schema";
import { evaluatePolicyWall } from "../conversation/policy/policy-wall";
import {
  classifyReply,
  generateDraftReply,
  generateMeetingRequestDraft,
  resolveOOOReturnDate,
  canAutoSend,
  type ReplyIntent,
} from "../gemini/reply.agent";
import {
  generateObjectionAwareDraftFromContext,
} from "../gemini/objection-handler.agent";
import {
  advanceLeadPipeline,
  markLeadMeetingBooked,
  getPipelineStats,
  getPipelineStatsForUser,
  type PipelineAdvancement,
} from "./pipeline.service";
import { recordWin, recordLoss } from "../memory/memory.service";
import { getBrandSettingsOrDefault } from "../brandSettings/brandsettings.service";
import { renderEmailTemplate } from "../../lib/emailTemplate";
import { AUDIT_EVENTS } from "../../lib/constants";
import { logAudit } from "../audit/audit.service";
import { syncLeadToCrm } from "../crm/crm-sync.service";
import { logger } from "../../lib/logger";
import { createMailProvider, MailboxCredentials } from "../../lib/mail";
import { decryptMailboxCredentials, encryptJson } from "../../lib/mail/crypto";
import { redis } from "../../lib/ioredis";
import { campaignQueue, realtimeQueue } from "../gemini/campaign.queue";
import { logLeadJourneyEvent } from "../../lib/leads/lead-journey.service";
import { recomputeCompanyEngagement } from "../../lib/company/company-engagement.service";
import { buildReplyEmbeddingText, updateReplyEmbedding } from "../../lib/embeddings/embedding.service";
import { triggerCrmHandoff } from "../../lib/crm-handoff.service";
import {
  evaluateConversationAction,
  type ConversationReplyAnalysis,
} from "../../lib/conversation/conversation-state.machine";




const UNSUBSCRIBE_PATTERNS: RegExp[] = [
  /\b(unsubscribe|opt[\s-]?out|remove\s+me)\b/i,
  /(?:^|[\s,!.])stop(?:\s+emailing|\s+contacting|\s+reaching\s+out|\s+sending)?(?:\s+me)?(?:[.!,\s]|$)/i,
  /\bdon'?t\s+(?:email|contact|message|reach\s+out\s+to|follow[\s-]?up\s+(?:with\s+)?me)\b/i,
  /\bdo\s+not\s+(?:email|contact|message|reach\s+out\s+to|follow[\s-]?up\s+(?:with\s+)?me)\b/i,
  /\b(?:take|remove)\s+me\s+(?:off|from)\b/i,
  /\bnot\s+interested[,.]?\s*(?:please\s+)?(?:stop|don'?t|remove|no\s+more|unsubscribe)\b/i,
  /\bno\s+more\s+(?:emails?|messages?|contact)\b/i,
  /\bplease\s+(?:stop|don'?t|remove|no\s+more)\b/i,
];

export function containsOptOutSignal(body: string): boolean {
  return UNSUBSCRIBE_PATTERNS.some((re) => re.test(body));
}
const DEFAULT_INTENT = "UNKNOWN";
const MAX_LIMIT = 100;
const OOO_FALLBACK_RETURN_DAYS = 7;

const SUPPRESSION_INTENTS = new Set<ReplyIntent>([
  "NOT_INTERESTED",
  "NEGATIVE",
]);

const PIPELINE_INTENTS = new Set<ReplyIntent>([
  "POSITIVE",
  "MEETING_REQUEST",
  "QUESTION",
  "NOT_INTERESTED",
  "NEGATIVE",
]);

const FOLLOW_UP_SUPPRESSION_INTENTS = new Set<ReplyIntent>([
  "NOT_INTERESTED",
  "NEGATIVE",
  "POSITIVE",
  "MEETING_REQUEST",
  "QUESTION",
]);

export function extractCleanReplyText(rawBody: string): string {
  if (!rawBody) return "";

  const quotePatterns: RegExp[] = [
    /\r?\n(?=On\s+[A-Za-z]+,\s+[A-Za-z]+\s+\d+.*wrote:)/i,
    /\r?\n(?=On\s+.*?\s+wrote:)/i,
    /\r?\n(?=-----Original Message-----)/i,
    /\r?\n(?=From:\s+.*?\r?\nSent:\s+)/i,
    /\r?\n(?=From:\s+.*?\r?\nDate:\s+)/i,
    /\r?\n(?=_{5,})/i,
    /\r?\n(?=\s*>)/i,
  ];

  let splitIdx = -1;
  for (const pattern of quotePatterns) {
    const match = rawBody.match(pattern);
    if (match && match.index !== undefined) {
      if (splitIdx === -1 || match.index < splitIdx) {
        splitIdx = match.index;
      }
    }
  }

  if (splitIdx !== -1) {
    const replyText = rawBody.slice(0, splitIdx).trim();
    if (replyText) return replyText;
  }

  return rawBody.trim();
}

function normalizeBody(text: string): string {
  const clean = extractCleanReplyText(text);
  return clean.replace(/\s+/g, " ").replace(/[^\w\s]/g, "").toLowerCase();
}

function extractDomain(email: string): string | null {
  const parts = email.split("@");
  return parts.length === 2 && parts[1] ? parts[1].toLowerCase() : null;
}

async function handleUnsubscribeIfNeeded(
  replyBody: string,
  leadEmail: string | null,
  userId: string,
  orgId: string
): Promise<void> {
  if (!leadEmail) return;
  if (!containsOptOutSignal(replyBody)) return;

  const domain = extractDomain(leadEmail);

  await Promise.all([
    prisma.suppression.upsert({
      where: { email_orgId: { email: leadEmail, orgId } },
      update: {},
      create: {
        email: leadEmail,
        userId,
        orgId,
        reason: "Unsubscribe request via reply",
        source: "reply-auto",
      },
    }),
    domain
      ? prisma.suppression.upsert({
        where: { domain_orgId: { domain, orgId } },
        update: {},
        create: {
          domain,
          userId,
          orgId,
          reason: "Unsubscribe request via reply — domain suppressed",
          source: "reply-auto",
        },
      })
      : Promise.resolve(),
  ]);
}

async function suppressPendingFollowUps(
  leadId: string,
  intent?: ReplyIntent,
  tx?: any,
): Promise<void> {
  const client = tx ?? prisma;
  const pendingMessages = await client.outreachMessage.findMany({
    where: {
      leadId,
      deliveryState: { in: ["QUEUED", "DRAFT", "VALIDATED", "AUTHORIZED", "DISPATCHING"] },
    },
    select: { id: true, deliveryState: true, version: true },
  });

  let suppressedCount = 0;
  for (const msg of pendingMessages) {
    const res = await transitionState(client, {
      model: "OutreachMessage",
      entityId: msg.id,
      expectedState: msg.deliveryState,
      expectedVersion: msg.version,
      nextState: "SUPPRESSED",
      authority: { actorType: "SYSTEM", actorId: "reply-suppression" },
    });
    if (res.success) {
      suppressedCount++;
    }
  }

  if (suppressedCount > 0) {
    logger.info(
      { leadId, count: suppressedCount, intent },
      "[reply.service] Suppressed pending messages due to lead reply"
    );
  }
}

async function handleIntentSuppression(
  intent: ReplyIntent,
  leadEmail: string | null,
  userId: string,
  orgId: string
): Promise<void> {
  if (!SUPPRESSION_INTENTS.has(intent) || !leadEmail) return;

  const domain = extractDomain(leadEmail);

  await Promise.all([
    prisma.suppression.upsert({
      where: { email_orgId: { email: leadEmail, orgId } },
      update: {},
      create: {
        email: leadEmail,
        userId,
        orgId,
        reason: `Lead replied with intent: ${intent}`,
        source: "reply-auto",
      },
    }),
    domain
      ? prisma.suppression.upsert({
        where: { domain_orgId: { domain, orgId } },
        update: {},
        create: {
          domain,
          userId,
          orgId,
          reason: `Lead replied with intent: ${intent} — domain suppressed`,
          source: "reply-auto",
        },
      })
      : Promise.resolve(),
  ]);
}

async function notifyPositiveReply(params: {
  intent: ReplyIntent;
  leadId: string;
  leadEmail: string | null;
  leadFirstName: string | null;
  leadLastName?: string | null;
  leadTitle?: string | null;
  leadQualificationScore?: number | null;
  companyName: string;
  replyBody: string;
  replyId: string;
  sentimentScore?: number | null;
  buyingStage?: string | null;
  budgetSignal?: string | null;
  timelineSignal?: string | null;
  campaignId: string;
  campaignName?: string | null;
  outreachSubject: string;
}): Promise<void> {
  const webhookUrl = process.env.REPLY_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "positive_reply",
          intent: params.intent,
          lead: {
            email: params.leadEmail,
            firstName: params.leadFirstName,
            companyName: params.companyName,
          },
          preview: params.replyBody.slice(0, 300),
          campaignId: params.campaignId,
          timestamp: new Date().toISOString(),
        }),
        signal: AbortSignal.timeout(5_000),
      });
    } catch (err) {
      logger.warn({ err }, "[reply.service] positive reply webhook failed");
    }
  }

  await triggerCrmHandoff({
    lead: {
      id: params.leadId,
      firstName: params.leadFirstName,
      lastName: params.leadLastName ?? null,
      email: params.leadEmail,
      companyName: params.companyName,
      title: params.leadTitle ?? null,
      qualificationScore: params.leadQualificationScore ?? null,
    },
    reply: {
      id: params.replyId,
      body: params.replyBody,
      intent: params.intent,
      sentimentScore: params.sentimentScore ?? null,
      buyingStage: params.buyingStage ?? null,
      budgetSignal: params.budgetSignal ?? null,
      timelineSignal: params.timelineSignal ?? null,
    },
    campaign: {
      id: params.campaignId,
      name: params.campaignName ?? null,
    },
    outreachSubject: params.outreachSubject,
  });
}

async function scheduleOOORequeue(
  leadId: string,
  replyBody: string,
  messageId: string
): Promise<void> {
  const returnDate = await resolveOOOReturnDate({ body: replyBody, messageId });
  const retryAt =
    returnDate ?? new Date(Date.now() + OOO_FALLBACK_RETURN_DAYS * 24 * 60 * 60 * 1000);

  const updated = await prisma.outreachMessage.updateMany({
    where: {
      leadId,
      deliveryState: { in: ["QUEUED", "DRAFT"] },
      isFollowUp: true,
      nextRetryAt: null,
    },
    data: { nextRetryAt: retryAt },
  });

  if (updated.count > 0) {
    logger.info(
      { leadId, count: updated.count, retryAt, resolvedFromReply: Boolean(returnDate) },
      "[reply.service] OOO detected — follow-ups rescheduled"
    );
  }
}

async function getLeadThreadHistory(leadId: string): Promise<Array<{ role: "prospect" | "sender"; body: string; sentAt?: string }>> {
  const [messages, replies] = await Promise.all([
    prisma.outreachMessage.findMany({
      where: { leadId, deliveryState: "SENT" },
      select: { body: true, sentAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.reply.findMany({
      where: { leadId },
      select: { body: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
  ]);

  const combined = [
    ...messages.map((m) => ({ role: "sender" as const, body: m.body, createdAt: m.sentAt ?? m.createdAt })),
    ...replies.map((r) => ({ role: "prospect" as const, body: r.body, createdAt: r.createdAt })),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return combined.map((item) => ({
    role: item.role,
    body: item.body,
    sentAt: item.createdAt.toISOString(),
  }));
}

async function recordReplyMemory(params: {
  replyId: string;
  leadId: string;
  companyId: string | null;
  qualificationScoreAtCapture: number | null;
  pipelineStageAtCapture: string | null;
  intent: ReplyIntent;
  sentimentScore: number | null;
  outreachMessage: {
    id: string;
    subject: string;
    body: string;
    leadingSignal: string | null;
  };
  campaign: {
    id: string;
    icpDescription: string;
    targetIndustry: string | null;
    targetRegion: string | null;
  };
  replyBody: string;
}): Promise<void> {
  const {
    replyId,
    leadId,
    companyId,
    qualificationScoreAtCapture,
    pipelineStageAtCapture,
    intent,
    sentimentScore,
    outreachMessage,
    campaign,
    replyBody,
  } = params;

  try {
    if (intent === "POSITIVE" || intent === "MEETING_REQUEST") {
      const signalType = outreachMessage.leadingSignal ?? "UNKNOWN";
      let signalValue = signalType;

      if (signalType !== "UNKNOWN") {
        const sig = await prisma.leadSignal.findFirst({
          where: { leadId, signalType: signalType as SignalType },
          orderBy: { confidence: "desc" },
          select: { value: true },
        });
        if (sig) signalValue = sig.value;
      }

      await recordWin({
        outreachMessageId: outreachMessage.id,
        replyId,
        campaignId: campaign.id,
        icpVertical: campaign.icpDescription?.split(" ").slice(0, 3).join(" "),
        targetIndustry: campaign.targetIndustry ?? undefined,
        targetRegion: campaign.targetRegion ?? undefined,
        subject: outreachMessage.subject,
        body: outreachMessage.body,
        signalType,
        signalValue,
        replyIntent: intent as "POSITIVE" | "MEETING_REQUEST",
        replyBody,
        sentimentScore: sentimentScore ?? undefined,
        leadId,
        companyId: companyId ?? undefined,
        qualificationScoreAtCapture,
        pipelineStageAtCapture,
      });
    } else if (intent === "NOT_INTERESTED" || intent === "NEGATIVE") {
      await recordLoss({
        outreachMessageId: outreachMessage.id,
        replyId,
        campaignId: campaign.id,
        icpVertical: campaign.icpDescription?.split(" ").slice(0, 3).join(" "),
        targetIndustry: campaign.targetIndustry ?? undefined,
        targetRegion: campaign.targetRegion ?? undefined,
        subject: outreachMessage.subject,
        body: outreachMessage.body,
        signalUsed: outreachMessage.leadingSignal ?? undefined,
        replyIntent: intent as "NEGATIVE" | "NOT_INTERESTED",
        replyBody,
        sentimentScore: sentimentScore ?? undefined,
        leadId,
        qualificationScoreAtCapture,
        pipelineStageAtCapture,
      });
    }
  } catch (err) {
    logger.error({ err, replyId }, "[reply.service] recordReplyMemory failed");
  }
}

export async function createReply(
  data: z.infer<typeof createReplySchema>
) {
  const [lead, message] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: data.leadId },
      select: {
        id: true,
        email: true,
        firstName: true,
        companyName: true,
        title: true,
        campaign: {
          select: {
            id: true,
            icpDescription: true,
            targetIndustry: true,
            targetRegion: true,
            createdById: true,
            orgId: true,
          },
        },
      },
    }),
    prisma.outreachMessage.findUnique({
      where: { id: data.outreachMessageId },
      select: { id: true, subject: true, body: true, leadingSignal: true },
    }),
  ]);

  if (!lead) throw new Error("Lead not found");
  if (!message) throw new Error("Outreach message not found");

  const normalizedBody = normalizeBody(data.body);

  const existingReply = await prisma.reply.findFirst({
    where: {
      leadId: data.leadId,
      outreachMessageId: data.outreachMessageId,
      normalizedBody,
    },
    include: {
      lead: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          companyName: true,
          pipelineStage: true,
        },
      },
      outreachMessage: {
        select: { id: true, subject: true, deliveryState: true },
      },
    },
  });

  if (existingReply) return existingReply;

  const reply = await prisma.$transaction(async (tx) => {
    const createdReply = await tx.reply.create({
      data: {
        ...data,
        intent: data.intent ?? DEFAULT_INTENT,
        sentimentScore: data.sentimentScore ?? null,
        confidence: data.confidence ?? null,
        requiresHumanReview: data.requiresHumanReview ?? true,
        normalizedBody,
      },
      include: {
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            companyName: true,
            pipelineStage: true,
          },
        },
        outreachMessage: {
          select: { id: true, subject: true, deliveryState: true },
        },
      },
    });

    await tx.outreachMessage.update({
      where: { id: data.outreachMessageId },
      data: { deliveryState: "REPLIED", repliedAt: new Date() },
    });

    return createdReply;
  });

  await Promise.all([
    handleUnsubscribeIfNeeded(data.body, lead.email, lead.campaign.createdById, lead.campaign.orgId ?? ""),
    suppressPendingFollowUps(lead.id),
  ]).catch((err) =>
    logger.error({ err, replyId: reply.id }, "[reply.service] handleUnsubscribeIfNeeded / suppressPendingFollowUps failed")
  );

  await realtimeQueue.add(
    "process-reply-ai",
    { replyId: reply.id },
    {
      jobId: `process-reply-ai-${reply.id}`,
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { age: 300 },
      removeOnFail: { age: 3600 },
    }
  );

  return reply;
}

export async function processReplyAI(replyId: string): Promise<void> {
  const reply = await prisma.reply.findUnique({
    where: { id: replyId },
    select: {
      id: true,
      body: true,
      leadId: true,
      outreachMessageId: true,
      intent: true,
      classifiedAt: true,
      sentimentScore: true,
      confidence: true,
      requiresHumanReview: true,
      draftBody: true,
      draftIntent: true,
      oooRequeuedAt: true,
      lead: {
        select: {
          id: true,
          email: true,
          firstName: true,
          companyName: true,
          title: true,
          companyId: true,
          qualificationScore: true,
          pipelineStage: true,
          campaign: {
            select: {
              id: true,
              icpDescription: true,
              targetIndustry: true,
              targetRegion: true,
              createdById: true,
              senderMailboxId: true,
              orgId: true,
            },
          },
        },
      },
      outreachMessage: {
        select: { id: true, subject: true, body: true, leadingSignal: true },
      },
    },
  });

  if (!reply) {
    logger.warn({ replyId }, "[reply.service] processReplyAI: reply not found");
    return;
  }

  const alreadyClassified = reply.classifiedAt !== null;

  let resolvedIntent: ReplyIntent = reply.intent as ReplyIntent;
  let sentimentScore = reply.sentimentScore;
  let confidence = reply.confidence;
  let requiresHumanReview = reply.requiresHumanReview;
  let buyingStage: string | null = null;
  let painPoints: string[] = [];
  let competitorsMentioned: string[] = [];
  let budgetSignal: string | null = null;
  let timelineSignal: string | null = null;

  if (!alreadyClassified) {
    try {
      const cleanReplyBody = extractCleanReplyText(reply.body);
      const policyDecision = evaluatePolicyWall(cleanReplyBody || reply.body);

      if (policyDecision.action !== "CONTINUE_TO_CLASSIFIER") {
        logger.info(
          { replyId, action: policyDecision.action, matchedRules: policyDecision.matchedRules },
          "[reply.service] Deterministic policy wall triggered — bypassing LLM classifier with 0 LLM calls"
        );
        if (policyDecision.action === "OPT_OUT") {
          resolvedIntent = "NOT_INTERESTED";
        } else if (policyDecision.action === "COMPLAINT") {
          resolvedIntent = "NEGATIVE";
        } else if (policyDecision.action === "SNOOZE") {
          resolvedIntent = "OUT_OF_OFFICE";
        }
        confidence = 1.0;
        sentimentScore = policyDecision.action === "OPT_OUT" || policyDecision.action === "COMPLAINT" ? -1.0 : 0.0;
        requiresHumanReview = false;
      } else {
        const threadHistory = await getLeadThreadHistory(reply.leadId);
        const classification = await classifyReply({
          replyBody: cleanReplyBody || reply.body,
          originalSubject: reply.outreachMessage.subject,
          originalBody: reply.outreachMessage.body,
          leadFirstName: reply.lead.firstName ?? undefined,
          companyName: reply.lead.companyName,
          messageId: reply.outreachMessage.id,
          threadHistory,
        });

        resolvedIntent = classification.intent;
        sentimentScore = classification.sentimentScore;
        confidence = classification.confidence;
        requiresHumanReview = classification.requiresHumanReview;
        buyingStage = classification.buyingStage;
        painPoints = classification.painPoints;
        competitorsMentioned = classification.competitorsMentioned;
        budgetSignal = classification.budgetSignal;
        timelineSignal = classification.timelineSignal;
      }

      const replyAnalysis: ConversationReplyAnalysis = {
        intents: [{ type: resolvedIntent as ConversationReplyAnalysis["intents"][0]["type"], confidence: confidence ?? 0.5 }],
        questions: [],
        temporalConstraints: resolvedIntent === "OUT_OF_OFFICE" && timelineSignal
          ? [{ rawText: timelineSignal, targetDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }]
          : [],
        sentiment: sentimentScore ?? 0,
        confidence: confidence ?? 0.5,
        requiresHumanReview: requiresHumanReview ?? false,
      };

      const conversationAction = evaluateConversationAction(replyAnalysis, reply.leadId);

      logger.info(
        { replyId, leadId: reply.leadId, conversationAction: conversationAction.type },
        "[reply.service] Conversation action evaluated",
      );

      if (conversationAction.type === "STOP_SEQUENCE") {
        await Promise.allSettled([
          suppressPendingFollowUps(reply.leadId, resolvedIntent),
          handleUnsubscribeIfNeeded(reply.body, reply.lead.email, reply.lead.campaign.createdById, reply.lead.campaign.orgId ?? ""),
        ]);
        requiresHumanReview = false;
      } else if (conversationAction.type === "SNOOZE_UNTIL") {
        logger.info(
          { replyId, leadId: reply.leadId, resumeAt: conversationAction.resumeAt },
          "[reply.service] Conversation SNOOZE_UNTIL — suppressing pending follow-ups",
        );
        await suppressPendingFollowUps(reply.leadId, resolvedIntent).catch((err) =>
          logger.error({ err, replyId }, "[reply.service] suppressPendingFollowUps failed on snooze")
        );
      } else if (conversationAction.type === "BOOK_MEETING") {
        await markLeadMeetingBooked({
          leadId: reply.leadId,
          replyId: reply.id,
          campaignId: reply.lead.campaign.id,
          auditUserId: reply.lead.campaign.createdById,
        }).catch((err) =>
          logger.error({ err, replyId }, "[reply.service] markLeadMeetingBooked failed")
        );
        requiresHumanReview = true;
      } else if (conversationAction.type === "HUMAN_REVIEW") {
        requiresHumanReview = true;
      }

      logger.info(
        { replyId, intent: resolvedIntent, sentimentScore, confidence, requiresHumanReview },
        "[reply.classifier] classified"
      );
    } catch (err) {
      logger.error({ err, replyId }, "[reply.classifier] classification failed — defaulting to UNKNOWN");
      resolvedIntent = DEFAULT_INTENT as ReplyIntent;
      requiresHumanReview = true;
    }

    await prisma.reply.update({
      where: { id: replyId },
      data: {
        intent: resolvedIntent,
        sentimentScore,
        confidence,
        requiresHumanReview,
        classifiedAt: new Date(),
        buyingStage,
        painPoints: painPoints as unknown as Prisma.InputJsonValue,
        competitorsMentioned: competitorsMentioned as unknown as Prisma.InputJsonValue,
        budgetSignal,
        timelineSignal,
      },
    });

    const embeddingText = buildReplyEmbeddingText({
      body: reply.body,
      intent: resolvedIntent,
      buyingStage,
      painPoints,
      budgetSignal,
      timelineSignal,
    });
    await updateReplyEmbedding(replyId, embeddingText);
  }


  if (!alreadyClassified) {
    const postProcessingSteps: Promise<unknown>[] = [
      suppressPendingFollowUps(reply.leadId, resolvedIntent),
      handleIntentSuppression(resolvedIntent, reply.lead.email, reply.lead.campaign.createdById, reply.lead.campaign.orgId ?? ""),
    ];

    if (resolvedIntent === "OUT_OF_OFFICE" && reply.oooRequeuedAt === null) {
      postProcessingSteps.push(
        scheduleOOORequeue(reply.leadId, reply.body, reply.outreachMessage.id).then(() =>
          prisma.reply.update({ where: { id: replyId }, data: { oooRequeuedAt: new Date() } })
        )
      );
    }

    if (resolvedIntent === "POSITIVE" || resolvedIntent === "MEETING_REQUEST") {
      if (reply.lead.campaign.orgId) {
        postProcessingSteps.push(
          syncLeadToCrm({
            orgId: reply.lead.campaign.orgId,
            leadId: reply.lead.id,
            replyId: reply.id,
            intent: resolvedIntent,
            eventType: resolvedIntent === "MEETING_REQUEST" ? "MEETING_REQUEST" : "POSITIVE_REPLY",
          })
        );
      }
      postProcessingSteps.push(
        notifyPositiveReply({
          intent: resolvedIntent,
          leadId: reply.lead.id,
          leadEmail: reply.lead.email,
          leadFirstName: reply.lead.firstName,
          leadTitle: reply.lead.title,
          leadQualificationScore: reply.lead.qualificationScore,
          companyName: reply.lead.companyName,
          replyBody: reply.body,
          replyId: reply.id,
          sentimentScore,
          buyingStage,
          budgetSignal,
          timelineSignal,
          campaignId: reply.lead.campaign.id,
          outreachSubject: reply.outreachMessage.subject,
        })
      );
    }

    if (PIPELINE_INTENTS.has(resolvedIntent)) {
      postProcessingSteps.push(
        advanceLeadPipeline({
          leadId: reply.leadId,
          intent: resolvedIntent,
          replyId,
          campaignId: reply.lead.campaign.id,
        })
      );
    }

    postProcessingSteps.push(
      logLeadJourneyEvent({
        leadId: reply.leadId,
        eventType: "REPLY_RECEIVED",
        outreachMessageId: reply.outreachMessage.id,
        metadata: {
          intent: resolvedIntent,
          sentimentScore,
          buyingStage,
          painPoints,
          competitorsMentioned,
          budgetSignal,
          timelineSignal,
        },
      })
    );

    postProcessingSteps.push(recomputeCompanyEngagement(reply.lead.companyId));

    postProcessingSteps.push(
      recordReplyMemory({
        replyId,
        leadId: reply.leadId,
        companyId: reply.lead.companyId,
        qualificationScoreAtCapture: reply.lead.qualificationScore,
        pipelineStageAtCapture: reply.lead.pipelineStage,
        intent: resolvedIntent,
        sentimentScore: sentimentScore ?? null,
        outreachMessage: {
          id: reply.outreachMessage.id,
          subject: reply.outreachMessage.subject,
          body: reply.outreachMessage.body,
          leadingSignal: reply.outreachMessage.leadingSignal,
        },
        campaign: reply.lead.campaign,
        replyBody: reply.body,
      })
    );

    const postProcessing = await Promise.allSettled(postProcessingSteps);

    for (const result of postProcessing) {
      if (result.status === "rejected") {
        logger.error({ error: result.reason, replyId }, "[reply.service] post-processing step failed");
      }
    }
  }

  // Fix 12: Enqueue draft generation as a separate BullMQ job so that the slow
  // Gemini LLM calls don't block the classification worker concurrency slot.
  if (resolvedIntent !== "UNKNOWN" && resolvedIntent !== "NOT_INTERESTED" && resolvedIntent !== "NEGATIVE" && resolvedIntent !== "OUT_OF_OFFICE") {
    const draftStale = reply.draftBody !== null && reply.draftIntent !== resolvedIntent;
    const needsDraft = reply.draftBody === null || draftStale;
    if (needsDraft) {
      await realtimeQueue.add(
        "generate-reply-draft",
        { replyId },
        {
          jobId: `generate-reply-draft-${replyId}`,
          attempts: 3,
          backoff: { type: "exponential", delay: 10_000 },
          removeOnComplete: { age: 300 },
          removeOnFail: { age: 3600 },
        }
      );
      logger.info({ replyId, intent: resolvedIntent }, "[reply.service] Enqueued generate-reply-draft job");
    }
  }
}

/**
 * Fix 12: Generates and saves an AI draft reply for the given replyId.
 * Extracted from processReplyAI so it runs in its own BullMQ job
 * ('generate-reply-draft'), keeping the classification worker slot free.
 */
export async function generateReplyDraft(replyId: string): Promise<{ replyId: string; draftGenerated: boolean }> {
  try {
    const reply = await prisma.reply.findUnique({
      where: { id: replyId },
      select: {
        id: true,
        body: true,
        intent: true,
        draftBody: true,
        draftIntent: true,
        requiresHumanReview: true,
        confidence: true,
        lead: {
          select: {
            id: true,
            firstName: true,
            companyName: true,
            title: true,
            campaign: {
              select: {
                id: true,
                createdById: true,
                senderMailboxId: true,
                autoSendRepliesEnabled: true,
              },
            },
          },
        },
        outreachMessage: {
          select: { id: true, subject: true, body: true },
        },
      },
    });

    if (!reply) {
      logger.warn({ replyId }, "[reply.drafter] generateReplyDraft: reply not found");
      return { replyId, draftGenerated: false };
    }

    const resolvedIntent = reply.intent as ReplyIntent;
    let draftSubject: string | null = null;
    let draftBody: string | null = null;
    let objectionCategory: string | null = null;
    let meetingLinkInjected = false;
    let requiresHumanReview = reply.requiresHumanReview;

    const threadHistory = await getLeadThreadHistory(reply.lead.id);

    if (resolvedIntent === "MEETING_REQUEST") {
      try {
        let senderName: string | undefined;
        try {
          const brand = await getBrandSettingsOrDefault(reply.lead.campaign.createdById);
          senderName = brand.senderName;
        } catch { }

        const meetingDraft = await generateMeetingRequestDraft({
          replyBody: reply.body,
          originalSubject: reply.outreachMessage.subject,
          leadFirstName: reply.lead.firstName ?? undefined,
          companyName: reply.lead.companyName,
          messageId: reply.outreachMessage.id,
          senderName,
          mailboxId: reply.lead.campaign.senderMailboxId ?? undefined,
          threadHistory,
        });
        draftSubject = meetingDraft.subject;
        draftBody = meetingDraft.body;
        meetingLinkInjected = meetingDraft.meetingLinkInjected;
        logger.info(
          { replyId, meetingLinkInjected },
          "[reply.drafter] Meeting request draft generated"
        );
      } catch (err) {
        logger.warn({ err, replyId }, "[reply.drafter] Meeting draft generation failed — skipping");
      }
    } else if (resolvedIntent === "POSITIVE" || resolvedIntent === "QUESTION") {
      try {
        const objectionDraft = await generateObjectionAwareDraftFromContext({
          replyBody: reply.body,
          intent: resolvedIntent,
          originalSubject: reply.outreachMessage.subject,
          originalBody: reply.outreachMessage.body,
          leadFirstName: reply.lead.firstName ?? undefined,
          companyName: reply.lead.companyName,
          title: reply.lead.title ?? undefined,
          messageId: reply.outreachMessage.id,
          confidence: reply.confidence ?? 0,
          threadHistory,
        });
        draftSubject = objectionDraft.subject;
        draftBody = objectionDraft.body;
        objectionCategory = objectionDraft.objectionCategory;
        if (objectionDraft.requiresHumanReview) {
          requiresHumanReview = true;
        }
      } catch {
        const fallbackDraft = await generateDraftReply({
          intent: resolvedIntent as "POSITIVE" | "QUESTION",
          replyBody: reply.body,
          originalSubject: reply.outreachMessage.subject,
          leadFirstName: reply.lead.firstName ?? undefined,
          companyName: reply.lead.companyName,
          messageId: reply.outreachMessage.id,
          threadHistory,
        });
        if (fallbackDraft) {
          draftSubject = fallbackDraft.subject;
          draftBody = fallbackDraft.body;
        }
      }
    }

    if (draftSubject !== null || draftBody !== null || meetingLinkInjected) {

      if (draftBody !== null) {
        let bookingLink: string | null = null;
        try {
          const brand = await getBrandSettingsOrDefault(reply.lead.campaign.createdById);
          bookingLink = brand.website ?? null;
        } catch { }

        const allowedLinks: string[] = [
          ...(bookingLink ? [bookingLink] : []),
          ...(process.env.CALENDLY_URL ? [process.env.CALENDLY_URL.trim()] : []),
        ];

        const gate = await canAutoSend({
          leadId: reply.lead.id,
          campaign: { autoSendRepliesEnabled: reply.lead.campaign.autoSendRepliesEnabled },
          intent: resolvedIntent,
          confidence: reply.confidence ?? 0,
          draftBody,
          allowedLinks,
        });


        requiresHumanReview = !gate.ok;

        await prisma.reply.update({
          where: { id: replyId },
          data: {
            ...(draftSubject !== null && { draftSubject }),
            ...(draftBody !== null && { draftBody }),
            ...(objectionCategory !== null && { objectionCategory }),
            meetingLinkInjected,
            draftIntent: resolvedIntent,
            requiresHumanReview,
          },
        });

        if (gate.ok) {
          try {
            await sendReplyDraft(replyId, reply.lead.campaign.createdById);
            logAudit({
              userId: reply.lead.campaign.createdById,
              action: AUDIT_EVENTS.REPLY_DRAFT_SENT,
              entityType: "Reply",
              entityId: replyId,
              metadata: { auto: true, intent: resolvedIntent, confidence: reply.confidence },
            }).catch(() => { });
            logger.info(
              { replyId, confidence: reply.confidence, intent: resolvedIntent },
              "[reply.drafter] Draft auto-sent"
            );
          } catch (err) {
            logger.warn({ err, replyId }, "[reply.drafter] Auto-send failed — flagging for manual review");
            await prisma.reply
              .update({ where: { id: replyId }, data: { requiresHumanReview: true } })
              .catch(() => { });
          }
        } else {
          logAudit({
            userId: reply.lead.campaign.createdById,
            action: AUDIT_EVENTS.AUTO_SEND_BLOCKED,
            entityType: "Reply",
            entityId: replyId,
            metadata: { reason: gate.reason, intent: resolvedIntent, confidence: reply.confidence },
          }).catch(() => { });
          logger.info({ replyId, reason: gate.reason }, "[reply.drafter] Auto-send skipped");
        }

      } else {
        await prisma.reply.update({
          where: { id: replyId },
          data: {
            ...(draftSubject !== null && { draftSubject }),
            ...(objectionCategory !== null && { objectionCategory }),
            meetingLinkInjected,
            draftIntent: resolvedIntent,
          },
        });
      }
    }

    return { replyId, draftGenerated: draftBody !== null };
  } catch (err) {
    logger.warn({ err, replyId }, "[reply.drafter] generateReplyDraft failed");
    throw err;
  }
}

export async function sendReplyDraft(
  replyId: string,
  sentByUserId: string
): Promise<{ success: true; externalId: string | undefined }> {
  const reply = await prisma.reply.findUnique({
    where: { id: replyId },
    include: {
      lead: {
        select: {
          id: true,
          email: true,
          firstName: true,
          companyName: true,
          campaign: {
            select: {
              id: true,
              orgId: true,
              createdById: true,
              senderMailbox: {
                select: {
                  id: true,
                  emailAddress: true,
                  credentials: true,
                  health: true,
                },
              },
              senderDomain: {
                select: { domain: true, health: true },
              },
            },
          },
        },
      },
      outreachMessage: {
        select: { id: true, subject: true },
      },
    },
  });

  if (!reply) throw Object.assign(new Error("Reply not found"), { statusCode: 404 });

  if (!reply.draftSubject || !reply.draftBody) {
    throw Object.assign(
      new Error("No draft available for this reply"),
      { statusCode: 422 }
    );
  }

  if (reply.draftSentAt) {
    throw Object.assign(
      new Error("Draft has already been sent"),
      { statusCode: 409 }
    );
  }

  const leadEmail = reply.lead.email;
  if (!leadEmail) {
    throw Object.assign(
      new Error("Lead has no email address"),
      { statusCode: 422 }
    );
  }

  const { senderMailbox, senderDomain, createdById } = reply.lead.campaign;

  const suppressed = await prisma.suppression.findFirst({
    where: {
      userId: createdById,
      OR: [
        { email: leadEmail },
        { domain: leadEmail.split("@")[1] },
      ],
    },
    select: { id: true },
  });

  if (suppressed) {
    throw Object.assign(
      new Error("Lead email is suppressed — draft cannot be sent"),
      { statusCode: 422 }
    );
  }

  if (!senderMailbox && !senderDomain) {
    throw Object.assign(
      new Error("Campaign has no sender mailbox or domain configured"),
      { statusCode: 422 }
    );
  }

  if (senderMailbox && senderMailbox.health === "BLOCKED") {
    throw Object.assign(
      new Error("Sender mailbox is blocked — draft cannot be sent"),
      { statusCode: 422 }
    );
  }

  if (!senderMailbox && senderDomain?.health === "BLOCKED") {
    throw Object.assign(
      new Error("Sender domain is blocked — draft cannot be sent"),
      { statusCode: 422 }
    );
  }

  const brand = await getBrandSettingsOrDefault(createdById);

  const { html, text } = renderEmailTemplate(brand, {
    subject: reply.draftSubject,
    greeting: `Hi ${reply.lead.firstName ?? "there"},`,
    opening: "",
    body: reply.draftBody,
    ctaText: "",
    closing: `Best,\n${brand.senderName}`,
  });

  if (!senderMailbox) {
    throw Object.assign(
      new Error("No sender mailbox configured — legacy domain-only path not supported for reply drafts"),
      { statusCode: 422 }
    );
  }

  const from = `${brand.senderName} <${senderMailbox.emailAddress}>`;

  const creds = decryptMailboxCredentials<MailboxCredentials>(senderMailbox.credentials, `mailbox:${senderMailbox.id}`);
  const mailboxId = senderMailbox.id;
  const provider = createMailProvider(creds, {
    outlook:
      creds.type === "OUTLOOK"
        ? {
          mailboxId,
          redis,
          onTokenRotation: async (refreshToken) => {
            await prisma.senderMailbox.update({
              where: { id: mailboxId },
              data: {
                credentials: encryptJson({
                  ...creds,
                  refreshToken,
                }),
              },
            });
          },
        }
        : undefined,
  });
  // Enqueue via Transactional Outbox — Atomically commit draft state & OutboxEvent
  await prisma.$transaction(async (tx) => {
    await tx.reply.update({
      where: { id: replyId },
      data: {
        draftSentAt: new Date(),
        draftSentBy: sentByUserId,
      },
    });

    await tx.senderMailbox.update({
      where: { id: senderMailbox.id },
      data: {
        currentSent: { increment: 1 },
        totalSent: { increment: 1 },
      },
    });

    await createOutboxEvent(tx, {
      organizationId: reply.lead.campaign.orgId ?? "org_default",
      eventType: "EMAIL_SEND_REQUESTED",
      aggregateType: "Reply",
      aggregateId: replyId,
      idempotencyKey: buildEmailSendIdempotencyKey(`reply:${replyId}`),
      payload: {
        outreachMessageId: `reply:${replyId}`,
        leadId: reply.lead.email ? reply.lead.email : reply.lead.id,
        campaignId: reply.lead.campaign.id,
        senderMailboxId: senderMailbox.id,
      },
    });
  });

  if (reply.intent === "MEETING_REQUEST") {
    advanceLeadPipeline({
      leadId: reply.lead.id,
      intent: "MEETING_REQUEST",
      replyId,
      campaignId: reply.lead.campaign.id,
      auditUserId: sentByUserId,
    }).catch((err) =>
      logger.error({ err }, "[reply.service] post-send pipeline advance failed")
    );
  }

  await logAudit({
    userId: sentByUserId,
    action: AUDIT_EVENTS.REPLY_DRAFT_SENT,
    entityType: "Reply",
    entityId: replyId,
    metadata: {
      leadEmail,
      meetingLinkInjected: reply.meetingLinkInjected,
      objectionCategory: reply.objectionCategory,
    },
  });

  logger.info(
    { replyId, leadEmail, sentByUserId },
    "[reply.service] Draft reply queued for delivery via transactional outbox"
  );

  return { success: true, externalId: undefined };
}

export async function markMeetingBooked(params: {
  replyId: string;
  userId: string;
  notes?: string;
}): Promise<{ success: true; advancement: PipelineAdvancement }> {
  const { replyId, userId, notes } = params;

  const reply = await prisma.reply.findUnique({
    where: { id: replyId },
    select: {
      id: true,
      leadId: true,
      lead: { select: { campaignId: true } },
    },
  });

  if (!reply) throw Object.assign(new Error("Reply not found"), { statusCode: 404 });

  const advancement = await markLeadMeetingBooked({
    leadId: reply.leadId,
    replyId,
    campaignId: reply.lead.campaignId,
    auditUserId: userId,
    notes,
  });

  return { success: true, advancement };
}

export async function getRepliesUnsafeAdmin(
  query: z.infer<typeof getRepliesQuerySchema>
) {
  const { leadId, outreachMessageId, intent, requiresHumanReview, page, limit } = query;
  const safeLimit = Math.min(limit, MAX_LIMIT);
  const skip = (page - 1) * safeLimit;
  const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];

  const where: Prisma.ReplyWhereInput = {
    ...(leadId && { leadId }),
    ...(outreachMessageId && { outreachMessageId }),
    ...(intent && { intent }),
    ...(requiresHumanReview !== undefined && { requiresHumanReview }),
  };

  const [total, pageIds] = await Promise.all([
    prisma.reply.count({ where }),
    prisma.reply.findMany({ where, select: { id: true }, orderBy, skip, take: safeLimit }),
  ]);

  if (pageIds.length === 0) {
    return {
      data: [],
      meta: { total, page, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) },
    };
  }

  const replies = await prisma.reply.findMany({
    where: { id: { in: pageIds.map((r: { id: string }) => r.id) } },
    orderBy,
    include: {
      lead: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          companyName: true,
          pipelineStage: true,
        },
      },
      outreachMessage: {
        select: { id: true, subject: true, deliveryState: true },
      },
    },
  });

  return {
    data: replies,
    meta: { total, page, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) },
  };
}

export async function getReplyById(id: string) {
  return prisma.reply.findUnique({
    where: { id },
    include: {
      lead: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          companyName: true,
          pipelineStage: true,
          pipelineStageUpdatedAt: true,
        },
      },
      outreachMessage: {
        select: {
          id: true,
          subject: true,
          body: true,
          deliveryState: true,
          lead: { select: { campaignId: true } },
        },
      },
    },
  });
}

export async function updateReply(
  id: string,
  userId: string,
  data: z.infer<typeof updateReplySchema>
) {
  const existing = await prisma.reply.findFirst({
    where: {
      id,
      lead: { campaign: { createdById: userId } },
    },
    select: {
      id: true,
      intent: true,
      leadId: true,
      lead: {
        select: {
          id: true,
          email: true,
          campaign: {
            select: { id: true, orgId: true }
          }
        }
      }
    },
  });

  if (!existing) {
    throw Object.assign(new Error("Reply not found or access denied"), { statusCode: 404 });
  }
  const updated = await prisma.reply.update({
    where: { id },
    data,
    include: {
      lead: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          companyName: true,
          pipelineStage: true,
        },
      },
      outreachMessage: {
        select: { id: true, subject: true, deliveryState: true },
      },
    },
  });

  if (data.intent && data.intent !== existing.intent) {
    const newIntent = data.intent as ReplyIntent;
    await suppressPendingFollowUps(existing.leadId, newIntent);
    await handleIntentSuppression(newIntent, existing.lead.email, userId, existing.lead.campaign.orgId ?? "");
    if (PIPELINE_INTENTS.has(newIntent)) {
      await advanceLeadPipeline({
        leadId: existing.leadId,
        intent: newIntent,
        replyId: id,
        campaignId: existing.lead.campaign.id,
        auditUserId: userId,
      });
    }
  }

  return updated;
}

export async function getRepliesForUser(
  userId: string,
  query: z.infer<typeof getRepliesQuerySchema>
) {
  const { leadId, outreachMessageId, intent, requiresHumanReview, page, limit } = query;
  const safeLimit = Math.min(limit, MAX_LIMIT);
  const skip = (page - 1) * safeLimit;
  const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];

  const where: Prisma.ReplyWhereInput = {
    lead: { campaign: { createdById: userId } },
    ...(leadId && { leadId }),
    ...(outreachMessageId && { outreachMessageId }),
    ...(intent && { intent }),
    ...(requiresHumanReview !== undefined && { requiresHumanReview }),
  };

  const [total, pageIds] = await Promise.all([
    prisma.reply.count({ where }),
    prisma.reply.findMany({ where, select: { id: true }, orderBy, skip, take: safeLimit }),
  ]);

  if (pageIds.length === 0) {
    return {
      data: [],
      meta: { total, page, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) },
    };
  }

  const replies = await prisma.reply.findMany({
    where: { id: { in: pageIds.map((r: { id: string }) => r.id) } },
    orderBy,
    include: {
      lead: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          companyName: true,
          pipelineStage: true,
        },
      },
      outreachMessage: {
        select: { id: true, subject: true, deliveryState: true },
      },
    },
  });

  return {
    data: replies,
    meta: { total, page, limit: safeLimit, totalPages: Math.ceil(total / safeLimit) },
  };
}

export async function getReplyCountsForUser(userId: string): Promise<Record<string, number>> {
  const [grouped, needsReview] = await Promise.all([
    prisma.reply.groupBy({
      by: ["intent"],
      where: { lead: { campaign: { createdById: userId } } },
      _count: { id: true },
    }),
    prisma.reply.count({
      where: { lead: { campaign: { createdById: userId } }, requiresHumanReview: true },
    }),
  ]);

  const counts: Record<string, number> = { ALL: 0, NEEDS_REVIEW: needsReview };
  let total = 0;
  for (const row of grouped) {
    counts[row.intent] = row._count.id;
    total += row._count.id;
  }
  counts.ALL = total;
  return counts;
}

export { getPipelineStats, getPipelineStatsForUser };