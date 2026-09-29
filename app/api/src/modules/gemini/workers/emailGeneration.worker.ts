import { Job, Worker } from "bullmq";
import { z } from "zod";
import { redisConnectionOptions } from "../../../lib/ioredis";
import { QUEUE_POLICY } from "../queue-policy";
import { wireWorkerEvents } from "../worker-runtime";
import { logger } from "../../../lib/logger";
import { parseJobData } from "../../../lib/job-validation";
import { runGenerateAgent, persistCachedProposal } from "../../outreach/generate-message.execution";
import { runReviewAgent } from "../review.agent";
import { generateReplyDraft } from "../../replies/replies.services";

const policy = QUEUE_POLICY.emailGeneration;

const runGenerateSchema = z.object({
  campaignId: z.string().min(1),
  feedbackMap: z.any().optional(),
  materialChangeMap: z.any().optional(),
});
const runReviewSchema = z.object({
  campaignId: z.string().min(1),
});
const generateReplyDraftSchema = z.object({
  replyId: z.string().min(1),
});
const persistProposalSchema = z.object({
  cacheId: z.string().min(1),
});

async function processJob(job: Job) {
  const log = logger.child({ jobId: job.id, jobName: job.name, correlationId: job.data?.correlationId });
  switch (job.name) {
    case "run-generate": {
      const { campaignId, feedbackMap, materialChangeMap } = parseJobData(runGenerateSchema, job);
      log.info(
        { campaignId, isRegen: !!feedbackMap, isMaterialChangeRegen: !!materialChangeMap },
        "[emailGeneration.worker] run-generate start",
      );
      await runGenerateAgent(campaignId, { feedbackMap, materialChangeMap });
      return { campaignId };
    }
    case "run-review": {
      const { campaignId } = parseJobData(runReviewSchema, job);
      log.info({ campaignId }, "[emailGeneration.worker] run-review start");
      await runReviewAgent(campaignId, {});
      return { campaignId };
    }
    case "generate-reply-draft": {
      const { replyId } = parseJobData(generateReplyDraftSchema, job);
      log.info({ replyId }, "[emailGeneration.worker] generate-reply-draft start");
      const result = await generateReplyDraft(replyId);
      return result;
    }
    case "persist-generated-proposal": {
      const { cacheId } = parseJobData(persistProposalSchema, job);
      log.info({ cacheId }, "[emailGeneration.worker] persist-generated-proposal start");
      const messageId = await persistCachedProposal(cacheId);
      return { cacheId, messageId };
    }
    default:
      throw new Error(`[emailGeneration.worker] Unknown job type: ${job.name}`);
  }
}

export const emailGenerationWorker = new Worker(policy.queueName, processJob, {
  connection: redisConnectionOptions,
  concurrency: policy.concurrency,
  lockDuration: policy.lockDuration,
});

wireWorkerEvents(emailGenerationWorker, policy.queueName);