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
  const metadataObj = (data.metadata || {}) as Record<string, unknown>;
  const campaignId = data.campaignId ?? (typeof metadataObj.campaignId === "string" ? metadataObj.campaignId : undefined);
  const leadId = data.leadId ?? (typeof metadataObj.leadId === "string" ? metadataObj.leadId : undefined);

  return prisma.aITrace.create({
    data: {
      ...data,
      ...(campaignId && { campaignId }),
      ...(leadId && { leadId }),
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

export interface OrgSpendResult {
  orgId: string;
  spentUsd: number;
  budgetUsd: number | null;
  exceeded: boolean;
  warning: boolean;
}

export async function checkOrgSpend(orgId: string): Promise<OrgSpendResult> {
  const rawBudget = process.env.LLM_MONTHLY_BUDGET_USD;
  const budgetUsd = rawBudget ? parseFloat(rawBudget) : null;

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const agg = await prisma.aITrace.aggregate({
    where: {
      campaign: { orgId },
      createdAt: { gte: monthStart },
    },
    _sum: { costUsd: true },
  });

  const spentUsd = agg._sum.costUsd ?? 0;

  return {
    orgId,
    spentUsd,
    budgetUsd,
    exceeded: budgetUsd !== null && spentUsd >= budgetUsd,
    warning: budgetUsd !== null && spentUsd >= budgetUsd * 0.8,
  };
}

export interface OrgTokenUsageSummary {
  orgId: string;
  windowDays: number;
  totalCalls: number;
  totalTokens: number;
  totalCostUsd: number;
  avgTokensPerCall: number;
  byAgent: Array<{ agentName: string; totalTokens: number; totalCostUsd: number; count: number }>;
  byModel: Array<{ model: string; totalTokens: number; totalCostUsd: number; count: number }>;
}

export async function getOrgTokenUsageStats(
  orgId: string,
  windowDays: number = 30
): Promise<OrgTokenUsageSummary> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60_000);

  const where: Prisma.AITraceWhereInput = {
    campaign: { orgId },
    createdAt: { gte: since },
  };

  const [totals, byAgent, byModel] = await Promise.all([
    prisma.aITrace.aggregate({
      where,
      _sum: { tokenUsage: true, costUsd: true, latencyMs: true },
      _count: { id: true },
      _avg: { tokenUsage: true },
    }),
    prisma.aITrace.groupBy({
      by: ["agentName"],
      where,
      _sum: { tokenUsage: true, costUsd: true },
      _count: { id: true },
      orderBy: { _sum: { tokenUsage: "desc" } },
    }),
    prisma.aITrace.groupBy({
      by: ["model"],
      where,
      _sum: { tokenUsage: true, costUsd: true },
      _count: { id: true },
      orderBy: { _sum: { tokenUsage: "desc" } },
    }),
  ]);

  return {
    orgId,
    windowDays,
    totalCalls: totals._count.id,
    totalTokens: totals._sum.tokenUsage ?? 0,
    totalCostUsd: totals._sum.costUsd ?? 0,
    avgTokensPerCall: Math.round(totals._avg.tokenUsage ?? 0),
    byAgent: byAgent.map((a) => ({
      agentName: a.agentName,
      totalTokens: a._sum.tokenUsage ?? 0,
      totalCostUsd: a._sum.costUsd ?? 0,
      count: a._count.id,
    })),
    byModel: byModel.map((m) => ({
      model: m.model,
      totalTokens: m._sum.tokenUsage ?? 0,
      totalCostUsd: m._sum.costUsd ?? 0,
      count: m._count.id,
    })),
  };
}