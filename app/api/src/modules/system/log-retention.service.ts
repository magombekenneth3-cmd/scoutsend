import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";

export interface LogRetentionConfig {
  auditLogDays: number;
  crmSyncDays: number;
  deliverabilityEventDays: number;
  aiTraceDays: number;
  queueJobDays: number;
  learningEventDays: number;
}

export function getRetentionConfig(): LogRetentionConfig {
  return {
    auditLogDays: Math.max(1, parseInt(process.env.LOG_RETENTION_AUDIT_DAYS ?? "90", 10)),
    crmSyncDays: Math.max(1, parseInt(process.env.LOG_RETENTION_CRM_SYNC_DAYS ?? "30", 10)),
    deliverabilityEventDays: Math.max(1, parseInt(process.env.LOG_RETENTION_DELIVERABILITY_DAYS ?? "30", 10)),
    aiTraceDays: Math.max(1, parseInt(process.env.LOG_RETENTION_AI_TRACE_DAYS ?? "30", 10)),
    queueJobDays: Math.max(1, parseInt(process.env.LOG_RETENTION_QUEUE_JOB_DAYS ?? "30", 10)),
    learningEventDays: Math.max(1, parseInt(process.env.LOG_RETENTION_LEARNING_EVENT_DAYS ?? "90", 10)),
  };
}

/**
  * Deletes expired records in batches to prevent query timeouts and lock contention.
  */
async function deleteInBatches(
  deleteChunk: (cutoff: Date, limit: number) => Promise<number>,
  cutoff: Date,
  batchSize = 2500,
  maxBatches = 20
): Promise<number> {
  let totalDeleted = 0;
  for (let i = 0; i < maxBatches; i++) {
    const deletedCount = await deleteChunk(cutoff, batchSize);
    totalDeleted += deletedCount;
    if (deletedCount < batchSize) break;
  }
  return totalDeleted;
}

export async function runLogRetentionPurge(
  customConfig?: Partial<LogRetentionConfig>
): Promise<Record<string, number>> {
  const config = { ...getRetentionConfig(), ...customConfig };
  const now = Date.now();

  const auditCutoff = new Date(now - config.auditLogDays * 24 * 60 * 60_000);
  const crmSyncCutoff = new Date(now - config.crmSyncDays * 24 * 60 * 60_000);
  const deliverabilityCutoff = new Date(now - config.deliverabilityEventDays * 24 * 60 * 60_000);
  const aiTraceCutoff = new Date(now - config.aiTraceDays * 24 * 60 * 60_000);
  const queueJobCutoff = new Date(now - config.queueJobDays * 24 * 60 * 60_000);
  const learningEventCutoff = new Date(now - config.learningEventDays * 24 * 60 * 60_000);

  const results: Record<string, number> = {
    auditLogs: 0,
    crmSyncLogs: 0,
    deliverabilityEvents: 0,
    aiTraces: 0,
    queueJobs: 0,
    learningEvents: 0,
  };

  try {
    results.auditLogs = await deleteInBatches(async (cutoff, limit) => {
      const { count } = await prisma.auditLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      return count;
    }, auditCutoff);
  } catch (err) {
    logger.error({ err }, "[log-retention] Failed to purge AuditLog records");
  }

  try {
    results.crmSyncLogs = await deleteInBatches(async (cutoff, limit) => {
      const { count } = await prisma.crmSyncLog.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      return count;
    }, crmSyncCutoff);
  } catch (err) {
    logger.error({ err }, "[log-retention] Failed to purge CrmSyncLog records");
  }

  try {
    results.deliverabilityEvents = await deleteInBatches(async (cutoff, limit) => {
      const { count } = await prisma.deliverabilityEvent.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      return count;
    }, deliverabilityCutoff);
  } catch (err) {
    logger.error({ err }, "[log-retention] Failed to purge DeliverabilityEvent records");
  }

  try {
    results.aiTraces = await deleteInBatches(async (cutoff, limit) => {
      const { count } = await prisma.aITrace.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      return count;
    }, aiTraceCutoff);
  } catch (err) {
    logger.error({ err }, "[log-retention] Failed to purge AITrace records");
  }

  try {
    results.queueJobs = await deleteInBatches(async (cutoff, limit) => {
      const { count } = await prisma.queueJob.deleteMany({
        where: {
          status: { in: ["COMPLETED", "FAILED", "WAITING", "PAUSED"] },
          createdAt: { lt: cutoff },
        },
      });
      return count;
    }, queueJobCutoff);
  } catch (err) {
    logger.error({ err }, "[log-retention] Failed to purge QueueJob records");
  }

  try {
    results.learningEvents = await deleteInBatches(async (cutoff, limit) => {
      const { count } = await prisma.learningEvent.deleteMany({
        where: { createdAt: { lt: cutoff } },
      });
      return count;
    }, learningEventCutoff);
  } catch (err) {
    logger.error({ err }, "[log-retention] Failed to purge LearningEvent records");
  }

  logger.info({ results, config }, "[log-retention] Completed log retention purge execution");
  return results;
}
