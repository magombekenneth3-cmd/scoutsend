import { Worker } from "bullmq";
import { z } from "zod";
import { redisConnectionOptions } from "../../../lib/ioredis";
import { QUEUE_POLICY } from "../queue-policy";
import { wireWorkerEvents } from "../worker-runtime";
import { logger } from "../../../lib/logger";
import { parseJobData } from "../../../lib/job-validation";
import { pollAllMailboxes, pollMailboxReplies } from "../../replies/replyPoller";
import { pollAllMailboxDeliveryEvents, pollMailboxDeliveryEvents } from "../../webhook/deliverypoll";

const policy = QUEUE_POLICY.mailPoll;

const mailboxIdSchema = z.object({
  mailboxId: z.string().min(1),
});

async function processJob(job: import("bullmq").Job) {
  const log = logger.child({ jobId: job.id, jobName: job.name, correlationId: job.data?.correlationId });

  switch (job.name) {
    case "poll-mailbox-replies": {
      log.info("[mailPoll.worker] poll-mailbox-replies start");
      const summary = await pollAllMailboxes();
      if (summary.totalPolled > 0 && summary.succeeded === 0) {
        throw new Error(`[mailPoll.worker] 100% of mailboxes failed during polling cycle (${summary.failed}/${summary.totalPolled})`);
      }
      return summary;
    }

    case "poll-single-mailbox": {
      const { mailboxId } = parseJobData(mailboxIdSchema, job);
      log.info({ mailboxId }, "[mailPoll.worker] poll-single-mailbox start");
      await pollMailboxReplies(mailboxId);
      return { mailboxId };
    }

    case "poll-mailbox-delivery-events": {
      log.info("[mailPoll.worker] poll-mailbox-delivery-events start");
      await pollAllMailboxDeliveryEvents();
      return { polled: true };
    }

    case "poll-single-mailbox-delivery": {
      const { mailboxId } = parseJobData(mailboxIdSchema, job);
      log.info({ mailboxId }, "[mailPoll.worker] poll-single-mailbox-delivery start");
      await pollMailboxDeliveryEvents(mailboxId);
      return { mailboxId };
    }

    default:
      throw new Error(`[mailPoll.worker] Unknown job type: ${job.name}`);
  }
}

export const mailPollWorker = new Worker(policy.queueName, processJob, {
  connection: redisConnectionOptions,
  concurrency: policy.concurrency,
  lockDuration: policy.lockDuration,
});

wireWorkerEvents(mailPollWorker, policy.queueName);