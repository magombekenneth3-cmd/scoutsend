import { Worker } from "bullmq";
import { z } from "zod";
import { prisma } from "../../../lib/prisma";
import { redisConnectionOptions } from "../../../lib/ioredis";
import { QUEUE_POLICY } from "../queue-policy";
import { wireWorkerEvents } from "../worker-runtime";
import { logger } from "../../../lib/logger";
import { parseJobData } from "../../../lib/job-validation";
import { runHealthCheckAllCampaigns } from "../campaign-health.agent";
import { runWarmupAgent } from "../warmup.agent";
import { runSeedWarmupScheduler } from "../seed-warmup.agent";
import { runObjectionHandlerForCampaign } from "../objection-handler.agent";
import { runMultiSourceDiscoveryAgent } from "../multi-source-discovery.agent";
import { runLinkedInDiscoveryAgent } from "../linkedin-discovery.agent";
import { runCommunityIntentAgent } from "../community-intent.agent";
import { runLookalikeAgent } from "../../../../../../agents/lookAlike/lookalike.agent";
import { resolveLookalikeSeeds } from "../../lookalike/seed-resolver";
import { runResearchAgent } from "../gemini.agent";
import { runBulkLeadScoringAgent } from "../lead-scoring.agent";
import { runGenerateAgent } from "../generate.agent";
import { runReviewAgent } from "../review.agent";
import { pruneOldAITraces, checkOrgSpend } from "../../AItrace/Aitrace.service";
import { verifySenderDomainDns } from "../../senderDomain/senderDomain.services";
import { populateTechSignals } from "../discoveryLib/builtWith";
import { extractDomain } from "../../../lib/company/company.upsert";
import { mostRecentLocalMidnightUtc } from "../../../lib/daily-quota";
import { sendQueue, realtimeQueue, linkedinQueue, maintenanceQueue } from "../campaign.queue";

import { triggerAutoIcpRefinement } from "../icp.refinementAgent";
import { runLogRetentionPurge } from "../../system/log-retention.service";
import {
  reconcileOperations,
  reconcileQuotaReservations,
  reconcileMessageClaims,
} from "../../../lib/send/reconciliation.workers";
import { sweepStaleLeases } from "../../../lib/send/stale-lease-recovery.sweeper";
import { sweepUnknownIntents } from "../../../lib/send/unknown-reconciliation.sweeper";
import { sweepOutboxEvents } from "../../../lib/send/outbox-relay.sweeper";
import { sweepFailedProposalPersistences } from "../../outreach/generate-message.execution";

const policy = QUEUE_POLICY.maintenance;

const campaignIdSchema = z.object({ campaignId: z.string().min(1) });

const LOW_LEAD_THRESHOLD = 10;
const MAX_SEND_RETRIES = 5;
const FOLLOWUP_CAMPAIGN_CUTOFF_MS = 30 * 24 * 60 * 60_000;
const STUCK_SENDING_TIMEOUT_MS = 10 * 60_000;
const STUCK_CAMPAIGN_TIMEOUT_MS = 30 * 60_000;
const STUCK_QUEUE_JOB_TIMEOUT_MS = 2 * 60 * 60_000;
const STUCK_STEP_TIMEOUT_MS = 15 * 60_000;
const MAX_STEP_RETRIES = 3;
const SCHEDULER_CAMPAIGN_BATCH_SIZE = 200;
const AGENT_TIMEOUT_MS = 5 * 60_000;

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Agent timed out after ${ms}ms`)), ms)
    ),
  ]);

async function hasActivePipeline(campaignId: string): Promise<boolean> {
  const job = await prisma.queueJob.findFirst({
    where: {
      campaignId,
      status: "ACTIVE",
      jobType: { in: ["FULL_PIPELINE", "RESUME_SEND"] },
    },
    select: { id: true },
  });
  return !!job;
}

async function processJob(job: import("bullmq").Job) {
  const log = logger.child({ jobId: job.id, jobName: job.name, correlationId: job.data?.correlationId });

  switch (job.name) {
    case "daily-campaign-health-check": {
      log.info("[maintenance.worker] Running daily campaign health check");
      await runHealthCheckAllCampaigns();
      return { done: true };
    }

    case "daily-warmup-update": {
      log.info("[maintenance.worker] Running daily warmup update");
      await runWarmupAgent();
      return { done: true };
    }

    case "daily-seed-warmup-schedule": {
      log.info("[maintenance.worker] Running daily seed warmup scheduler");
      await runSeedWarmupScheduler();
      return { done: true };
    }

    case "periodic-dns-health-check": {
      const DNS_BATCH = 100;
      let cursor: string | undefined;
      let checkedCount = 0;
      let failedCount = 0;

      while (true) {
        const batch = await prisma.senderDomain.findMany({
          where: { health: { not: "BLOCKED" } },
          select: { id: true, domain: true },
          take: DNS_BATCH,
          orderBy: { id: "asc" },
          ...(cursor && { skip: 1, cursor: { id: cursor } }),
        });
        if (batch.length === 0) break;

        for (const domain of batch) {
          try {
            const res = await verifySenderDomainDns(domain.id, "SYSTEM");
            checkedCount++;
            if (!res.spfValid || !res.dkimValid || !res.dmarcValid) {
              failedCount++;
            }
          } catch (err) {
            log.warn({ err, domainId: domain.id }, "[maintenance.worker] Periodic DNS check error");
          }
        }

        if (batch.length < DNS_BATCH) break;
        cursor = batch[batch.length - 1].id;
      }

      return { checkedCount, failedCount };
    }

    case "stuck-sending-cleanup": {
      const fifteenMinsAgo = new Date(Date.now() - 15 * 60 * 1000);
      const res = await prisma.outreachMessage.updateMany({
        where: {
          deliveryState: "SENDING",
          updatedAt: { lt: fifteenMinsAgo },
        },
        data: {
          deliveryState: "QUEUED",
          claimToken: null,
        },
      });
      log.info({ count: res.count }, "[maintenance.worker] Reset stuck SENDING messages back to QUEUED");
      return { resetCount: res.count };
    }

    case "scan-pending-objections": {
      const campaigns = await prisma.campaign.findMany({
        where: {
          status: { in: ["QUEUED", "SENDING", "COMPLETED"] },
          deletedAt: null,
        },
        select: { id: true },
      });
      const campaignIds = campaigns.map((c) => c.id);
      const pendingReplies = await prisma.reply.findMany({
        where: {
          lead: { campaignId: { in: campaignIds } },
          intent: { in: ["POSITIVE", "MEETING_REQUEST", "QUESTION"] },
          requiresHumanReview: true,
          draftBody: null,
          deletedAt: null,
        },
        select: { lead: { select: { campaignId: true } } },
      });
      const campaignIdsWithPending = new Set<string>(
        pendingReplies.map((r) => r.lead.campaignId)
      );
      log.info({ campaigns: campaignIdsWithPending.size }, "[maintenance.worker] Pending objection drafts found");
      for (const campaignId of campaignIdsWithPending) {
        try {
          await realtimeQueue.add(
            "handle-objections",
            { campaignId },
            {
              jobId: `handle-objections-${campaignId}`,
              removeOnComplete: { age: 300 },
              removeOnFail: { age: 3600 },
            }
          );
        } catch (error) {
          log.error({ campaignId, error }, "[maintenance.worker] Failed to enqueue objection handler");
        }
      }
      return { scanned: campaigns.length, dispatched: campaignIdsWithPending.size };
    }

    case "scan-queued-campaigns": {
      const campaigns = await prisma.campaign.findMany({
        where: {
          status: "QUEUED",
          deletedAt: null,
          senderMailboxId: { not: null },
        },
        select: { id: true, name: true },
        take: SCHEDULER_CAMPAIGN_BATCH_SIZE,
        orderBy: { updatedAt: "asc" },
      });
      log.info({ count: campaigns.length }, "[maintenance.worker] Tick — found QUEUED campaigns");
      for (const campaign of campaigns) {
        try {
          await sendQueue.add(
            "send-batch",
            { campaignId: campaign.id },
            {
              jobId: `send-batch-${campaign.id}`,
              priority: 1,
              removeOnComplete: { age: 300 },
              removeOnFail: true,
            }
          );
        } catch (error) {
          log.error({ campaignId: campaign.id, error }, "[maintenance.worker] Failed scheduling campaign send");
        }
      }
      return { scanned: campaigns.length };
    }

    case "scan-followup-leads": {
      const cutoff = new Date(Date.now() - FOLLOWUP_CAMPAIGN_CUTOFF_MS);
      const activeCampaigns = await prisma.campaign.findMany({
        where: {
          deletedAt: null,
          OR: [
            { status: { in: ["QUEUED", "SENDING"] } },
            { status: "COMPLETED", updatedAt: { gte: cutoff } },
          ],
        },
        select: { id: true, name: true },
      });
      log.info({ count: activeCampaigns.length }, "[maintenance.worker] Follow-up tick");
      for (const campaign of activeCampaigns) {
        try {
          await realtimeQueue.add(
            "run-followup",
            { campaignId: campaign.id },
            {
              jobId: `followup-${campaign.id}`,
              priority: 2,
              removeOnComplete: { age: 300 },
              removeOnFail: { age: 3600 },
            }
          );
        } catch (error) {
          log.error({ campaignId: campaign.id, error }, "[maintenance.worker] Failed scheduling follow-up");
        }
      }
      return { checked: activeCampaigns.length };
    }

    case "scan-low-lead-campaigns": {
      const activeCampaigns = await prisma.campaign.findMany({
        where: { status: { in: ["SENDING", "QUEUED"] }, deletedAt: null },
        select: { id: true, name: true },
      });
      log.info({ count: activeCampaigns.length }, "[maintenance.worker] Lead top-up scan");
      const uncontactedCounts = await prisma.lead.groupBy({
        by: ["campaignId"],
        where: {
          campaignId: { in: activeCampaigns.map((c) => c.id) },
          deletedAt: null,
          outreachMessages: { none: {} },
        },
        _count: { _all: true },
      });
      const countMap = new Map(
        uncontactedCounts.map((r) => [r.campaignId, r._count._all])
      );
      let topUpQueued = 0;
      for (const campaign of activeCampaigns) {
        try {
          const uncontactedCount = countMap.get(campaign.id) ?? 0;
          if (uncontactedCount >= LOW_LEAD_THRESHOLD) continue;
          log.info(
            { campaignId: campaign.id, uncontactedCount, threshold: LOW_LEAD_THRESHOLD },
            "[maintenance.worker] Campaign low on leads — queuing top-up"
          );
          await maintenanceQueue.add(
            "top-up-leads",
            { campaignId: campaign.id },
            {
              jobId: `top-up-leads-${campaign.id}`,
              removeOnComplete: { age: 300 },
              removeOnFail: { age: 3600 },
            }
          );
          topUpQueued++;
        } catch (error) {
          log.error({ campaignId: campaign.id, error }, "[maintenance.worker] Failed to check/queue lead top-up");
        }
        try {
          await triggerAutoIcpRefinement(campaign.id);
        } catch (error) {
          log.error({ campaignId: campaign.id, error }, "[maintenance.worker] Auto ICP refinement check failed");
        }
      }
      return { checked: activeCampaigns.length, topUpQueued };
    }

    case "top-up-leads": {
      const { campaignId } = parseJobData(campaignIdSchema, job);
      if (await hasActivePipeline(campaignId)) {
        return { campaignId, skipped: true };
      }
      log.info({ campaignId }, "[maintenance.worker] Running lead top-up");
      const run = async (label: string, fn: () => Promise<unknown>) => {
        try {
          await withTimeout(fn(), AGENT_TIMEOUT_MS);
        } catch (error) {
          log.error({ campaignId, error }, `[maintenance.worker] top-up: ${label} failed`);
        }
      };
      await run("multi-source discovery", () => runMultiSourceDiscoveryAgent(campaignId));
      await run("linkedin discovery", () => runLinkedInDiscoveryAgent(campaignId));
      await run("community intent", () => runCommunityIntentAgent(campaignId));
      await run("lookalike agent", async () => {
        const camp = await prisma.campaign.findUnique({
          where: { id: campaignId },
          select: { createdById: true, enrichmentData: true },
        });
        if (!camp) return;
        const seeds = await resolveLookalikeSeeds(campaignId);
        const ed = camp.enrichmentData as Record<string, unknown> | null;
        const competitorTechUids = Array.isArray(ed?.competitorTechUids)
          ? (ed.competitorTechUids as string[])
          : undefined;
        if (seeds.urls.length > 0) {
          await runLookalikeAgent({
            campaignId,
            userId: camp.createdById,
            clientUrls: seeds.urls,
            competitorTechUids,
          });
        }
      });
      await run("research agent", () => runResearchAgent(campaignId));
      await run("bulk scoring", () => runBulkLeadScoringAgent(campaignId));
      await run("generate agent", () => runGenerateAgent(campaignId));
      await run("review agent", () => runReviewAgent(campaignId, { followUpPass: true }));
      log.info({ campaignId }, "[maintenance.worker] Lead top-up complete");
      return { campaignId };
    }

    case "discover-leads": {
      const { campaignId } = parseJobData(campaignIdSchema, job);
      if (await hasActivePipeline(campaignId)) {
        log.info({ campaignId }, "[maintenance.worker] discover-leads skipped — active pipeline running");
        return { campaignId, skipped: true };
      }
      log.info({ campaignId }, "[maintenance.worker] Starting initial lead discovery");
      const runDiscovery = async (label: string, fn: () => Promise<unknown>) => {
        try {
          await withTimeout(fn(), AGENT_TIMEOUT_MS);
        } catch (error) {
          log.error({ campaignId, error }, `[maintenance.worker] discover-leads: ${label} failed`);
        }
      };
      await runDiscovery("multi-source discovery", () => runMultiSourceDiscoveryAgent(campaignId));
      await runDiscovery("linkedin discovery", () => runLinkedInDiscoveryAgent(campaignId));
      await runDiscovery("community intent", () => runCommunityIntentAgent(campaignId));
      await runDiscovery("lookalike agent", async () => {
        const camp = await prisma.campaign.findUnique({
          where: { id: campaignId },
          select: { createdById: true, enrichmentData: true },
        });
        if (!camp) return;
        const seeds = await resolveLookalikeSeeds(campaignId);
        const ed = camp.enrichmentData as Record<string, unknown> | null;
        const competitorTechUids = Array.isArray(ed?.competitorTechUids)
          ? (ed.competitorTechUids as string[])
          : undefined;
        if (seeds.urls.length > 0) {
          await runLookalikeAgent({
            campaignId,
            userId: camp.createdById,
            clientUrls: seeds.urls,
            competitorTechUids,
          });
        }
      });
      await runDiscovery("research agent", () => runResearchAgent(campaignId));
      await runDiscovery("bulk scoring", () => runBulkLeadScoringAgent(campaignId));
      log.info({ campaignId }, "[maintenance.worker] Initial lead discovery complete");
      return { campaignId };
    }

    case "reset-daily-counts": {
      const now = new Date();
      let resetCount = 0;

      for (const row of await prisma.senderMailbox.findMany({ select: { id: true, timezone: true, lastResetAt: true } })) {
        if (row.lastResetAt < mostRecentLocalMidnightUtc(row.timezone, now)) {
          await prisma.senderMailbox.update({
            where: { id: row.id },
            data: { currentSent: 0, lastResetAt: now },
            select: { id: true },
          });
          resetCount++;
        }
      }
      for (const row of await prisma.senderDomain.findMany({ select: { id: true, timezone: true, lastResetAt: true } })) {
        if (row.lastResetAt < mostRecentLocalMidnightUtc(row.timezone, now)) {
          await prisma.senderDomain.update({ where: { id: row.id }, data: { currentSent: 0, lastResetAt: now } });
          resetCount++;
        }
      }

      const utcMidnight = mostRecentLocalMidnightUtc("UTC", now);
      const seedResetResult = await prisma.seedMailbox.updateMany({
        where: { lastResetAt: { lt: utcMidnight } },
        data: { usedToday: 0, lastResetAt: now },
      });
      resetCount += seedResetResult.count;

      log.info({ resetCount }, "[maintenance.worker] Per-row daily send count refresh complete");
      return { resetCount };
    }

    case "recover-stuck-sending": {
      const stuckBefore = new Date(Date.now() - STUCK_SENDING_TIMEOUT_MS);
      const stuckMessages = await prisma.outreachMessage.findMany({
        where: {
          deliveryState: "SENDING",
          updatedAt: { lt: stuckBefore },
          externalMessageId: null,
          retryCount: { lt: MAX_SEND_RETRIES },
        },
        select: { lead: { select: { campaignId: true } } },
      });
      const affectedCampaignIds = [...new Set(stuckMessages.map((m) => m.lead.campaignId))];
      const recovered = await prisma.outreachMessage.updateMany({
        where: {
          deliveryState: "SENDING",
          updatedAt: { lt: stuckBefore },
          externalMessageId: null,
          retryCount: { lt: MAX_SEND_RETRIES },
        },
        data: { deliveryState: "QUEUED", claimToken: null, retryCount: { increment: 1 } },
      });
      const exhausted = await prisma.outreachMessage.updateMany({
        where: {
          deliveryState: "SENDING",
          updatedAt: { lt: stuckBefore },
          externalMessageId: null,
          retryCount: { gte: MAX_SEND_RETRIES },
        },
        data: { deliveryState: "FAILED", claimToken: null },
      });
      log.info({ recovered: recovered.count, failed: exhausted.count }, "[maintenance.worker] Recovered stuck SENDING messages");
      const recoverableCampaigns = await prisma.campaign.findMany({
        where: { id: { in: affectedCampaignIds }, senderMailboxId: { not: null } },
        select: { id: true },
      });
      for (let i = 0; i < recoverableCampaigns.length; i++) {
        const campaign = recoverableCampaigns[i];
        const jitterMs = i * 30_000 + Math.floor(Math.random() * 60_000);
        try {
          await sendQueue.add(
            "send-batch",
            { campaignId: campaign.id },
            {
              jobId: `send-batch-${campaign.id}`,
              priority: 1,
              delay: jitterMs,
              removeOnComplete: { age: 300 },
              removeOnFail: { age: 3600 },
            }
          );
        } catch (error) {
          log.error({ campaignId: campaign.id, error }, "[maintenance.worker] Failed to enqueue send-batch after recovery");
        }
      }
      const stuckSendingCampaigns = await prisma.campaign.findMany({
        where: {
          status: "SENDING",
          deletedAt: null,
          leads: {
            none: {
              outreachMessages: {
                some: { deliveryState: "SENDING" },
              },
            },
          },
        },
        select: { id: true },
      });
      if (stuckSendingCampaigns.length > 0) {
        const stuckSendingIds = stuckSendingCampaigns.map((c) => c.id);
        await prisma.campaign.updateMany({
          where: { id: { in: stuckSendingIds } },
          data: { status: "QUEUED" },
        });
        log.warn(
          { count: stuckSendingCampaigns.length, ids: stuckSendingIds },
          "[maintenance.worker] Reset campaigns stuck in SENDING (no active SENDING messages) → QUEUED",
        );
      }

      const campaignStuckBefore = new Date(Date.now() - STUCK_CAMPAIGN_TIMEOUT_MS);
      const stuckCampaigns = await prisma.campaign.updateMany({
        where: {
          status: { in: ["GENERATING", "RESEARCHING"] },
          updatedAt: { lt: campaignStuckBefore },
          deletedAt: null,
        },
        data: { status: "FAILED" },
      });
      if (stuckCampaigns.count > 0) {
        log.warn({ count: stuckCampaigns.count }, "[maintenance.worker] Reset stuck GENERATING/RESEARCHING campaigns to FAILED");
      }
      const queueJobStuckBefore = new Date(Date.now() - STUCK_QUEUE_JOB_TIMEOUT_MS);
      const stalledJobRows = await prisma.queueJob.findMany({
        where: { status: "ACTIVE", updatedAt: { lt: queueJobStuckBefore } },
        select: { id: true, payload: true },
      });
      if (stalledJobRows.length > 0) {
        await prisma.queueJob.updateMany({
          where: { status: "ACTIVE", updatedAt: { lt: queueJobStuckBefore } },
          data: {
            status: "FAILED",
            errorMessage: "Reconciled by recovery job: row remained ACTIVE beyond threshold — probable worker crash",
          },
        });
        const capacityReleases = new Map<string, number>();
        for (const job of stalledJobRows) {
          const p = job.payload as Record<string, unknown>;
          if (
            p?.reservedCapacity &&
            p?.mailboxId &&
            typeof p.reservedCapacity === "number" &&
            typeof p.mailboxId === "string"
          ) {
            capacityReleases.set(p.mailboxId, (capacityReleases.get(p.mailboxId) ?? 0) + p.reservedCapacity);
          }
        }
        await Promise.all(
          Array.from(capacityReleases.entries()).map(([mailboxId, amount]) =>
            prisma.senderMailbox.update({
              where: { id: mailboxId },
              data: { currentSent: { decrement: amount } },
              select: { id: true },
            }).catch(() => null)
          )
        );
        log.warn({ count: stalledJobRows.length }, "[maintenance.worker] Reconciled stale ACTIVE QueueJob rows → FAILED");
      }
      return {
        recovered: recovered.count,
        failed: exhausted.count,
        stuckCampaigns: stuckCampaigns.count,
        stalledQueueJobs: stalledJobRows.length,
      };
    }

    case "recover-stuck-sequence-steps": {
      const stuckBefore = new Date(Date.now() - STUCK_STEP_TIMEOUT_MS);

      const recovered = await prisma.leadStepStatus.updateMany({
        where: {
          status: "EXECUTING",
          updatedAt: { lt: stuckBefore },
          retryCount: { lt: MAX_STEP_RETRIES },
        },
        data: {
          status: "SCHEDULED",
          scheduledAt: new Date(Date.now() + 60_000),
          retryCount: { increment: 1 },
          errorMsg: "Recovered from stuck EXECUTING state",
        },
      });

      const exhausted = await prisma.leadStepStatus.updateMany({
        where: {
          status: "EXECUTING",
          updatedAt: { lt: stuckBefore },
          retryCount: { gte: MAX_STEP_RETRIES },
        },
        data: {
          status: "FAILED",
          errorMsg: `Abandoned after ${MAX_STEP_RETRIES} recovery attempts`,
        },
      });

      log.info(
        { recovered: recovered.count, failed: exhausted.count },
        "[maintenance.worker] Recovered stuck EXECUTING sequence steps",
      );

      return { recovered: recovered.count, failed: exhausted.count };
    }

    case "cleanup-old-queue-jobs": {
      log.info("[maintenance.worker] Starting nightly log retention and queue job purge");
      const purgeResults = await runLogRetentionPurge();
      log.info({ purgeResults }, "[maintenance.worker] Completed nightly log retention and queue job purge");
      return purgeResults;
    }

    case "scan-linkedin-steps": {
      const campaigns = await prisma.campaign.findMany({
        where: {
          status: { in: ["QUEUED", "SENDING", "COMPLETED"] },
          deletedAt: null,
          linkedInAccountId: { not: null },
        },
        select: { id: true },
        take: SCHEDULER_CAMPAIGN_BATCH_SIZE,
        orderBy: { updatedAt: "asc" },
      });
      log.info({ count: campaigns.length }, "[maintenance.worker] LinkedIn step tick — dispatching per-campaign jobs");
      let queued = 0;
      for (const campaign of campaigns) {
        try {
          await linkedinQueue.add(
            "run-linkedin-outreach",
            { campaignId: campaign.id },
            {
              jobId: `linkedin-outreach-${campaign.id}`,
              removeOnComplete: { age: 300 },
              removeOnFail: { age: 3600 },
            }
          );
          queued++;
        } catch (error) {
          log.error({ campaignId: campaign.id, error }, "[maintenance.worker] Failed to queue LinkedIn outreach");
        }
      }
      return { scanned: campaigns.length, queued };
    }

    case "scan-email-sequence-steps": {
      const campaigns = await prisma.campaign.findMany({
        where: {
          status: { in: ["QUEUED", "SENDING", "COMPLETED"] },
          deletedAt: null,
        },
        select: { id: true },
        take: SCHEDULER_CAMPAIGN_BATCH_SIZE,
        orderBy: { updatedAt: "asc" },
      });
      log.info({ count: campaigns.length }, "[maintenance.worker] Email sequence step tick — dispatching per-campaign jobs");
      let queued = 0;
      for (const campaign of campaigns) {
        try {
          await realtimeQueue.add(
            "run-email-sequence",
            { campaignId: campaign.id },
            {
              jobId: `email-sequence-${campaign.id}`,
              removeOnComplete: { age: 300 },
              removeOnFail: { age: 3600 },
            }
          );
          queued++;
        } catch (error) {
          log.error({ campaignId: campaign.id, error }, "[maintenance.worker] Failed to queue email sequence");
        }
      }
      return { scanned: campaigns.length, queued };
    }

    case "populate-tech-signals": {
      const { campaignId } = parseJobData(campaignIdSchema, job);
      const campaignRecord = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { qualificationThreshold: true },
      });
      const threshold =
        typeof campaignRecord?.qualificationThreshold === "number" &&
          campaignRecord.qualificationThreshold >= 0 &&
          campaignRecord.qualificationThreshold <= 1
          ? campaignRecord.qualificationThreshold
          : 0.40;
      const qualifiedLeads = await prisma.lead.findMany({
        where: {
          campaignId,
          deletedAt: null,
          website: { not: null },
          recommendedAction: { not: "DISQUALIFY" },
          qualificationScore: { gte: threshold },
        },
        select: { companyId: true, website: true },
      });
      const domainMap = new Map<string, string>();
      for (const lead of qualifiedLeads) {
        if (lead.companyId && lead.website) {
          const domain = extractDomain(lead.website);
          if (domain && !domainMap.has(lead.companyId)) {
            domainMap.set(lead.companyId, domain);
          }
        }
      }
      if (domainMap.size > 0) {
        await populateTechSignals(
          Array.from(domainMap.entries()).map(([companyId, domain]) => ({ companyId, domain })),
        );
      }
      return { campaignId, companies: domainMap.size };
    }

    case "gdpr-data-purge": {
      const retentionDays = Math.max(
        1,
        parseInt(process.env.GDPR_DATA_RETENTION_DAYS ?? "730", 10)
      );
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60_000);

      const EU_COUNTRY_CODES = new Set([
        "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
        "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT",
        "NL", "PL", "PT", "RO", "SE", "SI", "SK",
        "IS", "LI", "NO",
        "GB",
      ]);

      let purgedCount = 0;
      let cursor: string | undefined;
      const PAGE = 500;

      while (true) {
        const leads = await prisma.lead.findMany({
          where: {
            createdAt: { lt: cutoff },
            deletedAt: { not: null },
          },
          select: { id: true, enrichmentData: true },
          take: PAGE,
          ...(cursor && { skip: 1, cursor: { id: cursor } }),
          orderBy: { id: "asc" },
        });

        if (leads.length === 0) break;

        const euLeadIds = leads
          .filter((l) => {
            const ed = l.enrichmentData as Record<string, unknown> | null;
            const raw = typeof ed?.country === "string" ? ed.country.trim().toUpperCase() : null;
            if (!raw) return false;
            const code = raw.length === 2 ? raw : null;
            return code !== null && EU_COUNTRY_CODES.has(code);
          })
          .map((l) => l.id);

        if (euLeadIds.length > 0) {
          await prisma.lead.updateMany({
            where: { id: { in: euLeadIds } },
            data: {
              firstName: null,
              lastName: null,
              email: null,
              title: null,
              linkedinUrl: null,
              enrichmentData: {},
            },
          });
          purgedCount += euLeadIds.length;
        }

        if (leads.length < PAGE) break;
        cursor = leads[leads.length - 1].id;
      }

      log.info({ retentionDays, cutoff, purgedCount }, "[maintenance.worker] GDPR data purge complete");
      return { retentionDays, purgedCount };
    }

    case "llm-budget-check": {
      if (!process.env.LLM_MONTHLY_BUDGET_USD) {
        log.debug("[maintenance.worker] LLM_MONTHLY_BUDGET_USD not set — budget check skipped");
        return { skipped: true };
      }

      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const orgIds = await prisma.campaign.groupBy({
        by: ["orgId"],
        where: {
          aiTraces: { some: { createdAt: { gte: monthStart } } },
        },
        _count: { id: true },
      });

      let warned = 0;
      let paused = 0;

      for (const { orgId } of orgIds) {
        if (!orgId) continue;
        const result = await checkOrgSpend(orgId);

        if (result.exceeded) {
          log.error(
            { orgId, spentUsd: result.spentUsd, budgetUsd: result.budgetUsd },
            "[maintenance.worker] LLM monthly budget EXCEEDED — pausing all active campaigns for org"
          );
          const { count } = await prisma.campaign.updateMany({
            where: { orgId, status: { in: ["SENDING", "QUEUED"] } },
            data: { status: "PAUSED" },
          });
          paused += count;
        } else if (result.warning) {
          log.warn(
            { orgId, spentUsd: result.spentUsd, budgetUsd: result.budgetUsd },
            "[maintenance.worker] LLM monthly spend above 80% of budget"
          );
          warned++;
        }
      }

      log.info({ orgsChecked: orgIds.length, warned, paused }, "[maintenance.worker] LLM budget check complete");
      return { orgsChecked: orgIds.length, warned, paused };
    }

    case "recover-dlq": {
      // ── Operation lease recovery ──────────────────────────────────────────
      // Transition RUNNING operations with expired leases → RECOVERABLE so
      // the next worker pick-up can safely re-acquire.
      const now = new Date();
      const expiredLeaseOps = await prisma.operation.findMany({
        where: {
          status: "RUNNING",
          leaseExpiresAt: { lt: now },
        },
        select: { operationId: true, aggregateId: true, operationType: true },
        take: 200,
      });

      let leaseRecovered = 0;
      if (expiredLeaseOps.length > 0) {
        const { count } = await prisma.operation.updateMany({
          where: {
            operationId: { in: expiredLeaseOps.map((o) => o.operationId) },
            status: "RUNNING",
            leaseExpiresAt: { lt: now },
          },
          data: { status: "RECOVERABLE", leaseOwner: null, leaseExpiresAt: null },
        });
        leaseRecovered = count;
        log.warn(
          { leaseRecovered, ops: expiredLeaseOps.map((o) => o.operationId) },
          "[maintenance.worker] recover-dlq: Transitioned expired-lease RUNNING ops → RECOVERABLE",
        );
      }

      // ── SendIntent dispatch recovery ──────────────────────────────────────
      // Find SendIntent records stuck in DISPATCHING for >10 min — these
      // indicate a crash between provider acceptance and DB commit.
      const stuckSendIntentCutoff = new Date(Date.now() - 10 * 60_000);
      const stuckIntents = await prisma.sendIntent.findMany({
        where: {
          status: "DISPATCHING",
          updatedAt: { lt: stuckSendIntentCutoff },
        },
        select: { idempotencyKey: true, outreachMessageId: true, leadId: true },
        take: 100,
      });

      let intentReconciled = 0;
      if (stuckIntents.length > 0) {
        // Batch-fetch all affected OutreachMessages in one round-trip
        const msgIds = stuckIntents.map((i) => i.outreachMessageId);
        const messages = await prisma.outreachMessage.findMany({
          where: { id: { in: msgIds } },
          select: { id: true, deliveryState: true, externalMessageId: true },
        });
        const msgMap = new Map(messages.map((m) => [m.id, m]));

        // Partition intents: ACCEPTED (provider confirmed) vs UNKNOWN (re-attempt)
        const acceptedKeys: string[] = [];
        const acceptedProviderIds = new Map<string, string>(); // key → providerMessageId
        const unknownKeys: string[] = [];
        const unknownLeadIds: string[] = [];

        for (const intent of stuckIntents) {
          const msg = msgMap.get(intent.outreachMessageId);
          if (msg?.deliveryState === "SENT" && msg.externalMessageId) {
            acceptedKeys.push(intent.idempotencyKey);
            acceptedProviderIds.set(intent.idempotencyKey, msg.externalMessageId);
          } else {
            unknownKeys.push(intent.idempotencyKey);
            unknownLeadIds.push(intent.leadId);
          }
        }

        // Two bounded set-based writes — run in parallel
        const [acceptedResult, unknownResult] = await Promise.all([
          acceptedKeys.length > 0
            ? prisma.sendIntent.updateMany({
                where: {
                  idempotencyKey: { in: acceptedKeys },
                  status: "DISPATCHING", // guard: only advance if still stuck
                },
                data: { status: "ACCEPTED", updatedAt: new Date() },
              })
            : Promise.resolve({ count: 0 }),
          unknownKeys.length > 0
            ? prisma.sendIntent.updateMany({
                where: {
                  idempotencyKey: { in: unknownKeys },
                  status: "DISPATCHING",
                },
                data: { status: "UNKNOWN", updatedAt: new Date() },
              })
            : Promise.resolve({ count: 0 }),
        ]);

        intentReconciled = acceptedResult.count;

        if (unknownResult.count > 0) {
          log.warn(
            { unknownCount: unknownResult.count, leadIds: unknownLeadIds },
            "[maintenance.worker] recover-dlq: DISPATCHING SendIntent outcome unknown — marked UNKNOWN for re-attempt",
          );
        }
      }

      log.info(
        { leaseRecovered, intentReconciled, stuckIntents: stuckIntents.length },
        "[maintenance.worker] recover-dlq: Complete",
      );
      return { leaseRecovered, intentReconciled };
    }

    case "reconcile-operations": {
      log.info("[maintenance.worker] Running operation lease reconciliation");
      const result = await reconcileOperations();
      log.info({ ...result }, "[maintenance.worker] Operation reconciliation complete");
      return result;
    }

    case "reconcile-send-intents": {
      // Sprint 4: replaces the legacy reconcileSendIntents().
      // Two sweepers run in sequence each tick:
      //   1. stale-lease recovery — expires DISPATCHING intents with dead leases
      //   2. UNKNOWN reconciliation — resolves ambiguous delivery outcomes
      log.info("[maintenance.worker] Running Sprint 4 stale-lease + UNKNOWN sweepers");
      const staleResult = await sweepStaleLeases();
      log.info({ ...staleResult }, "[maintenance.worker] Stale-lease sweep complete");
      const unknownResult = await sweepUnknownIntents();
      log.info({ ...unknownResult }, "[maintenance.worker] UNKNOWN reconciliation sweep complete");
      return { staleLease: staleResult, unknown: unknownResult };
    }

    case "sweep-stale-leases": {
      log.info("[maintenance.worker] Running stale-lease recovery sweeper (on-demand)");
      const result = await sweepStaleLeases();
      log.info({ ...result }, "[maintenance.worker] Stale-lease sweep complete");
      return result;
    }

    case "sweep-unknown-intents": {
      // Triggered by outbox SEND_INTENT_UNKNOWN events via the relay.
      log.info("[maintenance.worker] Running UNKNOWN reconciliation sweeper (event-triggered)");
      const result = await sweepUnknownIntents();
      log.info({ ...result }, "[maintenance.worker] UNKNOWN sweep complete");
      return result;
    }

    case "handle-send-intent-sent":
    case "handle-send-intent-failed": {
      // OutboxEvent relay delivers SEND_INTENT_SENT / SEND_INTENT_FAILED here.
      // At this point the DB is already in terminal state (finalizeSendIntent committed).
      // This handler is the extension point for downstream reactions:
      //   - lead state machine advancement
      //   - reply-poll scheduling
      //   - CRM sync
      // Currently a structured log + no-op; replace with lead FSM call when ready.
      const { outboxEventId, eventType, aggregateId, payload } = job.data;
      log.info(
        { outboxEventId, eventType, sendIntentId: aggregateId, payload },
        `[maintenance.worker] ${job.name}: SendIntent terminal event received — downstream handlers pending`,
      );
      return { handled: true, outboxEventId, eventType };
    }

    case "handle-send-intent-human-review": {
      const { outboxEventId, payload } = job.data;
      log.error(
        { outboxEventId, payload },
        "[maintenance.worker] 🚨 SEND_INTENT_HUMAN_REVIEW_REQUIRED — operator must manually confirm delivery and settle quota",
      );
      return { handled: true, outboxEventId };
    }

    case "handle-outbox-event": {
      // Generic handler for unrecognised outbox event types — structured log only.
      const { outboxEventId, eventType, aggregateType, aggregateId } = job.data;
      log.info(
        { outboxEventId, eventType, aggregateType, aggregateId },
        "[maintenance.worker] Unhandled outbox event type received — no-op",
      );
      return { handled: false, outboxEventId, eventType };
    }

    case "reconcile-quota": {
      log.info("[maintenance.worker] Running quota reservation reconciliation");
      const result = await reconcileQuotaReservations();
      log.info({ ...result }, "[maintenance.worker] Quota reconciliation complete");
      return result;
    }

    case "reconcile-message-claims": {
      log.info("[maintenance.worker] Running message claim reconciliation");
      const result = await reconcileMessageClaims();
      log.info({ ...result }, "[maintenance.worker] Message claim reconciliation complete");
      return result;
    }

    case "reconcile-outbox": {
      // Sprint 4: replaces the legacy reconcileOutboxEvents().
      // Sweeps PENDING OutboxEvents and publishes to BullMQ for downstream processing.
      log.info("[maintenance.worker] Running outbox relay sweeper");
      const result = await sweepOutboxEvents();
      log.info({ ...result }, "[maintenance.worker] Outbox relay sweep complete");
      return result;
    }

    case "recover-failed-proposal-persistences": {
      log.info("[maintenance.worker] Running proposal persistence recovery sweeper");
      const result = await sweepFailedProposalPersistences();
      log.info({ ...result }, "[maintenance.worker] Proposal persistence recovery complete");
      return result;
    }

    default:
      throw new Error(`[maintenance.worker] Unknown job type: ${job.name}`);

  }
}

export const maintenanceWorker = new Worker(policy.queueName, processJob, {
  connection: redisConnectionOptions,
  concurrency: policy.concurrency,
  lockDuration: policy.lockDuration,
});

wireWorkerEvents(maintenanceWorker, policy.queueName);