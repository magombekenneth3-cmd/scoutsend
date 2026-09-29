/**
 * Deterministic Execution Service — Outreach Message Generation
 *
 * LOCATION: app/api/src/modules/outreach/generate-message.execution.ts
 * PRISMA PERMISSION: Allowed (outside gemini/ agent directory).
 *
 * RESPONSIBILITIES:
 * 1. Reload authoritative DB state (Lead, Campaign, BrandSettings, Win/Loss Patterns).
 * 2. Recompute current canonical context hash.
 * 3. Verify proposal contextHash against current hash (TOCTOU protection).
 *    Throws GatewayContextMismatchError if mismatched — NO DB MUTATION OCCURS.
 * 4. Run deterministic policy & compliance wall (eligibility, qualification, email verification, spam threshold).
 * 5. Execute atomic short Prisma transaction to commit OutreachMessage state.
 */

import { randomUUID } from "node:crypto";
import pLimit from "p-limit";
import { Prisma, ApprovalStatus, DeliveryState } from "@prisma/client";

export type GeneratedProposalCache = any;
import { AppError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { redis } from "../../lib/ioredis";
import { logger } from "../../lib/logger";
import { emitCampaignEvent } from "../../lib/campaign-events";
import {
  type AgentProposal,
  type GeneratedMessage,
  type GenerationContextInput,
  createContextHash,
  buildMessageGenerationContextBundle,
  buildProposalId,
  createProposalHash,
  verifyProposalIntegrity,
  isProposalExpired,
  GeneratedMessageSchema,
  GatewayContextMismatchError,
  GatewayIntegrityError,
  GatewayExpiredProposalError,
  GatewayAlreadyExecutedError,
} from "../../lib/llm-gateway";
import {
  generateMessageProposalForLead,
  type RejectionReason,
  type MaterialChangeReason,
  type LeadWithSignals,
  type FewShotExample,
  type WinPattern,
  type LossPattern,
  type StructuredCompanyFacts,
} from "../gemini/generate.agent";
import { getFewShotExamples } from "../learning/learning.service";
import { getWinPatterns, getLossPatterns } from "../memory/memory.service";
import { createOutboxEvent, buildEmailSendIdempotencyKey } from "../outbox/outbox.service";
import { emailGenerationQueue } from "../gemini/campaign.queue";

export const PROPOSAL_PERSISTENCE_STATUS = {
  GENERATED: "GENERATED",
  PERSISTING: "PERSISTING",
  PERSISTED: "PERSISTED",
  PERSIST_FAILED: "PERSIST_FAILED",
  EXPIRED: "EXPIRED",
  INVALID: "INVALID",
  PERSISTENCE_EXHAUSTED: "PERSISTENCE_EXHAUSTED",
} as const;

export type ProposalPersistenceStatus =
  (typeof PROPOSAL_PERSISTENCE_STATUS)[keyof typeof PROPOSAL_PERSISTENCE_STATUS];

export async function queueProposalPersistenceRetry(cacheId: string): Promise<void> {
  try {
    const jobId = `persist-prop-${cacheId}`;
    const existingJob = await emailGenerationQueue.getJob(jobId);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === "failed" || state === "completed") {
        await existingJob.remove().catch(() => {});
      }
    }
    await emailGenerationQueue.add(
      "persist-generated-proposal" as any,
      { cacheId },
      { jobId }
    );
  } catch (err) {
    logger.warn(
      { err, cacheId },
      "[generate-execution] Failed to queue proposal persistence retry in BullMQ — maintenance sweeper will handle recovery"
    );
  }
}

const DEFAULT_QUALIFICATION_THRESHOLD = 0.5;
const MIN_SIGNAL_TYPE_SAMPLE_SIZE = 10;

export interface ExecuteProposalOptions {
  isRegenerationPass?: boolean;
  assignedVariant?: "VARIANT_A" | "VARIANT_B";
}

export class PolicyValidationError extends AppError {
  constructor(message: string, public readonly reasonCode: string) {
    super(`Policy violation [${reasonCode}]: ${message}`, 422);
    this.name = "PolicyValidationError";
  }
}

export class PersistenceFailedError extends AppError {
  constructor(
    message: string,
    public readonly proposalId: string,
    public readonly cacheId: string
  ) {
    super(`Persistence failed for proposal [${proposalId}]: ${message}`, 503);
    this.name = "PersistenceFailedError";
  }
}

// ─── Database Helpers ─────────────────────────────────────────────────────────

export async function resolveWinningVariant(campaignId: string): Promise<"VARIANT_A" | "VARIANT_B" | null> {
  try {
    const stats = await prisma.$queryRaw<
      Array<{ subjectVariant: string; totalSent: bigint; totalOpened: bigint; totalReplied: bigint }>
    >`
      SELECT
        om."subjectVariant",
        COUNT(*) AS "totalSent",
        COUNT(CASE WHEN om."deliveryState" IN ('OPENED', 'REPLIED') THEN 1 END) AS "totalOpened",
        COUNT(CASE WHEN om."deliveryState" = 'REPLIED' THEN 1 END) AS "totalReplied"
      FROM "OutreachMessage" om
      JOIN "Lead" l ON l.id = om."leadId"
      WHERE l."campaignId" = ${campaignId}
        AND om."subjectVariant" IS NOT NULL
        AND om."deliveryState" IN ('SENT', 'DELIVERED', 'OPENED', 'REPLIED')
      GROUP BY om."subjectVariant"
    `;

    if (stats.length < 2) return null;

    const variantA = stats.find((s) => s.subjectVariant === "VARIANT_A");
    const variantB = stats.find((s) => s.subjectVariant === "VARIANT_B");

    if (!variantA || !variantB) return null;

    const totalDispatches = Number(variantA.totalSent) + Number(variantB.totalSent);
    if (totalDispatches < 50) return null;

    const replyRateA = Number(variantA.totalReplied) / Math.max(1, Number(variantA.totalSent));
    const replyRateB = Number(variantB.totalReplied) / Math.max(1, Number(variantB.totalSent));

    if (replyRateA > replyRateB + 0.05) return "VARIANT_A";
    if (replyRateB > replyRateA + 0.05) return "VARIANT_B";

    const openRateA = Number(variantA.totalOpened) / Math.max(1, Number(variantA.totalSent));
    const openRateB = Number(variantB.totalOpened) / Math.max(1, Number(variantB.totalSent));

    if (openRateA > openRateB + 0.05) return "VARIANT_A";
    if (openRateB > openRateA + 0.05) return "VARIANT_B";

    return null;
  } catch {
    return null;
  }
}

export async function getSignalTypeReplyRates(): Promise<Map<string, number>> {
  try {
    const rows = await prisma.$queryRaw<
      Array<{ leadingSignal: string; totalSent: bigint; totalReplied: bigint }>
    >`
      SELECT
        om."leadingSignal",
        COUNT(*) AS "totalSent",
        COUNT(CASE WHEN om."deliveryState" = 'REPLIED' THEN 1 END) AS "totalReplied"
      FROM "OutreachMessage" om
      WHERE om."leadingSignal" IS NOT NULL
        AND om."deliveryState" IN ('SENT', 'DELIVERED', 'OPENED', 'REPLIED')
      GROUP BY om."leadingSignal"
      HAVING COUNT(*) >= ${MIN_SIGNAL_TYPE_SAMPLE_SIZE}
    `;
    return new Map(rows.map((r) => [r.leadingSignal, Number(r.totalReplied) / Math.max(1, Number(r.totalSent))]));
  } catch {
    return new Map();
  }
}

// ─── Authoritative Context Loader ─────────────────────────────────────────────

export async function loadAuthoritativeContext(
  leadId: string,
  campaignId: string,
  options?: { tone?: string; feedbackContext?: string }
): Promise<{
  contextInput: GenerationContextInput;
  contextHash: string;
  lead: LeadWithSignals;
  campaign: any;
}> {
  const [lead, campaign] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        signals: { orderBy: { confidence: "desc" }, take: 5 },
        company: { include: { signals: { orderBy: { confidence: "desc" }, take: 5 } } },
      },
    }),
    prisma.campaign.findUnique({
      where: { id: campaignId },
      include: {
        senderDomain: { select: { domain: true } },
      },
    }),
  ]);

  if (!lead) throw new Error(`Lead ${leadId} not found`);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const contextInput: GenerationContextInput = {
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
      id: campaign.id,
      name: campaign.name,
      icpDescription: campaign.icpDescription,
      targetIndustry: campaign.targetIndustry,
      targetRegion: campaign.targetRegion,
      businessDescription: campaign.businessDescription,
      valueProposition: campaign.valueProposition,
    },
    senderDomain: campaign.senderDomain?.domain,
    tone: options?.tone,
    feedbackContext: options?.feedbackContext,
  };

  const bundle = buildMessageGenerationContextBundle(contextInput);
  const contextHash = createContextHash(bundle);

  return { contextInput, contextHash, lead: lead as LeadWithSignals, campaign };
}

// ─── Proposal Execution ───────────────────────────────────────────────────────

import { executeProposalOnce, ProposalExecutionIntegrityError } from "../proposal-execution/proposal-execution.service";

export async function executeGeneratedMessageProposal(
  proposal: AgentProposal<GeneratedMessage>,
  leadId: string,
  campaignId: string,
  options: ExecuteProposalOptions = {}
) {
  const execution = await executeProposalOnce({
    proposal,
    reloadAndVerifyContext: async (prop) => {
      const { contextHash: currentContextHash } = await loadAuthoritativeContext(leadId, campaignId);
      if (prop.contextHash && prop.contextHash !== currentContextHash) {
        logger.warn(
          {
            agentName: prop.agentName,
            proposalId: prop.proposalId,
            expectedHash: prop.contextHash,
            actualHash: currentContextHash,
            leadId,
            campaignId,
          },
          "[generate-execution] Context hash mismatch — rejecting stale proposal"
        );
        throw new GatewayContextMismatchError(
          prop.agentName,
          prop.proposalId,
          prop.contextHash,
          currentContextHash
        );
      }
    },
    validatePolicy: async () => {
      const { lead, campaign } = await loadAuthoritativeContext(leadId, campaignId);
      if (lead.deletedAt !== null) {
        throw new PolicyValidationError("Lead has been soft-deleted", "LEAD_DELETED");
      }
      if (lead.recommendedAction === "DISQUALIFY") {
        throw new PolicyValidationError("Lead is disqualified", "LEAD_DISQUALIFIED");
      }
      const qualificationThreshold = campaign.qualificationThreshold ?? DEFAULT_QUALIFICATION_THRESHOLD;
      if (
        lead.qualificationScore !== null &&
        lead.qualificationScore !== undefined &&
        lead.qualificationScore < qualificationThreshold
      ) {
        throw new PolicyValidationError(
          `Lead qualification score (${lead.qualificationScore}) is below threshold (${qualificationThreshold})`,
          "QUALIFICATION_TOO_LOW"
        );
      }
      const isLinkedInCampaign = !!campaign.linkedInAccountId;
      if (!isLinkedInCampaign) {
        if (!lead.email || lead.emailStatus !== "FOUND") {
          throw new PolicyValidationError("Lead does not have a valid found email", "EMAIL_INVALID");
        }
        if (campaign.requireVerifiedEmailForGeneration && !lead.emailVerified) {
          throw new PolicyValidationError(
            "Campaign requires verified email for message generation",
            "EMAIL_UNVERIFIED"
          );
        }
      }
    },
    executeMutation: async (tx) => {
      const { lead, campaign } = await loadAuthoritativeContext(leadId, campaignId);
      const assignedVariant = options.assignedVariant ?? "VARIANT_A";
      const finalSubject =
        assignedVariant === "VARIANT_B" && proposal.payload.subjectVariant
          ? proposal.payload.subjectVariant
          : proposal.payload.subject;

      const diffVectorPayload: Record<string, string> = {};
      if (proposal.payload.subjectVariant) diffVectorPayload.subjectVariant = proposal.payload.subjectVariant;
      if (proposal.payload.ctaTier) diffVectorPayload.ctaTier = proposal.payload.ctaTier;

      const createData: Prisma.OutreachMessageUncheckedCreateInput = {
        leadId: lead.id,
        subject: finalSubject,
        body: proposal.payload.body,
        leadingSignal: proposal.payload.leadingSignal ?? null,
        generationConfidence: proposal.payload.confidence,
        approvalStatus: ApprovalStatus.PENDING,
        deliveryState: DeliveryState.DRAFT,
        subjectVariant: assignedVariant,
        ...(Object.keys(diffVectorPayload).length > 0 && {
          diffVector: diffVectorPayload as Prisma.InputJsonValue,
        }),
      };

      let createdMessage;
      if (options.isRegenerationPass) {
        await tx.outreachMessage.deleteMany({
          where: {
            leadId: lead.id,
            approvalStatus: ApprovalStatus.PENDING,
            deliveryState: DeliveryState.DRAFT,
          },
        });
        createdMessage = await tx.outreachMessage.create({ data: createData });
      } else {
        createdMessage = await tx.outreachMessage.create({ data: createData });
      }

      // Atomically create OutboxEvent for EMAIL_SEND_REQUESTED inside same transaction
      await createOutboxEvent(tx, {
        organizationId: campaign.orgId ?? "org_default",
        eventType: "EMAIL_SEND_REQUESTED",
        aggregateType: "OutreachMessage",
        aggregateId: createdMessage.id,
        idempotencyKey: buildEmailSendIdempotencyKey(createdMessage.id),
        payload: {
          outreachMessageId: createdMessage.id,
          leadId: lead.id,
          campaignId,
          senderMailboxId: campaign.senderMailboxId ?? undefined,
        },
      });

      return {
        result: createdMessage,
        resource: {
          type: "OUTREACH_MESSAGE",
          id: createdMessage.id,
        },
      };
    },
  });

  return execution.result!;
}

// ─── Cache Persistence & Recovery Engine ────────────────────────────────────

const RELEASE_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
`;

const RENEW_LOCK_SCRIPT = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
  else
    return 0
  end
`;

export async function acquireGenerationLock(
  proposalId: string,
  ttlMs = 30000
): Promise<{ acquired: boolean; release: () => Promise<void> }> {
  const lockKey = `genlock:${proposalId}`;
  const lockToken = randomUUID();

  let result: string | null = null;
  try {
    result = await redis.set(lockKey, lockToken, "PX", ttlMs, "NX");
  } catch (err) {
    logger.error({ err, lockKey }, "[generate-execution] Redis lock error — lock failed");
    throw new AppError("Infrastructure error: Redis lock service unavailable", 503);
  }

  if (result === "OK") {
    const heartbeatTimer = setInterval(async () => {
      try {
        await redis.eval(RENEW_LOCK_SCRIPT, 1, lockKey, lockToken, String(ttlMs));
      } catch (err) {
        logger.warn({ err, lockKey }, "[genlock] Lock renewal heartbeat failed");
      }
    }, 10000);

    return {
      acquired: true,
      release: async () => {
        clearInterval(heartbeatTimer);
        try {
          await redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, lockToken);
        } catch (err) {
          logger.warn({ err, lockKey }, "[generate-execution] Failed to release generation lock");
        }
      },
    };
  }

  return { acquired: false, release: async () => {} };
}

export async function waitForCachedProposal(
  proposalId: string,
  maxWaitMs = 15000,
  pollIntervalMs = 500
): Promise<GeneratedProposalCache | null> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    const cache = await (prisma as any).generatedProposalCache.findUnique({
      where: { proposalId },
    });
    if (cache) return cache;
  }
  return null;
}

export async function persistCachedProposal(
  cacheId: string,
  options: ExecuteProposalOptions = {}
): Promise<string> {
  let cache = await (prisma as any).generatedProposalCache.findUnique({
    where: { id: cacheId },
  });

  if (!cache) {
    throw new Error(`GeneratedProposalCache record ${cacheId} not found`);
  }

  if (cache.persistenceStatus === PROPOSAL_PERSISTENCE_STATUS.PERSISTED) {
    if (cache.persistedMessageId) {
      const existingMsg = await prisma.outreachMessage.findUnique({
        where: { id: cache.persistedMessageId },
      });
      if (existingMsg) {
        return existingMsg.id;
      }
    }

    logger.warn(
      { cacheId, proposalId: cache.proposalId },
      "[generate-execution] PERSISTED proposal missing OutreachMessage in DB — resetting to GENERATED for re-persisting"
    );

    cache = await (prisma as any).generatedProposalCache.update({
      where: { id: cacheId },
      data: {
        persistenceStatus: PROPOSAL_PERSISTENCE_STATUS.GENERATED,
        persistedMessageId: null,
      },
    });
  }

  const rawPayload = {
    subject: cache.subject,
    body: cache.body,
    confidence: cache.confidence,
    subjectVariant: cache.subjectVariant ?? undefined,
    leadingSignal: cache.leadingSignal ?? undefined,
    ctaTier: cache.ctaTier ?? undefined,
  };

  const parsedPayload = GeneratedMessageSchema.parse(rawPayload);

  const proposal: AgentProposal<GeneratedMessage> = {
    proposalId: cache.proposalId,
    agentName: cache.agentName,
    payload: parsedPayload,
    agentConfidence: cache.confidence,
    reasoning: cache.reasoning ?? undefined,
    contextHash: cache.contextHash,
    proposedAt: cache.createdAt,
    expiresAt: cache.expiresAt,
    requestFingerprint: cache.requestFingerprint,
    proposalHash: cache.proposalHash,
    tokenUsage: {
      input: cache.tokenInput,
      output: cache.tokenOutput,
      total: cache.tokenTotal,
    },
    latencyMs: cache.latencyMs,
  };

  const recalculatedHash = createProposalHash({
    agentName: proposal.agentName,
    requestFingerprint: proposal.requestFingerprint,
    contextHash: proposal.contextHash,
    payload: proposal.payload,
    agentConfidence: proposal.agentConfidence,
  });

  if (recalculatedHash !== cache.proposalHash) {
    logger.error(
      { cacheId, proposalId: cache.proposalId, expected: cache.proposalHash, recalculated: recalculatedHash },
      "[generate-execution] Proposal integrity check failed for cached record — payload tampering detected"
    );
    await (prisma as any).generatedProposalCache.update({
      where: { id: cacheId },
      data: {
        persistenceStatus: PROPOSAL_PERSISTENCE_STATUS.INVALID,
        lastPersistError: "Proposal integrity check failed — hash mismatch",
      },
    }).catch(() => {});
    throw new GatewayIntegrityError(proposal.agentName, proposal.proposalId);
  }

  if (isProposalExpired(proposal)) {
    logger.warn(
      { cacheId, proposalId: cache.proposalId, expiresAt: proposal.expiresAt },
      "[generate-execution] Proposal in cache has expired — marking EXPIRED"
    );
    await (prisma as any).generatedProposalCache.update({
      where: { id: cacheId },
      data: {
        persistenceStatus: PROPOSAL_PERSISTENCE_STATUS.EXPIRED,
        lastPersistError: "Proposal expired past TTL",
      },
    }).catch(() => {});
    throw new GatewayExpiredProposalError(proposal.agentName, proposal.proposalId, proposal.expiresAt);
  }

  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(Date.now() + 2 * 60 * 1000);
  const now = new Date();

  const updatedCount = await (prisma as any).generatedProposalCache.updateMany({
    where: {
      id: cacheId,
      OR: [
        { persistenceStatus: { in: [PROPOSAL_PERSISTENCE_STATUS.GENERATED, PROPOSAL_PERSISTENCE_STATUS.PERSIST_FAILED] } },
        { persistenceStatus: PROPOSAL_PERSISTENCE_STATUS.PERSISTING, leaseExpiresAt: { lte: now } },
      ],
    },
    data: {
      persistenceStatus: PROPOSAL_PERSISTENCE_STATUS.PERSISTING,
      leaseToken,
      leaseExpiresAt,
      persistAttempts: { increment: 1 },
      updatedAt: now,
    },
  });

  if (updatedCount.count === 0) {
    const current = await (prisma as any).generatedProposalCache.findUnique({ where: { id: cacheId } });
    if (current?.persistenceStatus === PROPOSAL_PERSISTENCE_STATUS.PERSISTED && current.persistedMessageId) {
      const msg = await prisma.outreachMessage.findUnique({ where: { id: current.persistedMessageId } });
      if (msg) return msg.id;
    }
    throw new PersistenceFailedError(
      "Lease acquisition failed — another worker is actively persisting this proposal",
      cache.proposalId,
      cacheId
    );
  }

  let leaseHeartbeatTimer: NodeJS.Timeout | null = null;

  try {
    leaseHeartbeatTimer = setInterval(async () => {
      try {
        const nextExp = new Date(Date.now() + 2 * 60 * 1000);
        await (prisma as any).generatedProposalCache.updateMany({
          where: { id: cacheId, leaseToken },
          data: { leaseExpiresAt: nextExp, updatedAt: new Date() },
        });
      } catch (err) {
        logger.warn({ err, cacheId }, "[persist-lease] Lease renewal heartbeat failed");
      }
    }, 30000);

    const createdMessage = await executeGeneratedMessageProposal(
      proposal,
      cache.leadId,
      cache.campaignId,
      options
    );

    if (leaseHeartbeatTimer) clearInterval(leaseHeartbeatTimer);

    const fencedComplete = await (prisma as any).generatedProposalCache.updateMany({
      where: {
        id: cacheId,
        leaseToken,
      },
      data: {
        persistenceStatus: PROPOSAL_PERSISTENCE_STATUS.PERSISTED,
        persistedMessageId: createdMessage.id,
        leaseToken: null,
        leaseExpiresAt: null,
        lastPersistError: null,
      },
    });

    if (fencedComplete.count === 0) {
      logger.warn(
        { cacheId, proposalId: cache.proposalId, leaseToken },
        "[generate-execution] Fencing breach — worker lost lease before PERSISTED update"
      );
      const execution = await prisma.agentProposalExecution.findUnique({
        where: { proposalId: cache.proposalId },
      });
      if (execution && createdMessage.id) {
        await (prisma as any).generatedProposalCache.update({
          where: { id: cacheId },
          data: {
            persistenceStatus: PROPOSAL_PERSISTENCE_STATUS.PERSISTED,
            persistedMessageId: createdMessage.id,
            leaseToken: null,
            leaseExpiresAt: null,
            lastPersistError: null,
          },
        }).catch(() => {});
        return createdMessage.id;
      }
      throw new PersistenceFailedError("Worker lost lease before completion update", cache.proposalId, cacheId);
    }

    logger.info(
      { cacheId, proposalId: cache.proposalId, messageId: createdMessage.id },
      "[generate-execution] Cached proposal successfully persisted to OutreachMessage"
    );

    return createdMessage.id;
  } catch (err: unknown) {
    if (leaseHeartbeatTimer) clearInterval(leaseHeartbeatTimer);
    const errorMsg = err instanceof Error ? err.message : String(err);

    if (err instanceof GatewayAlreadyExecutedError) {
      const execution: any = await prisma.agentProposalExecution.findUnique({
        where: { proposalId: cache.proposalId },
      });
      if (execution?.status === "SUCCEEDED") {
        if (!execution.outreachMessageId) {
          throw new ProposalExecutionIntegrityError(
            `SUCCEEDED proposal execution ${cache.proposalId} has no persisted outreachMessageId identity`
          );
        }
        const existingMsg = await prisma.outreachMessage.findUnique({
          where: { id: execution.outreachMessageId },
        });
        if (!existingMsg) {
          throw new ProposalExecutionIntegrityError(
            `SUCCEEDED proposal execution ${cache.proposalId} references non-existent OutreachMessage ID ${execution.outreachMessageId}`
          );
        }
        await (prisma as any).generatedProposalCache.update({
          where: { id: cacheId },
          data: {
            persistenceStatus: PROPOSAL_PERSISTENCE_STATUS.PERSISTED,
            persistedMessageId: existingMsg.id,
            leaseToken: null,
            leaseExpiresAt: null,
            lastPersistError: null,
          },
        }).catch(() => {});
        return existingMsg.id;
      }
    }

    logger.error(
      { err, cacheId, proposalId: cache.proposalId, leadId: cache.leadId },
      "[generate-execution] Failed to persist cached proposal — updating status to PERSIST_FAILED"
    );

    await (prisma as any).generatedProposalCache.updateMany({
      where: { id: cacheId, leaseToken },
      data: {
        persistenceStatus: PROPOSAL_PERSISTENCE_STATUS.PERSIST_FAILED,
        leaseToken: null,
        leaseExpiresAt: null,
        lastPersistError: errorMsg.slice(0, 500),
      },
    }).catch(() => {});

    throw err;
  }
}

export async function sweepFailedProposalPersistences(batchSize = 25): Promise<{ processed: number; succeeded: number; failed: number; exhausted: number }> {
  const now = new Date();
  const twoMinsAgo = new Date(now.getTime() - 2 * 60 * 1000);

  const exhaustedResult = await (prisma as any).generatedProposalCache.updateMany({
    where: {
      persistenceStatus: { in: [PROPOSAL_PERSISTENCE_STATUS.GENERATED, PROPOSAL_PERSISTENCE_STATUS.PERSIST_FAILED, PROPOSAL_PERSISTENCE_STATUS.PERSISTING] },
      persistAttempts: { gte: 5 },
    },
    data: {
      persistenceStatus: PROPOSAL_PERSISTENCE_STATUS.PERSISTENCE_EXHAUSTED,
      lastPersistError: "Max persistence attempts (5) reached without successful commit",
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });

  const records = await (prisma as any).generatedProposalCache.findMany({
    where: {
      OR: [
        { persistenceStatus: { in: [PROPOSAL_PERSISTENCE_STATUS.GENERATED, PROPOSAL_PERSISTENCE_STATUS.PERSIST_FAILED] } },
        { persistenceStatus: PROPOSAL_PERSISTENCE_STATUS.PERSISTING, leaseExpiresAt: { lte: now } },
        { persistenceStatus: PROPOSAL_PERSISTENCE_STATUS.PERSISTING, updatedAt: { lt: twoMinsAgo } },
      ],
      persistAttempts: { lt: 5 },
    },
    take: batchSize,
    orderBy: { updatedAt: "asc" },
  });

  let succeeded = 0;
  let failed = 0;

  for (const record of records) {
    try {
      await persistCachedProposal(record.id);
      succeeded++;
    } catch (err) {
      failed++;
      logger.warn({ err, cacheId: record.id, proposalId: record.proposalId }, "[generate-execution] Sweeper failed to recover proposal persistence");
    }
  }

  return { processed: records.length, succeeded, failed, exhausted: exhaustedResult.count };
}

// ─── Orchestrators ────────────────────────────────────────────────────────────

function buildFeedbackContext(rejection: RejectionReason): string {
  const lines: string[] = [`Reasons: ${rejection.reasons.join(", ")}`];

  if (rejection.reasons.some((r) => r.startsWith("spam_too_high"))) {
    lines.push(
      "Fix spam: remove generic/urgency phrases, strip pushy CTAs, open with a specific observation instead of a question."
    );
  }
  if (rejection.reasons.some((r) => r.startsWith("personalization_too_low"))) {
    lines.push(
      "Fix personalization: lead with a company-specific signal, reference exact signal values, tie the CTA to the recipient's role."
    );
  }

  return lines.join("\n");
}

function buildMaterialChangeContext(change: MaterialChangeReason): string {
  return [
    `New information has come in about this lead/company since an earlier draft was written: ${change.changeReason}`,
    'Incorporate this if it strengthens the "why now" angle or the personalization. Do not mention that an earlier draft existed or reference the update process itself.',
  ].join("\n");
}

export async function runGenerateAgent(
  campaignId: string,
  options: {
    feedbackMap?: Record<string, RejectionReason>;
    materialChangeMap?: Record<string, MaterialChangeReason>;
  } = {}
): Promise<{ succeededLeadIds: string[]; failedLeadIds: string[] }> {
  const { feedbackMap, materialChangeMap } = options;
  const hasFeedback = feedbackMap != null && Object.keys(feedbackMap).length > 0;
  const hasMaterialChanges = materialChangeMap != null && Object.keys(materialChangeMap).length > 0;
  const isRegenerationPass = hasFeedback || hasMaterialChanges;

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      senderDomain: { select: { domain: true } },
    },
  });

  if (!campaign) throw new Error("Campaign not found");

  type ProvenStat = { metric: string; value: string; context: string };
  const campaignStats =
    Array.isArray(campaign.provenStats) && (campaign.provenStats as unknown[]).length > 0
      ? (campaign.provenStats as ProvenStat[])
      : null;

  const qualificationThreshold = campaign.qualificationThreshold ?? DEFAULT_QUALIFICATION_THRESHOLD;
  const isLinkedInCampaign = !!campaign.linkedInAccountId;

  let leads: LeadWithSignals[];

  if (isRegenerationPass) {
    const leadIds = Array.from(
      new Set([
        ...(feedbackMap ? Object.keys(feedbackMap) : []),
        ...(materialChangeMap ? Object.keys(materialChangeMap) : []),
      ])
    );

    leads = (await prisma.lead.findMany({
      where: {
        id: { in: leadIds },
        campaignId,
        recommendedAction: { not: "DISQUALIFY" },
        ...(!isLinkedInCampaign && {
          email: { not: null },
          emailStatus: "FOUND",
          ...(campaign.requireVerifiedEmailForGeneration && { emailVerified: true }),
        }),
        deletedAt: null,
      },
      include: {
        signals: { orderBy: { confidence: "desc" }, take: 5 },
        company: { include: { signals: { orderBy: { confidence: "desc" }, take: 5 } } },
      },
    })) as LeadWithSignals[];
  } else {
    leads = (await prisma.lead.findMany({
      where: {
        campaignId,
        ...(!isLinkedInCampaign && {
          email: { not: null },
          emailStatus: "FOUND",
          ...(campaign.requireVerifiedEmailForGeneration && { emailVerified: true }),
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
    })) as LeadWithSignals[];
  }

  if (leads.length === 0) {
    logger.info({ campaignId }, "[generate-execution] No qualifying leads — skipping generation");
    return { succeededLeadIds: [], failedLeadIds: [] };
  }

  const [fewShotExamples, winPatterns, lossPatterns, replyRateBySignalType, resolvedWinningVariant] = await Promise.all(
    [
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
      getSignalTypeReplyRates().catch(() => new Map<string, number>()),
      resolveWinningVariant(campaignId),
    ]
  );

  const structuredFactsCache = new Map<string, Promise<StructuredCompanyFacts | null>>();

  const limit = pLimit(5);
  let completed = 0;
  const total = leads.length;
  const succeededLeadIds: string[] = [];
  const failedLeadIds: string[] = [];

  await Promise.allSettled(
    leads.map((lead) =>
      limit(async () => {
        try {
          const rejection = feedbackMap?.[lead.id];
          const materialChange = materialChangeMap?.[lead.id];
          const feedbackContext = rejection
            ? buildFeedbackContext(rejection)
            : materialChange
              ? buildMaterialChangeContext(materialChange)
              : undefined;

          const proposal = await generateMessageProposalForLead({
            lead,
            campaignId,
            icpDescription: campaign.icpDescription,
            campaignName: campaign.name,
            senderDomain: campaign.senderDomain?.domain,
            targetIndustry: campaign.targetIndustry,
            targetRegion: campaign.targetRegion,
            feedbackContext,
            businessDescription: campaign.businessDescription,
            valueProposition: campaign.valueProposition,
            provenStats: campaignStats,
            replyRateBySignalType,
            structuredFactsCache,
          });

          // Step B: Durably write proposal to GeneratedProposalCache BEFORE business mutation
          let cacheRecord: GeneratedProposalCache | null = null;
          try {
            cacheRecord = await (prisma as any).generatedProposalCache.create({
              data: {
                proposalId: proposal.proposalId,
                agentName: proposal.agentName,
                leadId: lead.id,
                campaignId,
                subject: proposal.payload.subject,
                body: proposal.payload.body,
                subjectVariant: proposal.payload.subjectVariant ?? null,
                leadingSignal: proposal.payload.leadingSignal ?? null,
                ctaTier: proposal.payload.ctaTier ?? null,
                confidence: proposal.payload.confidence,
                reasoning: proposal.reasoning ?? null,
                proposalHash: proposal.proposalHash,
                contextHash: proposal.contextHash,
                requestFingerprint: proposal.requestFingerprint,
                expiresAt: proposal.expiresAt,
                tokenInput: proposal.tokenUsage.input,
                tokenOutput: proposal.tokenUsage.output,
                tokenTotal: proposal.tokenUsage.total,
                latencyMs: proposal.latencyMs,
                persistenceStatus: PROPOSAL_PERSISTENCE_STATUS.GENERATED,
              },
            });
          } catch (err: unknown) {
            const isP2002 = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
            if (isP2002) {
              cacheRecord = await (prisma as any).generatedProposalCache.findUnique({
                where: { proposalId: proposal.proposalId },
              });
            }
            if (!cacheRecord) {
              throw new PersistenceFailedError(
                `Cache persistence mandatory — write failed`, proposal.proposalId, "UNCOMMITTED"
              );
            }
          }

          // Step C: Execute persistence via persistCachedProposal
          const assignedVariant =
            resolvedWinningVariant ?? (Math.random() > 0.5 ? "VARIANT_A" : "VARIANT_B");

          await persistCachedProposal((cacheRecord as any)!.id, {
            isRegenerationPass,
            assignedVariant,
          });

          succeededLeadIds.push(lead.id);
        } catch (err) {
          failedLeadIds.push(lead.id);
          logger.error(
            { err, leadId: lead.id, company: lead.companyName },
            "[generate-execution] Failed for lead"
          );
        } finally {
          completed++;
        }
      })
    )
  );

  return { succeededLeadIds, failedLeadIds };
}

export async function generateSingleOutreachMessage(
  leadId: string,
  userId: string,
  tone?: string
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

  const { contextHash } = await loadAuthoritativeContext(leadId, campaign.id, { tone });

  const proposalId = buildProposalId("generate.message-writer", {
    leadId: lead.id,
    campaignId: campaign.id,
    contextHash,
  });

  let cacheRecord = await (prisma as any).generatedProposalCache.findUnique({
    where: { proposalId },
  });

  if (cacheRecord) {
    if (cacheRecord.persistenceStatus === PROPOSAL_PERSISTENCE_STATUS.PERSISTED && cacheRecord.persistedMessageId) {
      const msg = await prisma.outreachMessage.findUnique({
        where: { id: cacheRecord.persistedMessageId },
        include: {
          lead: {
            select: { id: true, firstName: true, lastName: true, email: true, companyName: true, campaignId: true },
          },
        },
      });
      if (msg) return msg;
    }

    try {
      const messageId = await persistCachedProposal(cacheRecord.id);
      return prisma.outreachMessage.findUnique({
        where: { id: messageId },
        include: {
          lead: {
            select: { id: true, firstName: true, lastName: true, email: true, companyName: true, campaignId: true },
          },
        },
      });
    } catch (err) {
      await queueProposalPersistenceRetry(cacheRecord.id);
      throw new PersistenceFailedError(
        err instanceof Error ? err.message : String(err),
        proposalId,
        cacheRecord.id
      );
    }
  }

  const genLock = await acquireGenerationLock(proposalId);

  if (!genLock.acquired) {
    const waitedCache = await waitForCachedProposal(proposalId);
    if (waitedCache) {
      if (waitedCache.persistenceStatus === PROPOSAL_PERSISTENCE_STATUS.PERSISTED && waitedCache.persistedMessageId) {
        const msg = await prisma.outreachMessage.findUnique({
          where: { id: waitedCache.persistedMessageId },
          include: {
            lead: { select: { id: true, firstName: true, lastName: true, email: true, companyName: true, campaignId: true } },
          },
        });
        if (msg) return msg;
      }

      try {
        const messageId = await persistCachedProposal(waitedCache.id);
        return prisma.outreachMessage.findUnique({
          where: { id: messageId },
          include: {
            lead: { select: { id: true, firstName: true, lastName: true, email: true, companyName: true, campaignId: true } },
          },
        });
      } catch (err) {
        throw new PersistenceFailedError(
          err instanceof Error ? err.message : String(err),
          proposalId,
          waitedCache.id
        );
      }
    } else {
      throw new PersistenceFailedError(
        "Timed out waiting for concurrent proposal generation lock holder",
        proposalId,
        "UNCOMMITTED"
      );
    }
  }

  try {
    cacheRecord = await (prisma as any).generatedProposalCache.findUnique({ where: { proposalId } });
    if (cacheRecord) {
      if (cacheRecord.persistenceStatus === PROPOSAL_PERSISTENCE_STATUS.PERSISTED && cacheRecord.persistedMessageId) {
        const msg = await prisma.outreachMessage.findUnique({
          where: { id: cacheRecord.persistedMessageId },
          include: {
            lead: { select: { id: true, firstName: true, lastName: true, email: true, companyName: true, campaignId: true } },
          },
        });
        if (msg) return msg;
      }
      const messageId = await persistCachedProposal(cacheRecord.id);
      return prisma.outreachMessage.findUnique({
        where: { id: messageId },
        include: {
          lead: { select: { id: true, firstName: true, lastName: true, email: true, companyName: true, campaignId: true } },
        },
      });
    }

    type ProvenStat = { metric: string; value: string; context: string };
    const campaignStats =
      Array.isArray(campaign.provenStats) && (campaign.provenStats as unknown[]).length > 0
        ? (campaign.provenStats as ProvenStat[])
        : null;

    const [fewShotExamples, winPatterns, lossPatterns, replyRateBySignalType, winningVariant] = await Promise.all([
      getFewShotExamples({ limit: 5, icpDescription: campaign.icpDescription, targetIndustry: campaign.targetIndustry ?? undefined, targetRegion: campaign.targetRegion ?? undefined }).catch(() => []),
      getWinPatterns({ targetIndustry: campaign.targetIndustry ?? undefined, targetRegion: campaign.targetRegion ?? undefined, limit: 6 }).catch(() => []),
      getLossPatterns({ targetIndustry: campaign.targetIndustry ?? undefined, targetRegion: campaign.targetRegion ?? undefined, limit: 4 }).catch(() => []),
      getSignalTypeReplyRates().catch(() => new Map<string, number>()),
      resolveWinningVariant(lead.campaignId).catch(() => null),
    ]);

    const structuredFactsCache = new Map<string, Promise<StructuredCompanyFacts | null>>();

    const proposal = await generateMessageProposalForLead({
      lead: lead as LeadWithSignals,
      campaignId: lead.campaignId,
      icpDescription: campaign.icpDescription,
      campaignName: campaign.name,
      senderDomain: campaign.senderDomain?.domain,
      targetIndustry: campaign.targetIndustry,
      targetRegion: campaign.targetRegion,
      fewShotExamples,
      winPatterns,
      lossPatterns,
      tone,
      businessDescription: campaign.businessDescription,
      valueProposition: campaign.valueProposition,
      provenStats: campaignStats,
      replyRateBySignalType,
      structuredFactsCache,
    });

    try {
      cacheRecord = await (prisma as any).generatedProposalCache.create({
        data: {
          proposalId: proposal.proposalId,
          agentName: proposal.agentName,
          leadId: lead.id,
          campaignId: lead.campaignId,
          subject: proposal.payload.subject,
          body: proposal.payload.body,
          subjectVariant: proposal.payload.subjectVariant ?? null,
          leadingSignal: proposal.payload.leadingSignal ?? null,
          ctaTier: proposal.payload.ctaTier ?? null,
          confidence: proposal.payload.confidence,
          reasoning: proposal.reasoning ?? null,
          proposalHash: proposal.proposalHash,
          contextHash: proposal.contextHash,
          requestFingerprint: proposal.requestFingerprint,
          expiresAt: proposal.expiresAt,
          tokenInput: proposal.tokenUsage.input,
          tokenOutput: proposal.tokenUsage.output,
          tokenTotal: proposal.tokenUsage.total,
          latencyMs: proposal.latencyMs,
          persistenceStatus: PROPOSAL_PERSISTENCE_STATUS.GENERATED,
        },
      });
    } catch (err: unknown) {
      const isP2002 = err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
      if (isP2002) {
        cacheRecord = await (prisma as any).generatedProposalCache.findUnique({
          where: { proposalId: proposal.proposalId },
        });
      }
      if (!cacheRecord) {
        throw new PersistenceFailedError(
          `Cache persistence mandatory — write failed: ${err instanceof Error ? err.message : String(err)}`,
          proposal.proposalId,
          "UNCOMMITTED"
        );
      }
    }

    const assignedVariant = winningVariant ?? (Math.random() > 0.5 ? "VARIANT_A" : "VARIANT_B");

    try {
      const messageId = await persistCachedProposal(cacheRecord.id, { assignedVariant });
      return prisma.outreachMessage.findUnique({
        where: { id: messageId },
        include: {
          lead: { select: { id: true, firstName: true, lastName: true, email: true, companyName: true, campaignId: true } },
        },
      });
    } catch (persistErr) {
      await queueProposalPersistenceRetry(cacheRecord.id);
      throw new PersistenceFailedError(
        persistErr instanceof Error ? persistErr.message : String(persistErr),
        proposal.proposalId,
        cacheRecord.id
      );
    }
  } finally {
    await genLock.release();
  }
}
