import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  getAITracesQuerySchema,
  createAITraceSchema,
} from "./aitrace.schema";


export async function createAITrace(
  data: z.infer<typeof createAITraceSchema>
) {
  return prisma.aITrace.create({
    data: {
      ...data,
      metadata: data.metadata as Prisma.InputJsonValue,
    },
  });
}


export async function getAITraces(
  query: z.infer<typeof getAITracesQuerySchema>
) {
  const { agentName, model, minConfidence, maxConfidence, from, to, page, limit } =
    query;
  const skip = (page - 1) * limit;

  const where: Prisma.AITraceWhereInput = {
    ...(agentName && { agentName }),
    ...(model && { model }),
    ...(minConfidence !== undefined && {
      confidence: { gte: minConfidence },
    }),
    ...(maxConfidence !== undefined && {
      confidence: { lte: maxConfidence },
    }),
    ...(from || to
      ? {
        createdAt: {
          ...(from && { gte: from }),
          ...(to && { lte: to }),
        },
      }
      : {}),
  };

  const [traces, total] = await prisma.$transaction([
    prisma.aITrace.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        agentName: true,
        model: true,
        latencyMs: true,
        tokenUsage: true,
        confidence: true,
        metadata: true,
        createdAt: true,
      },
    }),
    prisma.aITrace.count({ where }),
  ]);

  return {
    data: traces,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}


export async function getAITraceById(id: string) {
  return prisma.aITrace.findUnique({ where: { id } });
}


export async function getAITraceStats(windowdays: number = 30) {
  const since = new Date();
  since.setDate(since.getDate() - windowdays);
  const where = { createdAt: { gte: since } };
  const [totals, byAgent, byModel, recentFailures] = await Promise.all([

    prisma.aITrace.aggregate({
      where,
      _count: { id: true },
      _sum: { tokenUsage: true, latencyMs: true },
      _avg: { latencyMs: true, confidence: true, tokenUsage: true },
    }),


    prisma.aITrace.groupBy({
      by: ["agentName"],
      where,
      _count: { id: true },
      _avg: { latencyMs: true, confidence: true, tokenUsage: true },
      _sum: { tokenUsage: true },
      orderBy: { _count: { id: "desc" } },
    }),


    prisma.aITrace.groupBy({
      by: ["model"],
      where,
      _count: { id: true },
      _avg: { latencyMs: true, tokenUsage: true },
      _sum: { tokenUsage: true },
      orderBy: { _count: { id: "desc" } },
    }),
    prisma.aITrace.findMany({
      where: { confidence: { lt: 0.5 }, ...where },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        agentName: true,
        model: true,
        confidence: true,
        latencyMs: true,
        metadata: true,
        createdAt: true,
      },
    }),
  ]);

  return {
    totals: {
      count: totals._count.id,
      totalTokens: totals._sum.tokenUsage ?? 0,
      totalLatencyMs: totals._sum.latencyMs ?? 0,
      avgLatencyMs: totals._avg.latencyMs ?? 0,
      avgConfidence: totals._avg.confidence ?? null,
      avgTokensPerCall: totals._avg.tokenUsage ?? 0,
    },
    byAgent,
    byModel,
    lowConfidenceTraces: recentFailures,
  };
}


export async function deleteAITrace(id: string) {
  return prisma.aITrace.delete({ where: { id } });
}


export async function pruneOldAITraces(retentionDays = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);

  const { count } = await prisma.aITrace.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  return count;
}