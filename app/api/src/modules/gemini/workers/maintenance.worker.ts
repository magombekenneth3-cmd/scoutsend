import { Worker } from "bullmq";
import { prisma } from "../../../lib/prisma";
import { createRedisConnection } from "../../../lib/ioredis";
import { QUEUE_POLICY } from "../queue-policy";
import { wireWorkerEvents } from "../worker-runtime";
import { logger } from "../../../lib/logger";
import { runHealthCheckAllCampaigns } from "../campaign-health.agent";
import { runWarmupAgent } from "../warmup.agent";
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
import { pruneOldAITraces } from "../../AItrace/Aitrace.service";
import { populateTechSignals } from "../discoveryLib/builtWith";
import { extractDomain } from "../../../lib/company/company.upsert";
import { mostRecentLocalMidnightUtc } from "../../../lib/daily-quota";
import { sendQueue, realtimeQueue, linkedinQueue, maintenanceQueue } from "../campaign.queue";

const policy = QUEUE_POLICY.maintenance;

const LOW_LEAD_THRESHOLD = 10;
const MAX_SEND_RETRIES = 5;
const FOLLOWUP_CAMPAIGN_CUTOFF_MS = 30 * 24 * 60 * 60_000;
const STUCK_SENDING_TIMEOUT_MS = 10 * 60_000;
const STUCK_CAMPAIGN_TIMEOUT_MS = 6 * 60 * 60_000;
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
      }
      return { checked: activeCampaigns.length, topUpQueued };
    }

    case "top-up-leads": {
      const { campaignId } = job.data as { campaignId: string };
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
      const { campaignId } = job.data as { campaignId: string };
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
          await prisma.senderMailbox.update({ where: { id: row.id }, data: { currentSent: 0, lastResetAt: now } });
          resetCount++;
        }
      }
      for (const row of await prisma.senderDomain.findMany({ select: { id: true, timezone: true, lastResetAt: true } })) {
        if (row.lastResetAt < mostRecentLocalMidnightUtc(row.timezone, now)) {
          await prisma.senderDomain.update({ where: { id: row.id }, data: { currentSent: 0, lastResetAt: now } });
          resetCount++;
        }
      }

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
      for (const campaign of recoverableCampaigns) {
        try {
          await sendQueue.add(
            "send-batch",
            { campaignId: campaign.id },
            {
              jobId: `send-batch-${campaign.id}`,
              priority: 1,
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
        for (const job of stalledJobRows) {
          const p = job.payload as Record<string, unknown>;
          if (
            p?.reservedCapacity &&
            p?.mailboxId &&
            typeof p.reservedCapacity === "number" &&
            typeof p.mailboxId === "string"
          ) {
            await prisma.senderMailbox.update({
              where: { id: p.mailboxId },
              data: { currentSent: { decrement: p.reservedCapacity } },
            }).catch(() => null);
          }
        }
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
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60_000);
      const { count } = await prisma.queueJob.deleteMany({
        where: {
          status: { in: ["COMPLETED", "FAILED", "WAITING", "PAUSED"] },
          createdAt: { lt: thirtyDaysAgo },
        },
      });
      const deletedAitraces = await pruneOldAITraces(30);
      log.info({ deletedQueueJobs: count, deletedAitraces }, "[maintenance.worker] Deleted old records");
      return { deletedQueueJobs: count, deletedAitraces };
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
      const { campaignId } = job.data as { campaignId: string };
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

    default:
      throw new Error(`[maintenance.worker] Unknown job type: ${job.name}`);
  }
}

export const maintenanceWorker = new Worker(policy.queueName, processJob, {
  connection: createRedisConnection(),
  concurrency: policy.concurrency,
  lockDuration: policy.lockDuration,
});

wireWorkerEvents(maintenanceWorker, policy.queueName);
