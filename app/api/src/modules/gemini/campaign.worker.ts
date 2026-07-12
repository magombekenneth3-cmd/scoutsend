import { prisma } from "@/app/api/src/lib/prisma";
import { Worker, Job } from "bullmq";
import { processReplyAI } from "../replies/replies.services";
import { runBatchEmailEnrichmentAgent, runEmailEnrichmentAgent } from "./email-enrichment.agent";
import { runLeadScoringAgent } from "./lead-scoring.agent";
import { logger } from "@/app/api/src/lib/logger";
import { mostRecentLocalMidnightUtc } from "../../lib/daily-quota";
import { createRedisConnection, redis } from "../../lib/ioredis";
import { enqueueEnrichmentBatches } from "./email-enrichment.queue";
import { extractDomain } from "../../lib/company/company.upsert";
import { campaignQueue, realtimeQueue } from "./campaign.queue";
import pLimit from "p-limit";

import { runSendAgent } from "./send.agent";
import { runCampaign, pauseCampaign, resumeCampaign } from "./orchestration.service";
import { runFollowUpAgent } from "./followup.agent";
import { runResearchAgent } from "./gemini.agent";
import { runGenerateAgent } from "./generate.agent";
import { runReviewAgent } from "./review.agent";
import { runWarmupAgent } from "./warmup.agent";
import { runIcpRefinementAgent } from "./icp.refinementAgent";
import { runObjectionHandlerForCampaign } from "./objection-handler.agent";
import { pollAllMailboxes, pollMailboxReplies } from "../replies/replyPoller";
import { pollAllMailboxDeliveryEvents, pollMailboxDeliveryEvents } from "../webhook/deliverypoll";
import { runMultiSourceDiscoveryAgent } from "./multi-source-discovery.agent";
import { populateTechSignals } from "./discoveryLib/builtWith";
import { runLinkedInDiscoveryAgent } from "./linkedin-discovery.agent";
import { runJobIntelAgent } from "./job-intel.agent";
import { runCommunityIntentAgent } from "./community-intent.agent";
import { runTechDetectionAgent } from "./tech-detection.agent";
import { runBulkLeadScoringAgent, runBatchLeadScoringAgent } from "./lead-scoring.agent";
import { runEnrichmentRefreshAgent } from "./enrichment-refreshment.agent";
import { runHealthCheckAllCampaigns } from "./campaign-health.agent";
import { emitCampaignEvent, getJobLabel } from "../../lib/campaign-events";
import { runLookalikeAgent } from "@/agents/lookAlike/lookalike.agent";
import { resolveLookalikeSeeds } from "../lookalike/seed-resolver";
import { pruneOldAITraces } from "../AItrace/Aitrace.service";
import { runLinkedInOutreachAgent } from "../gemini/linkedin-outreach.agent";
import { runEmailSequenceAgent } from "./email-sequence.agent";
import { generateReplyDraft } from "../replies/replies.services";
import { ingestLeadSignal } from "./signal-ingestion.agent";
import { runLeadAgent } from "./lead-agent.agent";
import { enrichThenScore } from "./enrichToScore";
import { runEnrichmentWaterfall } from "./enrichment-waterfall.agent";

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
const SIGNAL_ACCELERATE_CAMPAIGN_LOCK_TTL_MS = 30 * 60_000;

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



async function processJob(job: Job) {
    switch (job.name) {
      case "process-reply-ai": {
        const { replyId } = job.data as { replyId: string };
        await processReplyAI(replyId);
        return { replyId };
      }

      case "score-lead": {
        const { leadId, campaignId, icpDescription } = job.data as {
          leadId: string;
          campaignId: string;
          icpDescription: string;
        };
        await runLeadScoringAgent(leadId, icpDescription);
        const scored = await prisma.lead.findUnique({
          where: { id: leadId },
          select: { recommendedAction: true, qualificationScore: true },
        });
        if (!scored || scored.recommendedAction === "DISQUALIFY" || (scored.qualificationScore !== null && scored.qualificationScore < 0.40)) {
          return { leadId, disqualified: true };
        }
        await enqueueEnrichmentBatches([leadId], campaignId);
        return { leadId };
      }

      case "score-lead-batch": {
        const { leadIds, campaignId, icpDescription } = job.data as {
          leadIds: string[];
          campaignId: string;
          icpDescription: string;
        };
        const qualifiedLeadIds: string[] = [];
        for (const leadId of leadIds) {
          try {
            await runLeadScoringAgent(leadId, icpDescription);
            const scored = await prisma.lead.findUnique({
              where: { id: leadId },
              select: { recommendedAction: true, qualificationScore: true },
            });
            if (scored && scored.recommendedAction !== "DISQUALIFY" && (scored.qualificationScore === null || scored.qualificationScore >= 0.40)) {
              qualifiedLeadIds.push(leadId);
            }
          } catch (err) {
            logger.warn({ err, leadId }, "[campaign.worker] score-lead-batch: scoring failed for lead");
          }
        }
        if (qualifiedLeadIds.length > 0) {
          await enqueueEnrichmentBatches(qualifiedLeadIds, campaignId);
        }
        return { campaignId, total: leadIds.length, qualified: qualifiedLeadIds.length };
      }

      case "enrich-lead-batch": {
        const { leadIds, campaignId } = job.data as {
          leadIds: string[];
          campaignId: string;
        };

        const { enriched, scored, failed } = await enrichThenScore(leadIds, campaignId);

        return { campaignId, total: leadIds.length, enriched, scored, failed };
      }

      case "signal-accelerate-lead": {
        const { leadId, campaignId, signalType, confidence, source } = job.data as {
          leadId: string;
          campaignId: string;
          signalType: string;
          confidence: number;
          source: string;
        };

        const leadLockKey = `signal-accelerate-lock:${leadId}`;
        const campaignLockKey = `campaign-pipeline-lock:${campaignId}`;

        const leadLockAcquired = await redis.set(leadLockKey, "1", "PX", 5 * 60_000, "NX");
        if (!leadLockAcquired) {
          logger.info({ leadId, signalType }, "[signal-ingestion] Concurrent acceleration already running for lead — skipping");
          return { leadId, skipped: true, reason: "concurrent_lock" };
        }

        const campaignLockAcquired = await redis.set(campaignLockKey, "1", "PX", SIGNAL_ACCELERATE_CAMPAIGN_LOCK_TTL_MS, "NX");
        if (!campaignLockAcquired) {
          await redis.del(leadLockKey);
          logger.info({ leadId, campaignId, signalType }, "[signal-ingestion] Campaign pipeline busy — deferring signal acceleration");
          return { leadId, skipped: true, reason: "campaign_pipeline_busy" };
        }

        try {
          logger.info(
            { leadId, campaignId, signalType, confidence, source },
            "[signal-ingestion] Accelerating lead pipeline due to high-value signal",
          );

          await withTimeout(
            enrichThenScore([leadId], campaignId),
            AGENT_TIMEOUT_MS * 2,
          );

          const lead = await prisma.lead.findUnique({
            where: { id: leadId },
            select: {
              qualificationScore: true,
              recommendedAction: true,
              campaign: { select: { icpDescription: true, qualificationThreshold: true } },
            },
          });

          const threshold =
            typeof lead?.campaign?.qualificationThreshold === "number" &&
              lead.campaign.qualificationThreshold >= 0 &&
              lead.campaign.qualificationThreshold <= 1
              ? lead.campaign.qualificationThreshold
              : 0.40;

          if (
            !lead ||
            lead.recommendedAction === "DISQUALIFY" ||
            (lead.qualificationScore !== null && lead.qualificationScore < threshold)
          ) {
            logger.info({ leadId, threshold }, "[signal-ingestion] Lead below threshold post-signal — skipping");
            return { leadId, skipped: true, reason: "below_threshold" };
          }

          await withTimeout(runResearchAgent(campaignId, leadId), AGENT_TIMEOUT_MS);
          await withTimeout(runGenerateAgent(campaignId), AGENT_TIMEOUT_MS);
          await withTimeout(runReviewAgent(campaignId, { followUpPass: true }), AGENT_TIMEOUT_MS);

          await prisma.queueJob.updateMany({
            where: {
              campaignId,
              jobType: "SIGNAL_ACCELERATE",
              status: "WAITING",
              payload: { path: ["leadId"], equals: leadId },
            },
            data: { status: "COMPLETED" },
          }).catch(() => null);

          logger.info(
            { leadId, campaignId, signalType },
            "[signal-ingestion] Accelerated pipeline complete",
          );

          return { leadId, campaignId, signalType };
        } finally {
          await redis.del(campaignLockKey);
          await redis.del(leadLockKey);
        }
      }

      case "nightly-multi-source-discovery": {
        const campaigns = await prisma.campaign.findMany({
          where: { status: { in: ["QUEUED", "SENDING"] }, deletedAt: null },
          select: { id: true },
        });
        logger.info({ count: campaigns.length }, "[scheduler] Dispatching nightly multi-source discovery");
        let queued = 0;
        for (const campaign of campaigns) {
          try {
            await campaignQueue.add(
              "nightly-discovery-campaign",
              { campaignId: campaign.id },
              {
                jobId: `nightly-discovery-${campaign.id}`,
                removeOnComplete: { age: 300 },
                removeOnFail: { age: 3600 },
              }
            );
            queued++;
          } catch (error) {
            logger.error({ campaignId: campaign.id, error }, "[scheduler] Failed to queue nightly discovery");
          }
        }
        return { queued };
      }

      case "nightly-discovery-campaign": {
        const { campaignId } = job.data as { campaignId: string };
        if (await hasActivePipeline(campaignId)) {
          return { campaignId, skipped: true };
        }
        logger.info({ campaignId }, "[scheduler] Running nightly discovery");
        await runMultiSourceDiscoveryAgent(campaignId);
        await runLinkedInDiscoveryAgent(campaignId);
        return { campaignId };
      }

      case "nightly-community-intent": {
        const campaigns = await prisma.campaign.findMany({
          where: { status: { in: ["QUEUED", "SENDING"] }, deletedAt: null },
          select: { id: true },
        });
        logger.info({ count: campaigns.length }, "[scheduler] Dispatching nightly community intent");
        let queued = 0;
        for (const campaign of campaigns) {
          try {
            await campaignQueue.add(
              "nightly-community-campaign",
              { campaignId: campaign.id },
              {
                jobId: `nightly-community-${campaign.id}`,
                removeOnComplete: { age: 300 },
                removeOnFail: { age: 3600 },
              }
            );
            queued++;
          } catch (error) {
            logger.error({ campaignId: campaign.id, error }, "[scheduler] Failed to queue nightly community intent");
          }
        }
        return { queued };
      }

      case "nightly-community-campaign": {
        const { campaignId } = job.data as { campaignId: string };
        if (await hasActivePipeline(campaignId)) {
          return { campaignId, skipped: true };
        }
        logger.info({ campaignId }, "[scheduler] Running nightly community intent");
        await runCommunityIntentAgent(campaignId);
        return { campaignId };
      }

      case "nightly-enrichment-refresh": {
        const campaigns = await prisma.campaign.findMany({
          where: { status: { in: ["QUEUED", "SENDING", "RESEARCHING"] }, deletedAt: null },
          select: { id: true },
        });
        logger.info({ count: campaigns.length }, "[scheduler] Dispatching nightly enrichment refresh");
        let queued = 0;
        for (const campaign of campaigns) {
          try {
            await campaignQueue.add(
              "nightly-enrichment-campaign",
              { campaignId: campaign.id },
              {
                jobId: `nightly-enrichment-${campaign.id}`,
                removeOnComplete: { age: 300 },
                removeOnFail: { age: 3600 },
              }
            );
            queued++;
          } catch (error) {
            logger.error({ campaignId: campaign.id, error }, "[scheduler] Failed to queue nightly enrichment");
          }
        }
        return { queued };
      }

      case "nightly-enrichment-campaign": {
        const { campaignId } = job.data as { campaignId: string };
        if (await hasActivePipeline(campaignId)) {
          return { campaignId, skipped: true };
        }
        logger.info({ campaignId }, "[scheduler] Running nightly enrichment refresh");
        await runEnrichmentRefreshAgent(campaignId);
        return { campaignId };
      }

      case "run-lookalike": {
        const { campaignId, triggeredBy, clientUrls, competitorTechUids } = job.data as {
          campaignId: string;
          triggeredBy: string;
          clientUrls: string[];
          competitorTechUids?: string[];
        };
        logger.info({ campaignId }, "[scheduler] Running lookalike agent");
        await runLookalikeAgent({ campaignId, userId: triggeredBy, clientUrls, competitorTechUids });
        return { campaignId };
      }

      case "enrich-and-score": {
        const campaigns = await prisma.campaign.findMany({
          where: {
            status: { in: ["QUEUED", "SENDING", "GENERATING", "RESEARCHING"] },
            deletedAt: null,
          },
          select: { id: true },
          take: SCHEDULER_CAMPAIGN_BATCH_SIZE,
          orderBy: { updatedAt: "asc" },
        });
        logger.info({ count: campaigns.length }, "[scheduler] Enrich-and-score tick — dispatching per-campaign jobs");
        let queued = 0;
        for (const campaign of campaigns) {
          try {
            await campaignQueue.add(
              "enrich-and-score-campaign",
              { campaignId: campaign.id },
              {
                jobId: `enrich-and-score-campaign-${campaign.id}`,
                removeOnComplete: { age: 300 },
                removeOnFail: { age: 3600 },
              }
            );
            queued++;
          } catch (error) {
            logger.error({ campaignId: campaign.id, error }, "[scheduler] Failed to queue enrich-and-score campaign job");
          }
        }
        return { scanned: campaigns.length, queued };
      }

      case "enrich-and-score-campaign": {
        const { campaignId, page = 0 } = job.data as { campaignId: string; page?: number };
        logger.info({ campaignId, page }, "[scheduler] enrich-and-score-campaign starting");

        if (page === 0) {
          try {
            await runJobIntelAgent(campaignId);
          } catch (error) {
            logger.error({ campaignId, error }, "[scheduler] enrich-and-score-campaign: job intel failed");
          }
          try {
            await runTechDetectionAgent(campaignId);
          } catch (error) {
            logger.error({ campaignId, error }, "[scheduler] enrich-and-score-campaign: tech detection failed");
          }
          await campaignQueue.add(
            "enrich-and-score-campaign",
            { campaignId, page: 1 },
            {
              jobId: `enrich-and-score-campaign-${campaignId}-page-1`,
              removeOnComplete: { age: 300 },
              removeOnFail: { age: 3600 },
            }
          );
          return { campaignId, page: 0, dispatched: true };
        }

        const PAGE_SIZE = 50;
        const STALE_THRESHOLD_MS = 7 * 86_400_000;
        const WATERFALL_CONCURRENCY = 5;

        const campaign = await prisma.campaign.findUnique({
          where: { id: campaignId },
          select: { createdById: true },
        });

        if (!campaign) {
          logger.warn({ campaignId }, "[scheduler] enrich-and-score-campaign: campaign not found, skipping");
          return { campaignId, page, skipped: true };
        }

        const leads = await prisma.lead.findMany({
          where: {
            campaignId,
            deletedAt: null,
            recommendedAction: { not: "DISQUALIFY" },
            OR: [
              { lastEnrichedAt: null },
              { lastEnrichedAt: { lte: new Date(Date.now() - STALE_THRESHOLD_MS) } },
            ],
          },
          select: { id: true },
          orderBy: { id: "asc" },
          skip: (page - 1) * PAGE_SIZE,
          take: PAGE_SIZE + 1,
        });

        const hasNextPage = leads.length > PAGE_SIZE;
        const pageBatch = leads.slice(0, PAGE_SIZE);

        if (pageBatch.length > 0) {
          const waterfallLimit = pLimit(WATERFALL_CONCURRENCY);
          await Promise.allSettled(
            pageBatch.map(lead =>
              waterfallLimit(async () => {
                try {
                  await runEnrichmentWaterfall(lead.id, campaign.createdById);
                } catch (err) {
                  logger.warn({ err, leadId: lead.id }, "[scheduler] enrich-and-score-campaign: waterfall failed for lead");
                }
              })
            )
          );
          logger.info({ campaignId, page, count: pageBatch.length }, "[scheduler] enrich-and-score-campaign: waterfall page complete");
        }

        if (hasNextPage) {
          const nextPage = page + 1;
          await campaignQueue.add(
            "enrich-and-score-campaign",
            { campaignId, page: nextPage },
            {
              jobId: `enrich-and-score-campaign-${campaignId}-page-${nextPage}`,
              removeOnComplete: { age: 300 },
              removeOnFail: { age: 3600 },
            }
          );
          return { campaignId, page, enriched: pageBatch.length, hasNextPage: true };
        }

        let scoringDone = false;
        try {
          await runBulkLeadScoringAgent(campaignId);
          scoringDone = true;
        } catch (error) {
          logger.error({ campaignId, error }, "[scheduler] enrich-and-score-campaign: bulk scoring failed");
        }

        return { campaignId, page, enriched: pageBatch.length, hasNextPage: false, scoringDone };
      }

      case "daily-campaign-health-check": {
        logger.info("[scheduler] Running daily campaign health check");
        await runHealthCheckAllCampaigns();
        return { done: true };
      }

      case "daily-warmup-update": {
        logger.info("[scheduler] Running daily warmup update");
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
        logger.info({ campaigns: campaignIdsWithPending.size }, "[scheduler] Pending objection drafts found");
        for (const campaignId of campaignIdsWithPending) {
          try {
            await campaignQueue.add(
              "handle-objections",
              { campaignId },
              {
                jobId: `handle-objections-${campaignId}`,
                removeOnComplete: { age: 300 },
                removeOnFail: { age: 3600 },
              }
            );
          } catch (error) {
            logger.error({ campaignId, error }, "[scheduler] Failed to enqueue objection handler");
          }
        }
        return { scanned: campaigns.length, dispatched: campaignIdsWithPending.size };
      }

      case "handle-objections": {
        const { campaignId } = job.data as { campaignId: string };
        logger.info({ campaignId }, "[scheduler] Running objection handler catch-up");
        await runObjectionHandlerForCampaign(campaignId);
        return { campaignId };
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
        logger.info({ count: campaigns.length }, "[scheduler] Tick — found QUEUED campaigns");
        for (const campaign of campaigns) {
          try {
            await campaignQueue.add(
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
            logger.error({ campaignId: campaign.id, error }, "[scheduler] Failed scheduling campaign");
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
        logger.info({ count: activeCampaigns.length }, "[scheduler] Follow-up tick");
        for (const campaign of activeCampaigns) {
          try {
            await campaignQueue.add(
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
            logger.error({ campaignId: campaign.id, error }, "[scheduler] Failed scheduling follow-up");
          }
        }
        return { checked: activeCampaigns.length };
      }

      case "scan-low-lead-campaigns": {
        const activeCampaigns = await prisma.campaign.findMany({
          where: { status: { in: ["SENDING", "QUEUED"] }, deletedAt: null },
          select: { id: true, name: true },
        });
        logger.info({ count: activeCampaigns.length }, "[scheduler] Lead top-up scan");
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
            logger.info(
              { campaignId: campaign.id, uncontactedCount, threshold: LOW_LEAD_THRESHOLD },
              "[scheduler] Campaign low on leads — queuing top-up"
            );
            await campaignQueue.add(
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
            logger.error({ campaignId: campaign.id, error }, "[scheduler] Failed to check/queue lead top-up");
          }
        }
        return { checked: activeCampaigns.length, topUpQueued };
      }

      case "top-up-leads": {
        const { campaignId } = job.data as { campaignId: string };
        if (await hasActivePipeline(campaignId)) {
          return { campaignId, skipped: true };
        }
        logger.info({ campaignId }, "[scheduler] Running lead top-up");
        const run = async (label: string, fn: () => Promise<unknown>) => {
          try {
            await withTimeout(fn(), AGENT_TIMEOUT_MS);
          } catch (error) {
            logger.error({ campaignId, error }, `[scheduler] top-up: ${label} failed`);
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
        logger.info({ campaignId }, "[scheduler] Lead top-up complete");
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

        logger.info({ resetCount }, "[scheduler] Per-row daily send count refresh complete");
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
        logger.info({ recovered: recovered.count, failed: exhausted.count }, "[scheduler] Recovered stuck SENDING messages");
        const recoverableCampaigns = await prisma.campaign.findMany({
          where: { id: { in: affectedCampaignIds }, senderMailboxId: { not: null } },
          select: { id: true },
        });
        for (const campaign of recoverableCampaigns) {
          try {
            await campaignQueue.add(
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
            logger.error({ campaignId: campaign.id, error }, "[scheduler] Failed to enqueue send-batch after recovery");
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
          logger.warn(
            { count: stuckSendingCampaigns.length, ids: stuckSendingIds },
            "[scheduler] Reset campaigns stuck in SENDING (no active SENDING messages) → QUEUED",
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
          logger.warn({ count: stuckCampaigns.count }, "[scheduler] Reset stuck GENERATING/RESEARCHING campaigns to FAILED");
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
          logger.warn({ count: stalledJobRows.length }, "[recovery] Reconciled stale ACTIVE QueueJob rows → FAILED");
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

        logger.info(
          { recovered: recovered.count, failed: exhausted.count },
          "[scheduler] Recovered stuck EXECUTING sequence steps",
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
        logger.info({ deletedQueueJobs: count, deletedAitraces }, "[cleanup] Deleted old records");
        return { deletedQueueJobs: count, deletedAitraces };
      }

      case "poll-mailbox-replies": {
        logger.info("[scheduler] Polling all mailboxes for replies");
        await pollAllMailboxes();
        return { polled: true };
      }

      case "poll-single-mailbox": {
        const { mailboxId } = job.data as { mailboxId: string };
        logger.info({ mailboxId }, "[scheduler] Polling single mailbox for replies");
        await pollMailboxReplies(mailboxId);
        return { mailboxId };
      }

      case "poll-mailbox-delivery-events": {
        logger.info("[scheduler] Polling all mailboxes for delivery events");
        await pollAllMailboxDeliveryEvents();
        return { polled: true };
      }

      case "poll-single-mailbox-delivery": {
        const { mailboxId } = job.data as { mailboxId: string };
        logger.info({ mailboxId }, "[scheduler] Polling single mailbox for delivery events");
        await pollMailboxDeliveryEvents(mailboxId);
        return { mailboxId };
      }

      case "send-batch": {
        const { campaignId } = job.data as { campaignId: string };
        if (await hasActivePipeline(campaignId)) {
          return { campaignId, skipped: true };
        }
        const camp = await prisma.campaign.findUnique({
          where: { id: campaignId },
          select: { senderMailboxId: true },
        });
        if (!camp?.senderMailboxId) {
          return { campaignId, skipped: true };
        }
        logger.info({ campaignId }, "[scheduler] Sending batch");
        await runSendAgent(campaignId);
        return { campaignId };
      }

      case "run-followup": {
        const { campaignId } = job.data as { campaignId: string };
        logger.info({ campaignId }, "[scheduler] Running follow-up agent");
        await runFollowUpAgent(campaignId);
        return { campaignId };
      }

      case "run-pipeline": {
        const { campaignId, triggeredBy } = job.data as {
          campaignId: string;
          triggeredBy: string;
        };
        await runCampaign(campaignId, triggeredBy);
        return { campaignId };
      }

      case "pause-pipeline": {
        const { campaignId } = job.data as { campaignId: string };
        logger.info({ campaignId }, "[scheduler] Pausing campaign");
        await pauseCampaign(campaignId);
        return { campaignId };
      }

      case "resume-pipeline": {
        const { campaignId, triggeredBy } = job.data as {
          campaignId: string;
          triggeredBy: string;
        };
        logger.info({ campaignId }, "[scheduler] Resuming campaign");
        await resumeCampaign(campaignId, triggeredBy);
        return { campaignId };
      }

      case "run-multi-source-discovery": {
        const { campaignId } = job.data as { campaignId: string };
        logger.info({ campaignId }, "[scheduler] Running multi-source discovery");
        await runMultiSourceDiscoveryAgent(campaignId);
        await runLinkedInDiscoveryAgent(campaignId);
        return { campaignId };
      }

      case "run-community-intent": {
        const { campaignId } = job.data as { campaignId: string };
        logger.info({ campaignId }, "[scheduler] Running community intent");
        await runCommunityIntentAgent(campaignId);
        return { campaignId };
      }

      case "run-job-intel": {
        const { campaignId } = job.data as { campaignId: string };
        logger.info({ campaignId }, "[scheduler] Running job intel");
        await runJobIntelAgent(campaignId);
        return { campaignId };
      }

      case "run-tech-detection": {
        const { campaignId } = job.data as { campaignId: string };
        logger.info({ campaignId }, "[scheduler] Running tech detection");
        await runTechDetectionAgent(campaignId);
        return { campaignId };
      }

      case "run-bulk-scoring": {
        const { campaignId } = job.data as { campaignId: string };
        logger.info({ campaignId }, "[scheduler] Running bulk lead scoring");
        await runBulkLeadScoringAgent(campaignId);
        return { campaignId };
      }

      case "run-icp-refinement": {
        const { campaignId } = job.data as { campaignId: string };
        logger.info({ campaignId }, "[scheduler] Running ICP refinement");
        await runIcpRefinementAgent(campaignId);
        return { campaignId };
      }

      case "rescore-after-icp-refinement": {
        const { campaignId } = job.data as { campaignId: string };

        const campaign = await prisma.campaign.findUnique({
          where: { id: campaignId },
          select: { icpDescription: true },
        });

        if (!campaign) {
          logger.warn({ campaignId }, "[rescore-after-icp-refinement] Campaign not found");
          return { campaignId, skipped: true };
        }

        let rescored = 0;
        let cursor: string | undefined;
        const BATCH = 50;

        while (true) {
          const leads = await prisma.lead.findMany({
            where: {
              campaignId,
              deletedAt: null,
              outreachMessages: { none: {} },
              recommendedAction: { not: "DISQUALIFY" },
            },
            select: { id: true },
            orderBy: { id: "asc" },
            take: BATCH,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
          });

          if (leads.length === 0) break;

          const ids = leads.map(l => l.id);
          cursor = ids[ids.length - 1];

          try {
            await runBatchLeadScoringAgent(ids, campaign.icpDescription, true);
            rescored += ids.length;
          } catch (err) {
            logger.warn({ err, campaignId, batch: ids.length }, "[rescore-after-icp-refinement] Batch failed");
          }

          if (leads.length < BATCH) break;
        }

        logger.info({ campaignId, rescored }, "[rescore-after-icp-refinement] Complete");
        return { campaignId, rescored };
      }

      case "run-research": {
        const { campaignId } = job.data as { campaignId: string };
        logger.info({ campaignId }, "[scheduler] Running research agent");
        await runResearchAgent(campaignId);
        return { campaignId };
      }

      case "run-generate": {
        const { campaignId } = job.data as { campaignId: string };
        logger.info({ campaignId }, "[scheduler] Running generate agent");
        await runGenerateAgent(campaignId);
        return { campaignId };
      }

      case "run-review": {
        const { campaignId } = job.data as { campaignId: string };
        logger.info({ campaignId }, "[scheduler] Running review agent");
        await runReviewAgent(campaignId, {});
        return { campaignId };
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
        logger.info({ count: campaigns.length }, "[scheduler] LinkedIn step tick — dispatching per-campaign jobs");
        let queued = 0;
        for (const campaign of campaigns) {
          try {
            await campaignQueue.add(
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
            logger.error({ campaignId: campaign.id, error }, "[scheduler] Failed to queue LinkedIn outreach");
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
        logger.info({ count: campaigns.length }, "[scheduler] Email sequence step tick — dispatching per-campaign jobs");
        let queued = 0;
        for (const campaign of campaigns) {
          try {
            await campaignQueue.add(
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
            logger.error({ campaignId: campaign.id, error }, "[scheduler] Failed to queue email sequence");
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

      case "run-linkedin-outreach": {
        const { campaignId } = job.data as { campaignId: string };
        logger.info({ campaignId }, "[scheduler] Running LinkedIn outreach agent");
        const result = await runLinkedInOutreachAgent(campaignId);
        return { campaignId, ...result };
      }

      case "run-email-sequence": {
        const { campaignId } = job.data as { campaignId: string };
        logger.info({ campaignId }, "[scheduler] Running email sequence agent");
        const result = await runEmailSequenceAgent(campaignId);
        return { campaignId, ...result };
      }

      case "generate-reply-draft": {
        const { replyId } = job.data as { replyId: string };
        const result = await generateReplyDraft(replyId);
        return result;
      }

      case "ingest-lead-signal": {
        const { leadId, signalType, value, confidence, source } = job.data as {
          leadId: string;
          signalType: string;
          value: string;
          confidence: number;
          source?: string;
        };
        await ingestLeadSignal({ leadId, signalType, value, confidence, source });
        return { leadId, signalType };
      }

      case "run-lead-agent": {
        const { runId } = job.data as { runId: string };
        logger.info({ runId }, "[lead-agent] Running lead agent");
        await runLeadAgent(runId);
        return { runId };
      }

      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
}

export const worker = new Worker(
  "campaign-orchestration",
  processJob,
  {
    connection: createRedisConnection(),
    concurrency: 3,
    lockDuration: 900_000,
    limiter: {
      max: 50,
      duration: 60_000,
    },
  }
);

export const realtimeWorker = new Worker(
  "campaign-realtime",
  processJob,
  {
    connection: createRedisConnection(),
    concurrency: 10,
    lockDuration: 90_000,
  }
);

function wireWorkerEvents(w: Worker, tag: string) {
  w.on("active", (job) => {
    const campaignId = (job.data as Record<string, unknown>)?.campaignId as string | undefined;
    if (campaignId) {
      emitCampaignEvent({
        campaignId,
        type: "active",
        jobName: job.name,
        label: getJobLabel(job.name),
        detail: "Running",
      });
    }
  });

  w.on("completed", (job) => {
    const campaignId = (job.data as Record<string, unknown>)?.campaignId as string | undefined;
    logger.info({ jobId: job.id, jobName: job.name, worker: tag }, "[scheduler] Job completed");
    if (campaignId) {
      emitCampaignEvent({
        campaignId,
        type: "completed",
        jobName: job.name,
        label: getJobLabel(job.name),
        detail: "Completed",
      });
    }
  });

  w.on("failed", (job, err) => {
    const campaignId = (job?.data as Record<string, unknown>)?.campaignId as string | undefined;
    logger.error({ jobId: job?.id, jobName: job?.name, worker: tag, err }, "[scheduler] Job failed");
    if (campaignId) {
      emitCampaignEvent({
        campaignId,
        type: "failed",
        jobName: job!.name,
        label: getJobLabel(job!.name),
        detail: err.message?.slice(0, 120),
      });
    }
  });

  w.on("error", (error) => {
    logger.error({ error, worker: tag }, "[scheduler] Worker error");
  });
}

wireWorkerEvents(worker, "heavy");
wireWorkerEvents(realtimeWorker, "realtime");

const emailEnrichmentWorker = new Worker<{
  leadId?: string;
  userId?: string;
  leadIds?: string[];
  campaignId?: string;
}>(
  "email-enrichment",
  async (job) => {
    if (job.name === "enrich-lead-batch" && job.data.leadIds) {
      await runBatchEmailEnrichmentAgent(job.data.leadIds);
      return;
    }
    if (job.name === "enrich-waterfall" && job.data.leadId && job.data.userId) {
      await runEnrichmentWaterfall(job.data.leadId, job.data.userId);
      return;
    }
    if (job.data.leadId) {
      await runEmailEnrichmentAgent(job.data.leadId);
    }
  },
  {
    connection: createRedisConnection(),
    concurrency: 5,
  },
);

emailEnrichmentWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "[email-enrichment.worker] job failed");
});

async function shutdown() {
  await Promise.all([
    worker.close(),
    realtimeWorker.close(),
    emailEnrichmentWorker.close(),
  ]);
  await Promise.all([campaignQueue.close(), realtimeQueue.close()]);
  await prisma.$disconnect();
}

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});