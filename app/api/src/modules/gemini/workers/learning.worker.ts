import { Worker } from "bullmq";
import { createRedisConnection } from "../../../lib/ioredis";
import { QUEUE_POLICY } from "../queue-policy";
import { wireWorkerEvents } from "../worker-runtime";
import { logger } from "../../../lib/logger";

const policy = QUEUE_POLICY.learning;

async function processJob(job: import("bullmq").Job) {
  const log = logger.child({ jobId: job.id, jobName: job.name });
  log.info({ jobData: job.data }, "[learning.worker] Received job");

  switch (job.name) {
    case "run-learning-feedback": {
      log.info("[learning.worker] Processing learning feedback placeholder");
      // Placeholder for future closed-loop feedback learning updates
      return { status: "success", placeholder: true };
    }
    default:
      throw new Error(`[learning.worker] Unknown job type: ${job.name}`);
  }
}

export const learningWorker = new Worker(policy.queueName, processJob, {
  connection: createRedisConnection(),
  concurrency: policy.concurrency,
  lockDuration: policy.lockDuration,
});

wireWorkerEvents(learningWorker, policy.queueName);
