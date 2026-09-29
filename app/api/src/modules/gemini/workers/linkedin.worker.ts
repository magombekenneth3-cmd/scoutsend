import { Worker } from "bullmq";
import { z } from "zod";
import { redisConnectionOptions } from "../../../lib/ioredis";
import { QUEUE_POLICY } from "../queue-policy";
import { wireWorkerEvents } from "../worker-runtime";
import { logger } from "../../../lib/logger";
import { parseJobData } from "../../../lib/job-validation";
import { runLinkedInOutreachAgent } from "../linkedin-outreach.agent";

const policy = QUEUE_POLICY.linkedin;

const runLinkedInOutreachSchema = z.object({
  campaignId: z.string().min(1),
});

async function processJob(job: import("bullmq").Job) {
  const log = logger.child({ jobId: job.id, jobName: job.name, correlationId: job.data?.correlationId });

  switch (job.name) {
    case "run-linkedin-outreach": {
      const { campaignId } = parseJobData(runLinkedInOutreachSchema, job);
      log.info({ campaignId }, "[linkedin.worker] run-linkedin-outreach start");
      const result = await runLinkedInOutreachAgent(campaignId);
      return { campaignId, ...result };
    }

    default:
      throw new Error(`[linkedin.worker] Unknown job type: ${job.name}`);
  }
}

export const linkedinWorker = new Worker(policy.queueName, processJob, {
  connection: redisConnectionOptions,
  concurrency: policy.concurrency,
  lockDuration: policy.lockDuration,
});

wireWorkerEvents(linkedinWorker, policy.queueName);