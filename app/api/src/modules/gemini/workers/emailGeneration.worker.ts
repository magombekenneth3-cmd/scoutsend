import { Worker } from "bullmq";
import { createRedisConnection } from "../../../lib/ioredis";
import { QUEUE_POLICY } from "../queue-policy";
import { wireWorkerEvents } from "../worker-runtime";
import { logger } from "../../../lib/logger";
import { runGenerateAgent } from "../generate.agent";
import { runReviewAgent } from "../review.agent";
import { generateReplyDraft } from "../../replies/replies.services";

const policy = QUEUE_POLICY.emailGeneration;

async function processJob(job: import("bullmq").Job) {
  const log = logger.child({ jobId: job.id, jobName: job.name, correlationId: job.data?.correlationId });

  switch (job.name) {
    case "run-generate": {
      const { campaignId, feedbackMap } = job.data as { campaignId: string; feedbackMap?: any };
      log.info({ campaignId, isRegen: !!feedbackMap }, "[emailGeneration.worker] run-generate start");
      await runGenerateAgent(campaignId, { feedbackMap });
      return { campaignId };
    }

    case "run-review": {
      const { campaignId } = job.data as { campaignId: string };
      log.info({ campaignId }, "[emailGeneration.worker] run-review start");
      await runReviewAgent(campaignId, {});
      return { campaignId };
    }

    case "generate-reply-draft": {
      const { replyId } = job.data as { replyId: string };
      log.info({ replyId }, "[emailGeneration.worker] generate-reply-draft start");
      const result = await generateReplyDraft(replyId);
      return result;
    }

    default:
      throw new Error(`[emailGeneration.worker] Unknown job type: ${job.name}`);
  }
}

export const emailGenerationWorker = new Worker(policy.queueName, processJob, {
  connection: createRedisConnection(),
  concurrency: policy.concurrency,
  lockDuration: policy.lockDuration,
});

wireWorkerEvents(emailGenerationWorker, policy.queueName);
