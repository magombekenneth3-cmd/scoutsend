import { Worker } from "bullmq";
import { createRedisConnection } from "../../../lib/ioredis";
import { QUEUE_POLICY } from "../queue-policy";
import { wireWorkerEvents } from "../worker-runtime";
import { logger } from "../../../lib/logger";
import { pollAllMailboxes, pollMailboxReplies } from "../../replies/replyPoller";
import { pollAllMailboxDeliveryEvents, pollMailboxDeliveryEvents } from "../../webhook/deliverypoll";

const policy = QUEUE_POLICY.mailPoll;

async function processJob(job: import("bullmq").Job) {
  const log = logger.child({ jobId: job.id, jobName: job.name, correlationId: job.data?.correlationId });

  switch (job.name) {
    case "poll-mailbox-replies": {
      log.info("[mailPoll.worker] poll-mailbox-replies start");
      await pollAllMailboxes();
      return { polled: true };
    }

    case "poll-single-mailbox": {
      const { mailboxId } = job.data as { mailboxId: string };
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
      const { mailboxId } = job.data as { mailboxId: string };
      log.info({ mailboxId }, "[mailPoll.worker] poll-single-mailbox-delivery start");
      await pollMailboxDeliveryEvents(mailboxId);
      return { mailboxId };
    }

    default:
      throw new Error(`[mailPoll.worker] Unknown job type: ${job.name}`);
  }
}

export const mailPollWorker = new Worker(policy.queueName, processJob, {
  connection: createRedisConnection(),
  concurrency: policy.concurrency,
  lockDuration: policy.lockDuration,
});

wireWorkerEvents(mailPollWorker, policy.queueName);
