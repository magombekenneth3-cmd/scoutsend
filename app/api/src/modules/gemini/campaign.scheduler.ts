import { logger } from "../../lib/logger";
import {
  campaignQueue,
  realtimeQueue,
  orchestratorQueue,
  maintenanceQueue,
  mailPollQueue,
} from "./campaign.queue";
import { QueueEvents, Queue } from "bullmq";
import { createRedisConnection, redis } from "../../lib/ioredis";
import { prisma } from "../../lib/prisma";

export { campaignQueue, realtimeQueue };

async function recoverOrphanedDiscoveryRuns(): Promise<void> {
  try {
    const { count } = await prisma.discoveryRun.updateMany({
      where: { status: "RUNNING" },
      data: { status: "FAILED", errorMessage: "Orphaned by server restart", completedAt: new Date() },
    });
    if (count > 0) {
      logger.warn({ count }, "[scheduler] Marked orphaned RUNNING discovery runs as FAILED");
    }
  } catch (err) {
    logger.error({ err }, "[scheduler] Failed to recover orphaned discovery runs");
  }
}

export async function startCampaignScheduler(): Promise<void> {
  await recoverOrphanedDiscoveryRuns();

  const lockKey = "campaign-scheduler:init-lock";
  const acquired = await redis.set(lockKey, "1", "PX", 45000, "NX");
  if (!acquired) {
    logger.info("[scheduler] Campaign scheduler registration skipped (lock held by another instance)");
    return;
  }

  const queuesToClean = [
    orchestratorQueue,
    maintenanceQueue,
    realtimeQueue,
    mailPollQueue,
  ];

  for (const queue of queuesToClean) {
    try {
      const repeatable = await queue.getRepeatableJobs();
      for (const job of repeatable) {
        await queue.removeRepeatableByKey(job.key);
      }
    } catch (err) {
      logger.error({ queueName: queue.name, err }, "[scheduler] Failed to clean repeatable jobs");
    }
  }

  const cronJobs: Array<{
    name: string;
    pattern: string;
    jobId: string;
    queue: Queue;
  }> = [
    {
      name: "nightly-multi-source-discovery",
      pattern: "0 2 * * *",
      jobId: "multi-source-discovery-tick",
      queue: orchestratorQueue,
    },
    {
      name: "nightly-community-intent",
      pattern: "0 3 * * *",
      jobId: "community-intent-tick",
      queue: orchestratorQueue,
    },
    {
      name: "nightly-enrichment-refresh",
      pattern: "0 4 * * *",
      jobId: "enrichment-refresh-tick",
      queue: orchestratorQueue,
    },
    {
      name: "daily-campaign-health-check",
      pattern: "0 6 * * *",
      jobId: "campaign-health-check-tick",
      queue: maintenanceQueue,
    },
    {
      name: "daily-warmup-update",
      pattern: "30 0 * * *",
      jobId: "warmup-update-tick",
      queue: maintenanceQueue,
    },
    {
      name: "enrich-and-score",
      pattern: "15 */4 * * *",
      jobId: "enrich-and-score-tick",
      queue: orchestratorQueue,
    },
    {
      name: "reset-daily-counts",
      pattern: "0 0 * * *",
      jobId: "daily-send-reset",
      queue: maintenanceQueue,
    },
    {
      name: "cleanup-old-queue-jobs",
      pattern: "30 3 * * *",
      jobId: "queue-cleanup-tick",
      queue: maintenanceQueue,
    },
    {
      name: "recover-stuck-sending",
      pattern: "*/5 * * * *",
      jobId: "recover-stuck-sending-tick",
      queue: maintenanceQueue,
    },
    {
      name: "recover-stuck-sequence-steps",
      pattern: "1,6,11,16,21,26,31,36,41,46,51,56 * * * *",
      jobId: "recover-stuck-sequence-steps-tick",
      queue: maintenanceQueue,
    },
    {
      name: "poll-mailbox-replies",
      pattern: "2,7,12,17,22,27,32,37,42,47,52,57 * * * *",
      jobId: "mailbox-reply-poll-tick",
      queue: mailPollQueue,
    },
    {
      name: "scan-linkedin-steps",
      pattern: "3,8,13,18,23,28,33,38,43,48,53,58 * * * *",
      jobId: "linkedin-step-tick",
      queue: maintenanceQueue,
    },
    {
      name: "scan-email-sequence-steps",
      pattern: "4,9,14,19,24,29,34,39,44,49,54,59 * * * *",
      jobId: "email-sequence-step-tick",
      queue: maintenanceQueue,
    },
    {
      name: "scan-followup-leads",
      pattern: "0,10,20,30,40,50 * * * *",
      jobId: "followup-scheduler-tick",
      queue: maintenanceQueue,
    },
    {
      name: "poll-mailbox-delivery-events",
      pattern: "5,15,25,35,45,55 * * * *",
      jobId: "mailbox-delivery-poll-tick",
      queue: mailPollQueue,
    },
    {
      name: "scan-pending-objections",
      pattern: "0,15,30,45 * * * *",
      jobId: "pending-objections-tick",
      queue: maintenanceQueue,
    },
    {
      name: "scan-low-lead-campaigns",
      pattern: "30 * * * *",
      jobId: "low-lead-scanner-tick",
      queue: maintenanceQueue,
    },
  ];

  for (const { name, pattern, jobId, queue } of cronJobs) {
    await queue.add(name, {}, { repeat: { pattern }, jobId });
  }

  await maintenanceQueue.add(
    "scan-queued-campaigns",
    {},
    { repeat: { every: 60_000 }, jobId: "campaign-scheduler-tick" }
  );

  logger.info(
    "[scheduler] Campaign scheduler registered and locked (scan: 60s | followup: :00/:10/… | delivery-poll: :05/:15/… | objections: :00/:15/:30/:45 | stuck-sending: */5 | stuck-steps: +1m | replies: +2m | linkedin: +3m | email-steps: +4m | lead-topup: :30/hr | enrich: :15/4h | warmup: 00:30 | reset: 00:00 | discovery: 02:00 | community: 03:00 | cleanup: 03:30 | enrichment-refresh: 04:00 | health: 06:00)"
  );
}

export const queueEvents = new QueueEvents("campaign-orchestration", {
  connection: createRedisConnection(),
});

queueEvents.on("error", (error) => {
  logger.error({ error }, "[scheduler] QueueEvents error");
});

export const realtimeQueueEvents = new QueueEvents("campaign-realtime", {
  connection: createRedisConnection(),
});

realtimeQueueEvents.on("error", (error) => {
  logger.error({ error }, "[scheduler] RealtimeQueueEvents error");
});