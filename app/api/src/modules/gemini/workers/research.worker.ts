import { Worker, Job } from "bullmq";
import { z } from "zod";
import { redisConnectionOptions } from "../../../lib/ioredis";
import { QUEUE_POLICY } from "../queue-policy";
import { wireWorkerEvents, withHeartbeat } from "../worker-runtime";
import { logger } from "../../../lib/logger";
import { parseJobData } from "../../../lib/job-validation";
import { runResearchAgent } from "../gemini.agent";

const policy = QUEUE_POLICY.leadResearch;

const runResearchSchema = z.object({
  campaignId: z.string().min(1),
});

async function processJob(job: Job) {
  const log = logger.child({ jobId: job.id, jobName: job.name, correlationId: job.data?.correlationId });

  switch (job.name) {
    case "run-research": {
      const { campaignId } = parseJobData(runResearchSchema, job);
      log.info({ campaignId }, "[research.worker] run-research start");
      await withHeartbeat(job, () => runResearchAgent(campaignId), policy.lockDuration);
      return { campaignId };
    }

    default:
      throw new Error(`[research.worker] Unknown job type: ${job.name}`);
  }
}

export const researchWorker = new Worker(policy.queueName, processJob, {
  connection: redisConnectionOptions,
  concurrency: policy.concurrency,
  lockDuration: policy.lockDuration,
});

wireWorkerEvents(researchWorker, policy.queueName);