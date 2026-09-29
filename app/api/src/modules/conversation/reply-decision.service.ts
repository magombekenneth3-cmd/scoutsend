/**
 * Sprint 7 — Conversation Reply Decision & Execution Service
 *
 * ARCHITECTURAL INVARIANT:
 * Policy decides safety. Gemini interprets ambiguous intent.
 * Execution services decide and persist. Gemini never persists.
 *
 * Execution flow:
 * 1. Load authoritative state from Prisma.
 * 2. Run deterministic policy wall (evaluatePolicyWall).
 * 3. If decisive (OPT_OUT | COMPLAINT | SNOOZE):
 *    - 0 LLM / Gateway calls.
 *    - Execute deterministic action (suppression, snooze, state updates).
 * 4. If ambiguous (CONTINUE_TO_CLASSIFIER):
 *    - Construct canonical context bundle & context hash.
 *    - Call classifyReplyProposal (uses callGateway<T>()).
 *    - Reload authoritative DB state & recompute context hash.
 *    - Enforce TOCTOU check (throw GatewayContextMismatchError on mismatch, 0 writes).
 *    - Compute 60/40 hybrid score & temporal signal decay.
 *    - Persist results and trigger downstream side-effects.
 */

import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { evaluatePolicyWall, PolicyDecision } from "./policy/policy-wall";
import {
  classifyReplyProposal,
  ReplyIntentProposalPayload,
} from "../gemini/classify-reply.agent";
import { executeProposalOnce } from "../proposal-execution/proposal-execution.service";
import { createContextHash } from "../../lib/llm-gateway/context-hash";
import { GatewayContextMismatchError } from "../../lib/llm-gateway/gateway-errors";
import { calculateHybridScore } from "./scoring/hybrid-scoring";
import { ReplyIntent } from "../../lib/reply/replyTypes";
import {
  createOutboxEvent,
  buildReplyClassifiedIdempotencyKey,
  buildCrmSyncIdempotencyKey,
} from "../outbox/outbox.service";

export interface ReplyDecisionResult {
  readonly replyId: string;
  readonly policyDecision: PolicyDecision;
  readonly proposal?: ReplyIntentProposalPayload;
  readonly hybridScore?: number;
  readonly executedAction: string;
  readonly isIdempotentReplay?: boolean;
}

export async function evaluateReplyDecision(replyId: string): Promise<ReplyDecisionResult> {
  const reply = await prisma.reply.findUnique({
    where: { id: replyId },
    select: {
      id: true,
      body: true,
      leadId: true,
      outreachMessageId: true,
      classifiedAt: true,
      lead: {
        select: {
          id: true,
          email: true,
          firstName: true,
          companyName: true,
          qualificationScore: true,
          campaign: {
            select: {
              id: true,
              orgId: true,
              createdById: true,
            },
          },
        },
      },
      outreachMessage: {
        select: {
          id: true,
          subject: true,
          body: true,
        },
      },
    },
  });

  if (!reply) {
    throw new Error(`[reply-decision.service] Reply not found: ${replyId}`);
  }

  // 1. Run Deterministic Policy Wall (Guaranteed 0 LLM calls if decisive)
  const policyDecision = evaluatePolicyWall(reply.body);

  if (policyDecision.action !== "CONTINUE_TO_CLASSIFIER") {
    logger.info(
      { replyId, action: policyDecision.action, matchedRules: policyDecision.matchedRules },
      "[reply-decision.service] Deterministic policy wall triggered — skipping LLM classification",
    );

    let resolvedIntent: ReplyIntent = "UNKNOWN";
    if (policyDecision.action === "OPT_OUT") {
      resolvedIntent = "NOT_INTERESTED";
    } else if (policyDecision.action === "COMPLAINT") {
      resolvedIntent = "NEGATIVE";
    } else if (policyDecision.action === "SNOOZE") {
      resolvedIntent = "OUT_OF_OFFICE";
    }

    // Execute deterministic state mutations
    await prisma.$transaction(async (tx) => {
      await tx.reply.update({
        where: { id: replyId },
        data: {
          intent: resolvedIntent,
          confidence: 1.0,
          requiresHumanReview: false,
          classifiedAt: new Date(),
        },
      });

      await tx.outreachMessage.updateMany({
        where: {
          leadId: reply.leadId,
          deliveryState: { in: ["QUEUED", "DRAFT", "SENDING"] },
        },
        data: {
          deliveryState: "SUPPRESSED",
          lastError: `DETERMINISTIC_POLICY_${policyDecision.action}`,
        },
      });

      if ((policyDecision.action === "OPT_OUT" || policyDecision.action === "COMPLAINT") && reply.lead.email) {
        await tx.suppression.upsert({
          where: {
            email_orgId: {
              email: reply.lead.email,
              orgId: reply.lead.campaign.orgId ?? "",
            },
          },
          update: {},
          create: {
            email: reply.lead.email,
            userId: reply.lead.campaign.createdById,
            orgId: reply.lead.campaign.orgId ?? "",
            reason: `Deterministic policy: ${policyDecision.action}`,
            source: "policy-wall-deterministic",
          },
        });
      }
    });

    return {
      replyId,
      policyDecision,
      executedAction: `DETERMINISTIC_${policyDecision.action}`,
    };
  }

  // 2. Ambiguous Reply — Prepare Canonical Context Bundle
  const contextBundle = {
    messageId: reply.outreachMessageId,
    replyBody: reply.body,
    originalSubject: reply.outreachMessage.subject,
    originalBody: reply.outreachMessage.body,
    leadFirstName: reply.lead.firstName ?? null,
    companyName: reply.lead.companyName ?? null,
    tenantId: reply.lead.campaign.orgId ?? null,
  };

  const contextHash = createContextHash(contextBundle);

  // 3. Call Pure Gemini Classifier (Returns AgentProposal<T>)
  const proposal = await classifyReplyProposal({
    replyBody: reply.body,
    originalSubject: reply.outreachMessage.subject,
    originalBody: reply.outreachMessage.body,
    leadFirstName: reply.lead.firstName ?? undefined,
    companyName: reply.lead.companyName ?? undefined,
    messageId: reply.outreachMessageId,
    tenantId: reply.lead.campaign.orgId ?? undefined,
  });

  // 4. Execute Proposal via Control Plane
  const execution = await executeProposalOnce({
    proposal,
    reloadAndVerifyContext: async (prop) => {
      const authState = await prisma.reply.findUnique({
        where: { id: replyId },
        select: {
          body: true,
          outreachMessageId: true,
          lead: {
            select: {
              firstName: true,
              companyName: true,
              qualificationScore: true,
              campaign: { select: { orgId: true } },
            },
          },
          outreachMessage: { select: { subject: true, body: true } },
        },
      });

      if (!authState) {
        throw new Error(`[reply-decision.service] Authoritative state lost for reply: ${replyId}`);
      }

      const currentBundle = {
        messageId: authState.outreachMessageId,
        replyBody: authState.body,
        originalSubject: authState.outreachMessage.subject,
        originalBody: authState.outreachMessage.body,
        leadFirstName: authState.lead.firstName ?? null,
        companyName: authState.lead.companyName ?? null,
        tenantId: authState.lead.campaign.orgId ?? null,
      };

      const currentContextHash = createContextHash(currentBundle);

      if (prop.contextHash !== currentContextHash) {
        throw new GatewayContextMismatchError(
          prop.agentName,
          prop.proposalId,
          currentContextHash,
          prop.contextHash,
        );
      }
    },
    executeMutation: async (tx, prop) => {
      const authState = await tx.reply.findUnique({
        where: { id: replyId },
        select: { leadId: true, lead: { select: { qualificationScore: true } } },
      });
      const firmographicScore = authState?.lead.qualificationScore ?? 0.5;
      const hybridScore = calculateHybridScore({
        firmographicScore,
        intentTier: prop.payload.intentTier,
      });

      const updatedReply = await tx.reply.update({
        where: { id: replyId },
        data: {
          intent: prop.payload.intent as ReplyIntent,
          confidence: prop.payload.confidence,
          requiresHumanReview: prop.payload.confidence < 0.6,
          classifiedAt: new Date(),
          buyingStage: prop.payload.buyingStage,
          painPoints: prop.payload.painPoints,
          competitorsMentioned: prop.payload.competitorsMentioned,
          budgetSignal: prop.payload.budgetSignal,
          timelineSignal: prop.payload.timelineSignal,
        },
      });

      // Atomically create OutboxEvent for REPLY_INTENT_CLASSIFIED inside same transaction
      await createOutboxEvent(tx, {
        organizationId: reply.lead?.campaign?.orgId ?? "org_default",
        eventType: "REPLY_INTENT_CLASSIFIED",
        aggregateType: "Reply",
        aggregateId: replyId,
        idempotencyKey: buildReplyClassifiedIdempotencyKey(replyId),
        payload: {
          replyId,
          leadId: authState?.leadId ?? updatedReply.leadId,
          intent: prop.payload.intent,
          confidence: prop.payload.confidence,
        },
      });

      // Atomically create OutboxEvent for CRM_SYNC_REQUESTED inside same transaction
      if (authState?.leadId) {
        await createOutboxEvent(tx, {
          organizationId: reply.lead?.campaign?.orgId ?? "org_default",
          eventType: "CRM_SYNC_REQUESTED",
          aggregateType: "Lead",
          aggregateId: authState.leadId,
          idempotencyKey: buildCrmSyncIdempotencyKey(authState.leadId, "REPLY_CLASSIFIED", replyId),
          payload: {
            leadId: authState.leadId,
            replyId,
            intent: prop.payload.intent,
          },
        });
      }

      return {
        result: { hybridScore },
        resource: null,
      };
    },
  });

  return {
    replyId,
    policyDecision,
    proposal: proposal.payload,
    hybridScore: execution.result?.hybridScore,
    executedAction: `CLASSIFIED_${proposal.payload.intent}`,
    isIdempotentReplay: execution.isIdempotentReplay,
  };
}
