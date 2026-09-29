import { Worker } from "bullmq";
import { z } from "zod";
import { prisma } from "../../../lib/prisma";
import { redisConnectionOptions } from "../../../lib/ioredis";
import { QUEUE_POLICY } from "../queue-policy";
import { wireWorkerEvents } from "../worker-runtime";
import { logger } from "../../../lib/logger";
import { parseJobData } from "../../../lib/job-validation";
import { runSendAgent } from "../send.agent";

const policy = QUEUE_POLICY.send;

const sendBatchSchema = z.object({
  campaignId: z.string().min(1),
});

async function hasActivePipeline(campaignId: string): Promise<boolean> {
  const job = await prisma.queueJob.findFirst({
    where: {
      campaignId,
      status: "ACTIVE",
      jobType: { in: ["FULL_PIPELINE", "RESUME_SEND"] },
    },
    select: { id: true },
  });
  return !!job;
}

async function processJob(job: import("bullmq").Job) {
  const log = logger.child({ jobId: job.id, jobName: job.name, correlationId: job.data?.correlationId });

  switch (job.name) {
    case "send-batch": {
      const { campaignId } = parseJobData(sendBatchSchema, job);
      log.info({ campaignId }, "[send.worker] send-batch start");

      if (await hasActivePipeline(campaignId)) {
        log.info({ campaignId }, "[send.worker] send-batch skipped: campaign has active pipeline");
        return { campaignId, skipped: true, reason: "active_pipeline" };
      }

      const camp = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { senderMailboxId: true },
      });

      if (!camp?.senderMailboxId) {
        log.info({ campaignId }, "[send.worker] send-batch skipped: no sender mailbox configured");
        return { campaignId, skipped: true, reason: "no_sender_mailbox" };
      }

      await runSendAgent(campaignId);
      return { campaignId };
    }

    default:
      throw new Error(`[send.worker] Unknown job type: ${job.name}`);
  }
}

export const sendWorker = new Worker(policy.queueName, processJob, {
  connection: redisConnectionOptions,
  concurrency: policy.concurrency,
  lockDuration: policy.lockDuration,
});

wireWorkerEvents(sendWorker, policy.queueName);