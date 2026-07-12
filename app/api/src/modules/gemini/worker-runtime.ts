import { Worker, Queue, Job } from "bullmq";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { emitCampaignEvent, getJobLabel } from "../../lib/campaign-events";
import { CacheService } from "../../lib/cache";

export async function withHeartbeat<T>(
  job: Job,
  action: () => Promise<T>,
  lockDurationMs: number
): Promise<T> {
  const intervalMs = Math.max(5_000, Math.floor(lockDurationMs / 2));
  const timer = setInterval(() => {
    job.extendLock(job.token!, lockDurationMs).catch((err) =>
      logger.error({ jobId: job.id, err }, "[worker-runtime] Failed to extend job lock")
    );
  }, intervalMs);
  try {
    return await action();
  } finally {
    clearInterval(timer);
  }
}

async function dispatchTerminalFailureAlert(payload: {
  jobId: string | undefined;
  jobName: string | undefined;
  queueName: string;
  error: string;
  campaignId: string | undefined;
}): Promise<void> {
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: `🚨 *Terminal job failure*\nQueue: ${payload.queueName}\nJob: ${payload.jobName} (${payload.jobId})\nCampaign: ${payload.campaignId ?? "n/a"}\nError: ${payload.error}`,
        ...payload,
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (err) {
    logger.warn({ err }, "[worker-runtime] Alert webhook delivery failed");
  }
}

const openWorkers: Worker[] = [];
const openQueues: Queue[] = [];

export function registerForShutdown(target: Worker | Queue) {
  if (target instanceof Worker) openWorkers.push(target);
  else openQueues.push(target);
}

export async function shutdownAll(): Promise<void> {
  await Promise.all(openWorkers.map((w) => w.close()));
  await Promise.all(openQueues.map((q) => q.close()));
  await prisma.$disconnect();
}

let shutdownWired = false;
export function wireProcessShutdown(): void {
  if (shutdownWired) return;
  shutdownWired = true;
  process.on("SIGINT", async () => {
    await shutdownAll();
    process.exit(0);
  });
  process.on("SIGTERM", async () => {
    await shutdownAll();
    process.exit(0);
  });
}

export function wireWorkerEvents(w: Worker, queueName: string): void {
  w.on("active", async (job) => {
    const data = job.data as Record<string, unknown>;
    const campaignId = data?.campaignId as string | undefined;

    if (campaignId) {
      emitCampaignEvent({
        campaignId,
        type: "active",
        jobName: job.name,
        label: getJobLabel(job.name),
        detail: "Running",
      });
    }

    await prisma.queueJob.upsert({
      where: { bullJobId: job.id! },
      create: {
        bullJobId: job.id!,
        queueName,
        jobType: job.name,
        status: "ACTIVE",
        payload: data as any,
        attempts: job.attemptsMade,
        startedAt: new Date(),
        campaignId: campaignId ?? null,
      },
      update: {
        status: "ACTIVE",
        attempts: job.attemptsMade,
        startedAt: new Date(),
      },
    }).catch((err) => logger.error({ err, jobId: job.id }, "[worker-runtime] QueueJob upsert (active) failed"));
  });

  w.on("completed", async (job) => {
    const campaignId = (job.data as Record<string, unknown>)?.campaignId as string | undefined;
    logger.info({ jobId: job.id, jobName: job.name, queueName }, "[worker-runtime] Job completed");

    if (campaignId) {
      emitCampaignEvent({
        campaignId,
        type: "completed",
        jobName: job.name,
        label: getJobLabel(job.name),
        detail: "Completed",
      });
      await CacheService.invalidateVersioned(`version:campaign:${campaignId}`).catch((err) =>
        logger.error({ err, campaignId }, "[worker-runtime] Cache invalidation on job completion failed")
      );
    }

    await prisma.queueJob.updateMany({
      where: { bullJobId: job.id! },
      data: { status: "COMPLETED", result: (job.returnvalue ?? null) as any },
    }).catch((err) => logger.error({ err, jobId: job.id }, "[worker-runtime] QueueJob update (completed) failed"));
  });

  w.on("failed", async (job, err) => {
    const campaignId = (job?.data as Record<string, unknown>)?.campaignId as string | undefined;
    const terminal = !!job && job.attemptsMade >= (job.opts.attempts ?? 1);

    logger.error({ jobId: job?.id, jobName: job?.name, queueName, terminal, err }, "[worker-runtime] Job failed");

    if (campaignId && job) {
      emitCampaignEvent({
        campaignId,
        type: "failed",
        jobName: job.name,
        label: getJobLabel(job.name),
        detail: err.message?.slice(0, 120),
      });
      if (terminal) {
        await CacheService.invalidateVersioned(`version:campaign:${campaignId}`).catch((e) =>
          logger.error({ err: e, campaignId }, "[worker-runtime] Cache invalidation on job failure failed")
        );
        dispatchTerminalFailureAlert({
          jobId: job.id,
          jobName: job.name,
          queueName,
          error: err.message?.slice(0, 500) ?? "unknown",
          campaignId,
        }).catch(() => undefined);
      }
    }

    if (!job) return;

    await prisma.queueJob.updateMany({
      where: { bullJobId: job.id! },
      data: {
        status: terminal ? "FAILED" : "ACTIVE",
        attempts: job.attemptsMade,
        errorMessage: err.message?.slice(0, 2000),
      },
    }).catch((e) => logger.error({ e, jobId: job.id }, "[worker-runtime] QueueJob update (failed) failed"));
  });

  w.on("error", (error) => {
    logger.error({ error, queueName }, "[worker-runtime] Worker error");
  });

  registerForShutdown(w);
}
