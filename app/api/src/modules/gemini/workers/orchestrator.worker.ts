import { Worker } from "bullmq";
import { z } from "zod";
import pLimit from "p-limit";
import { prisma } from "../../../lib/prisma";
import { redisConnectionOptions } from "../../../lib/ioredis";
import { QUEUE_POLICY } from "../queue-policy";
import { wireWorkerEvents } from "../worker-runtime";
import { logger } from "../../../lib/logger";
import { parseJobData } from "../../../lib/job-validation";
import {
  runCampaign,
  pauseCampaign,
  resumeCampaign,
} from "../orchestration.service";
import { runMultiSourceDiscoveryAgent } from "../multi-source-discovery.agent";
import { runLinkedInDiscoveryAgent } from "../linkedin-discovery.agent";
import { runCommunityIntentAgent } from "../community-intent.agent";
import { runEnrichmentRefreshAgent } from "../enrichment-refreshment.agent";
import { runJobIntelAgent } from "../job-intel.agent";
import { runTechDetectionAgent } from "../tech-detection.agent";
import { runEnrichmentWaterfall } from "../enrichment-waterfall.agent";
import { runBulkLeadScoringAgent } from "../lead-scoring.agent";
import { orchestratorQueue } from "../campaign.queue";
import { enqueueEmailRevealForQualifiedLeads } from "../email-enrichment.queue";

const policy = QUEUE_POLICY.orchestrator;

const SCHEDULER_CAMPAIGN_BATCH_SIZE = 200;
const PAGE_SIZE = 50;

const WATERFALL_CONCURRENCY_DEFAULT = parsePositiveIntEnv(
  process.env.WATERFALL_CONCURRENCY,
  5,
);
const WATERFALL_MIN_CONCURRENCY = 1;
const WATERFALL_MAX_RETRIES = 3;
const WATERFALL_RETRY_BASE_DELAY_MS = 500;
const WATERFALL_THROTTLE_FAILURE_RATE = 0.4;
const ENRICHMENT_REFRESH_DAYS = parsePositiveIntEnv(
  process.env.ENRICHMENT_REFRESH_DAYS,
  7,
);

function parsePositiveIntEnv(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : fallback;
}

const campaignIdSchema = z.object({
  campaignId: z.string().min(1),
});

const campaignIdWithTriggeredBySchema = z.object({
  campaignId: z.string().min(1),
  triggeredBy: z.string().min(1),
});

const enrichAndScoreCampaignSchema = z.object({
  campaignId: z.string().min(1),
  page: z.number().int().nonnegative().default(0),
  cursorId: z.string().min(1).optional(),
  concurrency: z.number().int().positive().optional(),
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
  fn: () => Promise<T>,
  attempts: number,
  baseDelayMs: number,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < attempts) {
        await sleep(
          baseDelayMs * 2 ** (attempt - 1) + Math.random() * 100,
        );
      }
    }
  }

  throw lastError;
}

function isEnrichmentEligible(status: string): boolean {
  return (
    status === "QUEUED" ||
    status === "SENDING" ||
    status === "GENERATING" ||
    status === "RESEARCHING"
  );
}

async function hasActivePipeline(campaignId: string): Promise<boolean> {
  const job = await prisma.queueJob.findFirst({
    where: {
      campaignId,
      status: "ACTIVE",
      jobType: {
        in: ["FULL_PIPELINE", "RESUME_SEND"],
      },
    },
    select: {
      id: true,
    },
  });

  return Boolean(job);
}

async function processEnrichmentPage(params: {
  campaignId: string;
  userId: string;
  page: number;
  cursorId?: string;
  concurrency: number;
  log: typeof logger;
}) {
  const {
    campaignId,
    userId,
    page,
    cursorId,
    concurrency,
    log,
  } = params;

  const staleThresholdMs = ENRICHMENT_REFRESH_DAYS * 86_400_000;
  const staleBefore = new Date(Date.now() - staleThresholdMs);

  const leads = await prisma.lead.findMany({
    where: {
      campaignId,
      deletedAt: null,
      recommendedAction: {
        not: "DISQUALIFY",
      },
      OR: [
        {
          lastEnrichedAt: null,
        },
        {
          lastEnrichedAt: {
            lte: staleBefore,
          },
        },
      ],
      ...(cursorId
        ? {
          id: {
            gt: cursorId,
          },
        }
        : {}),
    },
    select: {
      id: true,
    },
    orderBy: {
      id: "asc",
    },
    take: PAGE_SIZE + 1,
  });

  const hasNextPage = leads.length > PAGE_SIZE;
  const pageBatch = leads.slice(0, PAGE_SIZE);

  let succeeded = 0;
  let failedCount = 0;
  let nextConcurrency = concurrency;

  if (pageBatch.length > 0) {
    const pageStartedAt = Date.now();
    const waterfallLimit = pLimit(concurrency);

    const results = await Promise.allSettled(
      pageBatch.map((lead) =>
        waterfallLimit(() =>
          withRetry(
            () => runEnrichmentWaterfall(lead.id, userId),
            WATERFALL_MAX_RETRIES,
            WATERFALL_RETRY_BASE_DELAY_MS,
          ),
        ),
      ),
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];

      if (result.status === "fulfilled") {
        succeeded++;
      } else {
        failedCount++;

        log.warn(
          {
            err: result.reason,
            leadId: pageBatch[i].id,
          },
          "[orchestrator.worker] waterfall failed for lead",
        );
      }
    }

    const failureRate = failedCount / pageBatch.length;

    nextConcurrency =
      failureRate >= WATERFALL_THROTTLE_FAILURE_RATE
        ? Math.max(
          WATERFALL_MIN_CONCURRENCY,
          Math.floor(concurrency / 2),
        )
        : WATERFALL_CONCURRENCY_DEFAULT;

    const pageDurationMs = Date.now() - pageStartedAt;

    log.info(
      {
        campaignId,
        page,
        attempted: pageBatch.length,
        succeeded,
        failed: failedCount,
        waterfallSuccessRate: succeeded / pageBatch.length,
        durationMs: pageDurationMs,
        avgMsPerLead: pageDurationMs / pageBatch.length,
        concurrencyUsed: concurrency,
        nextConcurrency,
      },
      "[orchestrator.worker] waterfall page complete",
    );
  }

  return {
    page,
    pageBatch,
    hasNextPage,
    succeeded,
    failedCount,
    nextConcurrency,
    nextCursorId:
      pageBatch.length > 0
        ? pageBatch[pageBatch.length - 1].id
        : cursorId,
  };
}

async function processJob(job: import("bullmq").Job) {
  const queueWaitMs = Date.now() - job.timestamp;

  const log = logger.child({
    jobId: job.id,
    jobName: job.name,
    correlationId: job.data?.correlationId,
    queueWaitMs,
  });

  switch (job.name) {
    case "run-pipeline": {
      const { campaignId, triggeredBy } = parseJobData(
        campaignIdWithTriggeredBySchema,
        job,
      );

      log.info(
        { campaignId },
        "[orchestrator.worker] run-pipeline start",
      );

      await runCampaign(campaignId, triggeredBy);

      return { campaignId };
    }

    case "pause-pipeline": {
      const { campaignId } = parseJobData(
        campaignIdSchema,
        job,
      );

      log.info(
        { campaignId },
        "[orchestrator.worker] pause-pipeline start",
      );

      await pauseCampaign(campaignId);

      return { campaignId };
    }

    case "resume-pipeline": {
      const { campaignId, triggeredBy } = parseJobData(
        campaignIdWithTriggeredBySchema,
        job,
      );

      log.info(
        { campaignId },
        "[orchestrator.worker] resume-pipeline start",
      );

      await resumeCampaign(campaignId, triggeredBy);

      return { campaignId };
    }

    case "nightly-multi-source-discovery": {
      const campaigns = await prisma.campaign.findMany({
        where: {
          status: {
            in: ["QUEUED", "SENDING"],
          },
          deletedAt: null,
        },
        select: {
          id: true,
        },
      });

      log.info(
        { count: campaigns.length },
        "[orchestrator.worker] Dispatching nightly multi-source discovery",
      );

      let queued = 0;
      const failed: string[] = [];

      for (const campaign of campaigns) {
        try {
          await orchestratorQueue.add(
            "nightly-discovery-campaign",
            {
              campaignId: campaign.id,
            },
            {
              jobId: `nightly-discovery-${campaign.id}`,
              removeOnComplete: {
                age: 300,
              },
              removeOnFail: {
                age: 3600,
              },
            },
          );

          queued++;
        } catch (error) {
          log.error(
            {
              campaignId: campaign.id,
              error,
            },
            "[orchestrator.worker] Failed to queue nightly discovery",
          );

          failed.push(campaign.id);
        }
      }

      if (failed.length > 0) {
        log.warn(
          { failed },
          "[orchestrator.worker] Some campaigns failed to enqueue for nightly multi-source discovery",
        );
      }

      return {
        queued,
        failed,
      };
    }

    case "nightly-discovery-campaign": {
      const { campaignId } = parseJobData(
        campaignIdSchema,
        job,
      );

      if (await hasActivePipeline(campaignId)) {
        return {
          campaignId,
          skipped: true,
        };
      }

      log.info(
        { campaignId },
        "[orchestrator.worker] Running nightly discovery",
      );

      await runMultiSourceDiscoveryAgent(campaignId);
      await runLinkedInDiscoveryAgent(campaignId);

      return { campaignId };
    }

    case "nightly-community-intent": {
      const campaigns = await prisma.campaign.findMany({
        where: {
          status: {
            in: ["QUEUED", "SENDING"],
          },
          deletedAt: null,
        },
        select: {
          id: true,
        },
      });

      log.info(
        { count: campaigns.length },
        "[orchestrator.worker] Dispatching nightly community intent",
      );

      let queued = 0;
      const failed: string[] = [];

      for (const campaign of campaigns) {
        try {
          await orchestratorQueue.add(
            "nightly-community-campaign",
            {
              campaignId: campaign.id,
            },
            {
              jobId: `nightly-community-${campaign.id}`,
              removeOnComplete: {
                age: 300,
              },
              removeOnFail: {
                age: 3600,
              },
            },
          );

          queued++;
        } catch (error) {
          log.error(
            {
              campaignId: campaign.id,
              error,
            },
            "[orchestrator.worker] Failed to queue nightly community intent",
          );

          failed.push(campaign.id);
        }
      }

      if (failed.length > 0) {
        log.warn(
          { failed },
          "[orchestrator.worker] Some campaigns failed to enqueue for nightly community intent",
        );
      }

      return {
        queued,
        failed,
      };
    }

    case "nightly-community-campaign": {
      const { campaignId } = parseJobData(
        campaignIdSchema,
        job,
      );

      if (await hasActivePipeline(campaignId)) {
        return {
          campaignId,
          skipped: true,
        };
      }

      log.info(
        { campaignId },
        "[orchestrator.worker] Running nightly community intent",
      );

      await runCommunityIntentAgent(campaignId);

      return { campaignId };
    }

    case "nightly-enrichment-refresh": {
      const campaigns = await prisma.campaign.findMany({
        where: {
          status: {
            in: ["QUEUED", "SENDING", "RESEARCHING"],
          },
          deletedAt: null,
        },
        select: {
          id: true,
        },
      });

      log.info(
        { count: campaigns.length },
        "[orchestrator.worker] Dispatching nightly enrichment refresh",
      );

      let queued = 0;
      const failed: string[] = [];

      for (const campaign of campaigns) {
        try {
          await orchestratorQueue.add(
            "nightly-enrichment-campaign",
            {
              campaignId: campaign.id,
            },
            {
              jobId: `nightly-enrichment-${campaign.id}`,
              removeOnComplete: {
                age: 300,
              },
              removeOnFail: {
                age: 3600,
              },
            },
          );

          queued++;
        } catch (error) {
          log.error(
            {
              campaignId: campaign.id,
              error,
            },
            "[orchestrator.worker] Failed to queue nightly enrichment",
          );

          failed.push(campaign.id);
        }
      }

      if (failed.length > 0) {
        log.warn(
          { failed },
          "[orchestrator.worker] Some campaigns failed to enqueue for nightly enrichment refresh",
        );
      }

      return {
        queued,
        failed,
      };
    }

    case "nightly-enrichment-campaign": {
      const { campaignId } = parseJobData(
        campaignIdSchema,
        job,
      );

      if (await hasActivePipeline(campaignId)) {
        return {
          campaignId,
          skipped: true,
        };
      }

      log.info(
        { campaignId },
        "[orchestrator.worker] Running nightly enrichment refresh",
      );

      await runEnrichmentRefreshAgent(campaignId);

      return { campaignId };
    }

    case "enrich-and-score": {
      const campaigns = await prisma.campaign.findMany({
        where: {
          status: {
            in: [
              "QUEUED",
              "SENDING",
              "GENERATING",
              "RESEARCHING",
            ],
          },
          deletedAt: null,
        },
        select: {
          id: true,
        },
        take: SCHEDULER_CAMPAIGN_BATCH_SIZE,
        orderBy: {
          updatedAt: "asc",
        },
      });

      log.info(
        {
          count: campaigns.length,
        },
        "[orchestrator.worker] Enrich-and-score tick — dispatching per-campaign jobs",
      );

      let queued = 0;
      const failed: string[] = [];

      for (const campaign of campaigns) {
        try {
          await orchestratorQueue.add(
            "enrich-and-score-campaign",
            {
              campaignId: campaign.id,
              page: 0,
            },
            {
              jobId: `enrich-and-score-campaign-${campaign.id}`,
              removeOnComplete: {
                age: 300,
              },
              removeOnFail: {
                age: 3600,
              },
            },
          );

          queued++;
        } catch (error) {
          log.error(
            {
              campaignId: campaign.id,
              error,
            },
            "[orchestrator.worker] Failed to queue enrich-and-score campaign job",
          );

          failed.push(campaign.id);
        }
      }

      if (failed.length > 0) {
        log.warn(
          { failed },
          "[orchestrator.worker] Some campaigns failed to enqueue for enrich-and-score",
        );
      }

      return {
        scanned: campaigns.length,
        queued,
        failed,
      };
    }

    case "enrich-and-score-campaign": {
      const {
        campaignId,
        page,
        cursorId,
        concurrency,
      } = parseJobData(
        enrichAndScoreCampaignSchema,
        job,
      );

      log.info(
        {
          campaignId,
          page,
          cursorId,
        },
        "[orchestrator.worker] enrich-and-score-campaign starting",
      );

      const campaign = await prisma.campaign.findUnique({
        where: {
          id: campaignId,
        },
        select: {
          createdById: true,
          status: true,
          deletedAt: true,
        },
      });

      if (
        !campaign ||
        campaign.deletedAt ||
        !isEnrichmentEligible(campaign.status)
      ) {
        log.info(
          {
            campaignId,
            page,
            status: campaign?.status,
          },
          "[orchestrator.worker] enrich-and-score-campaign: campaign no longer eligible, stopping chain",
        );

        return {
          campaignId,
          page,
          skipped: true,
        };
      }

      const currentConcurrency =
        concurrency ?? WATERFALL_CONCURRENCY_DEFAULT;

      if (page === 0) {
        const signalStartedAt = Date.now();

        const signalResultsPromise = Promise.allSettled([
          runJobIntelAgent(campaignId),
          runTechDetectionAgent(campaignId),
        ]);

        const firstPage = await processEnrichmentPage({
          campaignId,
          userId: campaign.createdById,
          page: 1,
          concurrency: currentConcurrency,
          log,
        });

        const signalResults = await signalResultsPromise;

        signalResults.forEach((result, index) => {
          const signalName =
            index === 0 ? "job-intel" : "tech-detection";

          if (result.status === "rejected") {
            log.error(
              {
                campaignId,
                signal: signalName,
                error: result.reason,
              },
              "[orchestrator.worker] Independent signal source failed",
            );
          } else {
            log.info(
              {
                campaignId,
                signal: signalName,
              },
              "[orchestrator.worker] Independent signal source completed",
            );
          }
        });

        log.info(
          {
            campaignId,
            signalDurationMs: Date.now() - signalStartedAt,
          },
          "[orchestrator.worker] Independent signal sources settled",
        );

        if (firstPage.hasNextPage) {
          await orchestratorQueue.add(
            "enrich-and-score-campaign",
            {
              campaignId,
              page: 2,
              cursorId: firstPage.nextCursorId,
              concurrency: firstPage.nextConcurrency,
            },
            {
              jobId: `enrich-and-score-campaign-${campaignId}-page-2`,
              removeOnComplete: {
                age: 300,
              },
              removeOnFail: {
                age: 3600,
              },
            },
          );

          return {
            campaignId,
            page: 1,
            enriched: firstPage.pageBatch.length,
            hasNextPage: true,
            signalSourcesSettled: true,
          };
        }

        let scoringDone = false;
        let revealQueued = 0;

        const scoringStartedAt = Date.now();

        try {
          await runBulkLeadScoringAgent(campaignId);
          scoringDone = true;

          const scoredLeads = await prisma.lead.findMany({
            where: {
              campaignId,
              deletedAt: null,
            },
            select: {
              id: true,
            },
          });

          const revealResult =
            await enqueueEmailRevealForQualifiedLeads(
              scoredLeads.map((lead) => lead.id),
              campaignId,
            );

          revealQueued = revealResult.qualifiedIds.length;
        } catch (error) {
          log.error(
            {
              campaignId,
              error,
            },
            "[orchestrator.worker] enrich-and-score-campaign: scoring or email reveal failed",
          );
        } finally {
          log.info(
            {
              campaignId,
              scoringDurationMs: Date.now() - scoringStartedAt,
              scoringDone,
              revealQueued,
            },
            "[orchestrator.worker] enrich-and-score-campaign: scoring finished",
          );
        }

        return {
          campaignId,
          page: 1,
          enriched: firstPage.pageBatch.length,
          hasNextPage: false,
          scoringDone,
          revealQueued,
          signalSourcesSettled: true,
        };
      }

      const pageResult = await processEnrichmentPage({
        campaignId,
        userId: campaign.createdById,
        page,
        cursorId,
        concurrency: currentConcurrency,
        log,
      });

      if (pageResult.hasNextPage) {
        const nextPage = page + 1;

        await orchestratorQueue.add(
          "enrich-and-score-campaign",
          {
            campaignId,
            page: nextPage,
            cursorId: pageResult.nextCursorId,
            concurrency: pageResult.nextConcurrency,
          },
          {
            jobId: `enrich-and-score-campaign-${campaignId}-page-${nextPage}`,
            removeOnComplete: {
              age: 300,
            },
            removeOnFail: {
              age: 3600,
            },
          },
        );

        return {
          campaignId,
          page,
          enriched: pageResult.pageBatch.length,
          hasNextPage: true,
        };
      }

      let scoringDone = false;
      let revealQueued = 0;

      const scoringStartedAt = Date.now();

      try {
        await runBulkLeadScoringAgent(campaignId);
        scoringDone = true;

        const scoredLeads = await prisma.lead.findMany({
          where: {
            campaignId,
            deletedAt: null,
          },
          select: {
            id: true,
          },
        });

        const revealResult =
          await enqueueEmailRevealForQualifiedLeads(
            scoredLeads.map((lead) => lead.id),
            campaignId,
          );

        revealQueued = revealResult.qualifiedIds.length;
      } catch (error) {
        log.error(
          {
            campaignId,
            error,
          },
          "[orchestrator.worker] enrich-and-score-campaign: scoring or email reveal failed",
        );
      } finally {
        log.info(
          {
            campaignId,
            scoringDurationMs: Date.now() - scoringStartedAt,
            scoringDone,
            revealQueued,
          },
          "[orchestrator.worker] enrich-and-score-campaign: scoring finished",
        );
      }

      return {
        campaignId,
        page,
        enriched: pageResult.pageBatch.length,
        hasNextPage: false,
        scoringDone,
        revealQueued,
      };
    }

    case "run-job-intel": {
      const { campaignId } = parseJobData(
        campaignIdSchema,
        job,
      );

      log.info(
        { campaignId },
        "[orchestrator.worker] run-job-intel start",
      );

      await runJobIntelAgent(campaignId);

      return { campaignId };
    }

    case "run-tech-detection": {
      const { campaignId } = parseJobData(
        campaignIdSchema,
        job,
      );

      log.info(
        { campaignId },
        "[orchestrator.worker] run-tech-detection start",
      );

      await runTechDetectionAgent(campaignId);

      return { campaignId };
    }

    default:
      throw new Error(
        `[orchestrator.worker] Unknown job type: ${job.name}`,
      );
  }
}

export const orchestratorWorker = new Worker(
  policy.queueName,
  processJob,
  {
    connection: redisConnectionOptions,
    concurrency: policy.concurrency,
    lockDuration: policy.lockDuration,
  },
);

wireWorkerEvents(
  orchestratorWorker,
  policy.queueName,
);