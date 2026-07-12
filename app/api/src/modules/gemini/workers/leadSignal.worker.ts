import { Worker } from "bullmq";
import { prisma } from "../../../lib/prisma";
import { createRedisConnection, redis } from "../../../lib/ioredis";
import { QUEUE_POLICY } from "../queue-policy";
import { wireWorkerEvents } from "../worker-runtime";
import { logger } from "../../../lib/logger";
import { enrichThenScore } from "../enrichToScore";
import { runResearchAgent } from "../gemini.agent";
import { runGenerateAgent } from "../generate.agent";
import { runReviewAgent } from "../review.agent";

const policy = QUEUE_POLICY.leadSignal;
const AGENT_TIMEOUT_MS = 5 * 60_000;

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Agent timed out after ${ms}ms`)), ms)
    ),
  ]);

async function processJob(job: import("bullmq").Job) {
  const log = logger.child({ jobId: job.id, jobName: job.name, correlationId: job.data?.correlationId });

  switch (job.name) {
    case "signal-accelerate-lead": {
      const { leadId, campaignId, signalType, confidence, source } = job.data as {
        leadId: string;
        campaignId: string;
        signalType: string;
        confidence: number;
        source: string;
      };

      const lockKey = `signal-accelerate-lock:${leadId}`;
      const acquired = await redis.set(lockKey, "1", "PX", 5 * 60_000, "NX");
      if (!acquired) {
        log.info({ leadId, signalType }, "[signal-ingestion] Concurrent acceleration already running for lead — skipping");
        return { leadId, skipped: true, reason: "concurrent_lock" };
      }

      try {
        log.info(
          { leadId, campaignId, signalType, confidence, source },
          "[signal-ingestion] Accelerating lead pipeline due to high-value signal",
        );

        await withTimeout(
          enrichThenScore([leadId], campaignId),
          AGENT_TIMEOUT_MS * 2,
        );

        const lead = await prisma.lead.findUnique({
          where: { id: leadId },
          select: {
            qualificationScore: true,
            recommendedAction: true,
            campaign: { select: { icpDescription: true, qualificationThreshold: true } },
          },
        });

        const threshold =
          typeof lead?.campaign?.qualificationThreshold === "number" &&
          lead.campaign.qualificationThreshold >= 0 &&
          lead.campaign.qualificationThreshold <= 1
            ? lead.campaign.qualificationThreshold
            : 0.40;

        if (
          !lead ||
          lead.recommendedAction === "DISQUALIFY" ||
          (lead.qualificationScore !== null && lead.qualificationScore < threshold)
        ) {
          log.info({ leadId, threshold }, "[signal-ingestion] Lead below threshold post-signal — skipping");
          return { leadId, skipped: true, reason: "below_threshold" };
        }

        await withTimeout(runResearchAgent(campaignId, leadId), AGENT_TIMEOUT_MS);
        await withTimeout(runGenerateAgent(campaignId), AGENT_TIMEOUT_MS);
        await withTimeout(runReviewAgent(campaignId, { followUpPass: true }), AGENT_TIMEOUT_MS);

        await prisma.queueJob.updateMany({
          where: {
            campaignId,
            jobType: "SIGNAL_ACCELERATE",
            status: "WAITING",
            payload: { path: ["leadId"], equals: leadId },
          },
          data: { status: "COMPLETED" },
        }).catch(() => null);

        log.info(
          { leadId, campaignId, signalType },
          "[signal-ingestion] Accelerated pipeline complete",
        );

        return { leadId, campaignId, signalType };
      } finally {
        await redis.del(lockKey);
      }
    }

    default:
      throw new Error(`[leadSignal.worker] Unknown job type: ${job.name}`);
  }
}

export const leadSignalWorker = new Worker(policy.queueName, processJob, {
  connection: createRedisConnection(),
  concurrency: policy.concurrency,
  lockDuration: policy.lockDuration,
});

wireWorkerEvents(leadSignalWorker, policy.queueName);
