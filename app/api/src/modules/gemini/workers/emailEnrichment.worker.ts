import { Worker } from "bullmq";
import { z } from "zod";
import { redisConnectionOptions } from "../../../lib/ioredis";
import { QUEUE_POLICY } from "../queue-policy";
import { wireWorkerEvents } from "../worker-runtime";
import { logger } from "../../../lib/logger";
import { parseJobData } from "../../../lib/job-validation";
import { runBatchEmailEnrichmentAgent, runEmailEnrichmentAgent, retryEmailVerification } from "../email-enrichment.agent";
import { runEnrichmentWaterfall } from "../enrichment-waterfall.agent";
import { applyCachedHarvestApiData } from "../../../lib/providers/apify-linkedin.provider";

const policy = QUEUE_POLICY.emailEnrichment;

const enrichLeadBatchSchema = z.object({
  leadIds: z.array(z.string().min(1)).min(1),
});
const enrichWaterfallSchema = z.object({
  leadId: z.string().min(1),
  userId: z.string().min(1),
});
const leadIdOnlySchema = z.object({
  leadId: z.string().min(1),
});

async function processJob(job: import("bullmq").Job) {
  const log = logger.child({ jobId: job.id, jobName: job.name, correlationId: job.data?.correlationId });

  switch (job.name) {
    case "enrich-lead-batch": {
      const { leadIds } = parseJobData(enrichLeadBatchSchema, job);
      log.info({ leadCount: leadIds.length }, "[emailEnrichment.worker] enrich-lead-batch start");
      await runBatchEmailEnrichmentAgent(leadIds);
      await applyCachedHarvestApiData(leadIds);
      return { count: leadIds.length };
    }

    case "enrich-waterfall": {
      const { leadId, userId } = parseJobData(enrichWaterfallSchema, job);
      log.info({ leadId, userId }, "[emailEnrichment.worker] enrich-waterfall start");
      await runEnrichmentWaterfall(leadId, userId);
      return { leadId };
    }

    case "verify-retry": {
      const { leadId } = parseJobData(leadIdOnlySchema, job);
      log.info({ leadId }, "[emailEnrichment.worker] verify-retry start");
      await retryEmailVerification(leadId);
      return { leadId };
    }

    default: {
      const { leadId } = parseJobData(leadIdOnlySchema, job);
      log.info({ leadId }, "[emailEnrichment.worker] single lead enrichment start");
      await runEmailEnrichmentAgent(leadId);
      return { leadId };
    }
  }
}

export const emailEnrichmentWorker = new Worker(policy.queueName, processJob, {
  connection: redisConnectionOptions,
  concurrency: policy.concurrency,
  lockDuration: policy.lockDuration,
});

wireWorkerEvents(emailEnrichmentWorker, policy.queueName);