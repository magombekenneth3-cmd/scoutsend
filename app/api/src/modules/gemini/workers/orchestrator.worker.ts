import { Worker } from "bullmq";
import { prisma } from "../../../lib/prisma";
import { createRedisConnection } from "../../../lib/ioredis";
import { QUEUE_POLICY } from "../queue-policy";
import { wireWorkerEvents } from "../worker-runtime";
import { logger } from "../../../lib/logger";
import { runCampaign, pauseCampaign, resumeCampaign } from "../orchestration.service";
import { runMultiSourceDiscoveryAgent } from "../multi-source-discovery.agent";
import { runLinkedInDiscoveryAgent } from "../linkedin-discovery.agent";
import { runCommunityIntentAgent } from "../community-intent.agent";
import { runEnrichmentRefreshAgent } from "../enrichment-refreshment.agent";
import { runJobIntelAgent } from "../job-intel.agent";
import { runTechDetectionAgent } from "../tech-detection.agent";
import { runEnrichmentWaterfall } from "../enrichment-waterfall.agent";
import { runBulkLeadScoringAgent } from "../lead-scoring.agent";
import { orchestratorQueue } from "../campaign.queue";
import pLimit from "p-limit";

const policy = QUEUE_POLICY.orchestrator;
const SCHEDULER_CAMPAIGN_BATCH_SIZE = 200;

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
    case "run-pipeline": {
      const { campaignId, triggeredBy } = job.data as { campaignId: string; triggeredBy: string };
      log.info({ campaignId }, "[orchestrator.worker] run-pipeline start");
      await runCampaign(campaignId, triggeredBy);
      return { campaignId };
    }

    case "pause-pipeline": {
      const { campaignId } = job.data as { campaignId: string };
      log.info({ campaignId }, "[orchestrator.worker] pause-pipeline start");
      await pauseCampaign(campaignId);
      return { campaignId };
    }

    case "resume-pipeline": {
      const { campaignId, triggeredBy } = job.data as { campaignId: string; triggeredBy: string };
      log.info({ campaignId }, "[orchestrator.worker] resume-pipeline start");
      await resumeCampaign(campaignId, triggeredBy);
      return { campaignId };
    }

    case "nightly-multi-source-discovery": {
      const campaigns = await prisma.campaign.findMany({
        where: { status: { in: ["QUEUED", "SENDING"] }, deletedAt: null },
        select: { id: true },
      });
      log.info({ count: campaigns.length }, "[orchestrator.worker] Dispatching nightly multi-source discovery");
      let queued = 0;
      for (const campaign of campaigns) {
        try {
          await orchestratorQueue.add(
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
          log.error({ campaignId: campaign.id, error }, "[orchestrator.worker] Failed to queue nightly discovery");
        }
      }
      return { queued };
    }

    case "nightly-discovery-campaign": {
      const { campaignId } = job.data as { campaignId: string };
      if (await hasActivePipeline(campaignId)) {
        return { campaignId, skipped: true };
      }
      log.info({ campaignId }, "[orchestrator.worker] Running nightly discovery");
      await runMultiSourceDiscoveryAgent(campaignId);
      await runLinkedInDiscoveryAgent(campaignId);
      return { campaignId };
    }

    case "nightly-community-intent": {
      const campaigns = await prisma.campaign.findMany({
        where: { status: { in: ["QUEUED", "SENDING"] }, deletedAt: null },
        select: { id: true },
      });
      log.info({ count: campaigns.length }, "[orchestrator.worker] Dispatching nightly community intent");
      let queued = 0;
      for (const campaign of campaigns) {
        try {
          await orchestratorQueue.add(
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
          log.error({ campaignId: campaign.id, error }, "[orchestrator.worker] Failed to queue nightly community intent");
        }
      }
      return { queued };
    }

    case "nightly-community-campaign": {
      const { campaignId } = job.data as { campaignId: string };
      if (await hasActivePipeline(campaignId)) {
        return { campaignId, skipped: true };
      }
      log.info({ campaignId }, "[orchestrator.worker] Running nightly community intent");
      await runCommunityIntentAgent(campaignId);
      return { campaignId };
    }

    case "nightly-enrichment-refresh": {
      const campaigns = await prisma.campaign.findMany({
        where: { status: { in: ["QUEUED", "SENDING", "RESEARCHING"] }, deletedAt: null },
        select: { id: true },
      });
      log.info({ count: campaigns.length }, "[orchestrator.worker] Dispatching nightly enrichment refresh");
      let queued = 0;
      for (const campaign of campaigns) {
        try {
          await orchestratorQueue.add(
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
          log.error({ campaignId: campaign.id, error }, "[orchestrator.worker] Failed to queue nightly enrichment");
        }
      }
      return { queued };
    }

    case "nightly-enrichment-campaign": {
      const { campaignId } = job.data as { campaignId: string };
      if (await hasActivePipeline(campaignId)) {
        return { campaignId, skipped: true };
      }
      log.info({ campaignId }, "[orchestrator.worker] Running nightly enrichment refresh");
      await runEnrichmentRefreshAgent(campaignId);
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
      log.info({ count: campaigns.length }, "[orchestrator.worker] Enrich-and-score tick — dispatching per-campaign jobs");
      let queued = 0;
      for (const campaign of campaigns) {
        try {
          await orchestratorQueue.add(
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
          log.error({ campaignId: campaign.id, error }, "[orchestrator.worker] Failed to queue enrich-and-score campaign job");
        }
      }
      return { scanned: campaigns.length, queued };
    }

    case "enrich-and-score-campaign": {
      const { campaignId, page = 0 } = job.data as { campaignId: string; page?: number };
      log.info({ campaignId, page }, "[orchestrator.worker] enrich-and-score-campaign starting");

      if (page === 0) {
        try {
          await runJobIntelAgent(campaignId);
        } catch (error) {
          log.error({ campaignId, error }, "[orchestrator.worker] enrich-and-score-campaign: job intel failed");
        }
        try {
          await runTechDetectionAgent(campaignId);
        } catch (error) {
          log.error({ campaignId, error }, "[orchestrator.worker] enrich-and-score-campaign: tech detection failed");
        }
        await orchestratorQueue.add(
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
        log.warn({ campaignId }, "[orchestrator.worker] enrich-and-score-campaign: campaign not found, skipping");
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
                log.warn({ err, leadId: lead.id }, "[orchestrator.worker] enrich-and-score-campaign: waterfall failed for lead");
              }
            })
          )
        );
        log.info({ campaignId, page, count: pageBatch.length }, "[orchestrator.worker] enrich-and-score-campaign: waterfall page complete");
      }

      if (hasNextPage) {
        const nextPage = page + 1;
        await orchestratorQueue.add(
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
        log.error({ campaignId, error }, "[orchestrator.worker] enrich-and-score-campaign: bulk scoring failed");
      }

      return { campaignId, page, enriched: pageBatch.length, hasNextPage: false, scoringDone };
    }

    default:
      throw new Error(`[orchestrator.worker] Unknown job type: ${job.name}`);
  }
}

export const orchestratorWorker = new Worker(policy.queueName, processJob, {
  connection: createRedisConnection(),
  concurrency: policy.concurrency,
  lockDuration: policy.lockDuration,
});

wireWorkerEvents(orchestratorWorker, policy.queueName);
