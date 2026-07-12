import { Worker } from "bullmq";
import { createRedisConnection } from "../../../lib/ioredis";
import { QUEUE_POLICY } from "../queue-policy";
import { wireWorkerEvents } from "../worker-runtime";
import { logger } from "../../../lib/logger";
import { runBatchEmailEnrichmentAgent, runEmailEnrichmentAgent, retryEmailVerification } from "../email-enrichment.agent";
import { runEnrichmentWaterfall } from "../enrichment-waterfall.agent";

const policy = QUEUE_POLICY.emailEnrichment;

async function processJob(job: import("bullmq").Job) {
  const log = logger.child({ jobId: job.id, jobName: job.name, correlationId: job.data?.correlationId });

  if (job.name === "enrich-lead-batch" && job.data.leadIds) {
    log.info({ leadCount: job.data.leadIds.length }, "[emailEnrichment.worker] enrich-lead-batch start");
    await runBatchEmailEnrichmentAgent(job.data.leadIds);
    return { count: job.data.leadIds.length };
  }

  if (job.name === "enrich-waterfall" && job.data.leadId && job.data.userId) {
    log.info({ leadId: job.data.leadId, userId: job.data.userId }, "[emailEnrichment.worker] enrich-waterfall start");
    await runEnrichmentWaterfall(job.data.leadId, job.data.userId);
    return { leadId: job.data.leadId };
  }

  if (job.name === "verify-retry" && job.data.leadId) {
    log.info({ leadId: job.data.leadId }, "[emailEnrichment.worker] verify-retry start (bug fix: routing to retryEmailVerification)");
    await retryEmailVerification(job.data.leadId);
    return { leadId: job.data.leadId };
  }

  if (job.data.leadId) {
    log.info({ leadId: job.data.leadId }, "[emailEnrichment.worker] single lead enrichment start");
    await runEmailEnrichmentAgent(job.data.leadId);
    return { leadId: job.data.leadId };
  }

  throw new Error(`[emailEnrichment.worker] Unknown job type: ${job.name}`);
}

export const emailEnrichmentWorker = new Worker(policy.queueName, processJob, {
  connection: createRedisConnection(),
  concurrency: policy.concurrency,
  lockDuration: policy.lockDuration,
});

wireWorkerEvents(emailEnrichmentWorker, policy.queueName);
