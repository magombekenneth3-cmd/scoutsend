import { Worker } from "bullmq";
import { createRedisConnection } from "../../../lib/ioredis";
import { QUEUE_POLICY } from "../queue-policy";
import { wireWorkerEvents } from "../worker-runtime";
import { logger } from "../../../lib/logger";
import { runLinkedInOutreachAgent } from "../linkedin-outreach.agent";

const policy = QUEUE_POLICY.linkedin;

async function processJob(job: import("bullmq").Job) {
  const log = logger.child({ jobId: job.id, jobName: job.name, correlationId: job.data?.correlationId });

  switch (job.name) {
    case "run-linkedin-outreach": {
      const { campaignId } = job.data as { campaignId: string };
      log.info({ campaignId }, "[linkedin.worker] run-linkedin-outreach start");
      const result = await runLinkedInOutreachAgent(campaignId);
      return { campaignId, ...result };
    }

    default:
      throw new Error(`[linkedin.worker] Unknown job type: ${job.name}`);
  }
}

export const linkedinWorker = new Worker(policy.queueName, processJob, {
  connection: createRedisConnection(),
  concurrency: policy.concurrency,
  lockDuration: policy.lockDuration,
});

wireWorkerEvents(linkedinWorker, policy.queueName);
