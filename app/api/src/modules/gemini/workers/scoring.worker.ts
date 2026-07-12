import { Worker } from "bullmq";
import { prisma } from "../../../lib/prisma";
import { createRedisConnection } from "../../../lib/ioredis";
import { QUEUE_POLICY } from "../queue-policy";
import { wireWorkerEvents } from "../worker-runtime";
import { logger } from "../../../lib/logger";
import { runLeadScoringAgent, runBulkLeadScoringAgent, runBatchLeadScoringAgent } from "../lead-scoring.agent";
import { enqueueEnrichmentBatches } from "../email-enrichment.queue";

const policy = QUEUE_POLICY.leadScoring;

async function processJob(job: import("bullmq").Job) {
  const log = logger.child({ jobId: job.id, jobName: job.name, correlationId: job.data?.correlationId });

  switch (job.name) {
    case "score-lead": {
      const { leadId, campaignId, icpDescription } = job.data as {
        leadId: string;
        campaignId: string;
        icpDescription: string;
      };
      log.info({ leadId, campaignId }, "[scoring.worker] score-lead start");
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
      log.info({ campaignId, leadCount: leadIds.length }, "[scoring.worker] score-lead-batch start");
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
          log.warn({ err, leadId }, "[scoring.worker] score-lead-batch: scoring failed for lead");
        }
      }
      if (qualifiedLeadIds.length > 0) {
        await enqueueEnrichmentBatches(qualifiedLeadIds, campaignId);
      }
      return { campaignId, total: leadIds.length, qualified: qualifiedLeadIds.length };
    }

    case "run-bulk-scoring": {
      const { campaignId } = job.data as { campaignId: string };
      log.info({ campaignId }, "[scoring.worker] run-bulk-scoring start");
      const result = await runBulkLeadScoringAgent(campaignId);
      return { campaignId, ...result };
    }

    case "rescore-after-icp-refinement": {
      const { campaignId } = job.data as { campaignId: string };
      log.info({ campaignId }, "[scoring.worker] rescore-after-icp-refinement start");

      const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { icpDescription: true },
      });

      if (!campaign) {
        log.warn({ campaignId }, "[scoring.worker] Campaign not found");
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
          log.warn({ err, campaignId, batch: ids.length }, "[scoring.worker] Batch rescore failed");
        }

        if (leads.length < BATCH) break;
      }

      log.info({ campaignId, rescored }, "[scoring.worker] Complete");
      return { campaignId, rescored };
    }

    default:
      throw new Error(`[scoring.worker] Unknown job type: ${job.name}`);
  }
}

export const scoringWorker = new Worker(policy.queueName, processJob, {
  connection: createRedisConnection(),
  concurrency: policy.concurrency,
  lockDuration: policy.lockDuration,
});

wireWorkerEvents(scoringWorker, policy.queueName);
