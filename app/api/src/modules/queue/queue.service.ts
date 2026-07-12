import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { getQueueJobsQuerySchema } from "./queue.schema";
import { campaignQueue } from "../gemini/campaign.scheduler";

export async function getQueueJobs(query: z.infer<typeof getQueueJobsQuerySchema>, userId: string) {
  const { campaignId, queueName, jobType, status, page, limit } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.QueueJobWhereInput = {
    campaign: { createdById: userId },
    ...(campaignId && { campaignId }),
    ...(queueName && { queueName }),
    ...(jobType && { jobType }),
    ...(status && { status }),
  };

  const [jobs, total] = await prisma.$transaction([
    prisma.queueJob.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        campaign: { select: { id: true, name: true, status: true } },
      },
    }),
    prisma.queueJob.count({ where }),
  ]);

  return {
    data: jobs,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

export async function getQueueJobById(id: string, userId: string) {
  return prisma.queueJob.findFirst({
    where: { id, campaign: { createdById: userId } },
    include: {
      campaign: { select: { id: true, name: true, status: true } },
    },
  });
}

export async function getQueueStats() {
  const statuses = ["WAITING", "ACTIVE", "COMPLETED", "FAILED", "DELAYED"] as const;

  const [statusCounts, queueNames, failedRecent] = await Promise.all([
    Promise.all(statuses.map((s) => prisma.queueJob.count({ where: { status: s } }))),
    prisma.queueJob.findMany({
      distinct: ["queueName"],
      select: { queueName: true },
      orderBy: { queueName: "asc" },
    }),
    prisma.queueJob.findMany({
      where: { status: "FAILED" },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: {
        id: true,
        queueName: true,
        jobType: true,
        attempts: true,
        errorMessage: true,
        campaignId: true,
        updatedAt: true,
      },
    }),
  ]);

  const byStatus = Object.fromEntries(statuses.map((s, i) => [s, statusCounts[i]]));

  const queueCountEntries = await Promise.all(
    queueNames.map(async ({ queueName }) => {
      const counts = await Promise.all(
        statuses.map((s) => prisma.queueJob.count({ where: { queueName, status: s } }))
      );
      return [queueName, Object.fromEntries(statuses.map((s, i) => [s, counts[i]]))] as const;
    })
  );

  return {
    byStatus,
    byQueue: Object.fromEntries(queueCountEntries),
    recentFailures: failedRecent,
  };
}

export async function retryQueueJob(id: string, userId: string) {
  const job = await prisma.queueJob.findFirst({
    where: { id, campaign: { createdById: userId } },
  });
  if (!job) throw new Error("Queue job not found");
  if (job.status !== "FAILED") throw new Error("Only failed jobs can be retried");

  const updated = await prisma.queueJob.update({
    where: { id },
    data: { status: "WAITING", errorMessage: null, attempts: 0 },
    include: {
      campaign: { select: { id: true, name: true, status: true } },
    },
  });

  await campaignQueue.add(
    "run-pipeline",
    { campaignId: updated.campaignId, triggeredBy: "retry" },
    { jobId: `run-pipeline-${updated.campaignId}-retry-${id}` }
  );

  return updated;

}