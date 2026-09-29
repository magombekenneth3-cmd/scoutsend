/**
 * Sprint 11 — Multi-Tenant Outbox Operator & Health Engine Service
 *
 * LOCATION: app/api/src/modules/outbox/outbox-operator.service.ts
 *
 * RESPONSIBILITIES:
 * 1. Multi-tenant mandatory scoping across all operator operations.
 * 2. Atomic, TOCTOU-free dead-letter replay with immutable OutboxOperatorAudit logging.
 * 3. 3-Window rolling operational health engine & deterministic status evaluation.
 */

import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import {
  evaluateOutboxHealth,
  type CurrentStateMetrics,
  type WindowMetrics,
  type OutboxHealthStatus,
} from "./outbox-health.config";

export interface InspectDeadLetterOptions {
  organizationId: string;
  limit?: number;
  aggregateType?: string;
  eventType?: string;
}

export interface DeadLetterInspectSummary {
  id: string;
  organizationId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  idempotencyKey: string;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
}

export interface ReplayOperatorParams {
  eventId: string;
  organizationId: string;
  operatorId: string;
  reason?: string;
}

export class OutboxOperatorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutboxOperatorError";
  }
}

// ─── 1. Tenant-Scoped Inspection ─────────────────────────────────────────────

export async function inspectDeadLetterEvents(
  options: InspectDeadLetterOptions,
): Promise<DeadLetterInspectSummary[]> {
  const { organizationId, limit = 50, aggregateType, eventType } = options;

  if (!organizationId) {
    throw new OutboxOperatorError("organizationId is mandatory for dead-letter inspection");
  }

  const events = await prisma.outboxEvent.findMany({
    where: {
      organizationId,
      status: "DEAD_LETTER",
      ...(aggregateType ? { aggregateType } : {}),
      ...(eventType ? { eventType } : {}),
    },
    select: {
      id: true,
      organizationId: true,
      eventType: true,
      aggregateType: true,
      aggregateId: true,
      idempotencyKey: true,
      attempts: true,
      lastError: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return events;
}

// ─── 2. Atomic TOCTOU-Free Replay & Audit ────────────────────────────────────

export async function replayDeadLetterEvent(
  params: ReplayOperatorParams,
): Promise<{ success: boolean; eventId: string; replayedAt: Date; auditId: string }> {
  const { eventId, organizationId, operatorId, reason } = params;

  if (!organizationId) {
    throw new OutboxOperatorError("organizationId is mandatory for dead-letter replay");
  }
  if (!operatorId) {
    throw new OutboxOperatorError("operatorId is mandatory for dead-letter replay");
  }

  const now = new Date();

  return prisma.$transaction(async (tx) => {
    // 1. Fetch original event state inside transaction to prevent TOCTOU races
    const existing = await tx.outboxEvent.findFirst({
      where: {
        id: eventId,
        organizationId,
        status: "DEAD_LETTER",
      },
    });

    if (!existing) {
      const anyEvent = await tx.outboxEvent.findUnique({ where: { id: eventId } });
      if (!anyEvent) {
        throw new OutboxOperatorError(`OutboxEvent ${eventId} not found`);
      }
      if (anyEvent.organizationId !== organizationId) {
        throw new OutboxOperatorError(`Access denied: OutboxEvent ${eventId} does not belong to organization ${organizationId}`);
      }
      throw new OutboxOperatorError(
        `OutboxEvent ${eventId} cannot be replayed — current status is ${anyEvent.status} (must be DEAD_LETTER)`,
      );
    }

    // 2. Perform atomic conditional update
    const updated = await tx.outboxEvent.updateMany({
      where: {
        id: eventId,
        organizationId,
        status: "DEAD_LETTER",
      },
      data: {
        status: "PENDING",
        attempts: 0,
        nextRetryAt: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: null,
      },
    });

    if (updated.count !== 1) {
      throw new OutboxOperatorError(`Replay race detected: OutboxEvent ${eventId} status changed concurrently`);
    }

    // 3. Create immutable audit log preserving original failure history
    const audit = await tx.outboxOperatorAudit.create({
      data: {
        organizationId,
        outboxEventId: eventId,
        operatorId,
        action: "REPLAY",
        previousStatus: existing.status,
        resultingStatus: "PENDING",
        previousAttempts: existing.attempts,
        previousLastError: existing.lastError,
        previousNextRetryAt: existing.nextRetryAt,
        previousLeaseToken: existing.leaseToken,
        reason: reason ?? "Manual operator replay",
      },
    });

    logger.info(
      {
        outboxEventId: eventId,
        organizationId,
        operatorId,
        auditId: audit.id,
        reason: reason ?? "Manual operator replay",
      },
      "[outbox.operator] OutboxEvent replayed from DEAD_LETTER to PENDING with audit log",
    );

    return {
      success: true,
      eventId,
      replayedAt: now,
      auditId: audit.id,
    };
  });
}

// ─── 3. 3-Window Health Engine ────────────────────────────────────────────────

async function calculateWindowMetrics(
  organizationId: string | undefined,
  windowMinutes: number,
  now: Date,
): Promise<WindowMetrics> {
  const windowStart = new Date(now.getTime() - windowMinutes * 60 * 1000);

  const attempts = await prisma.providerDeliveryAttempt.findMany({
    where: {
      ...(organizationId ? { organizationId } : {}),
      createdAt: { gte: windowStart },
    },
    select: {
      outcome: true,
      latencyMs: true,
    },
  });

  const fencingBreaches = await prisma.outboxFencingIncident.count({
    where: {
      ...(organizationId ? { organizationId } : {}),
      occurredAt: { gte: windowStart },
    },
  });

  const totalAttempts = attempts.length;
  let successfulAttempts = 0;
  let failedAttempts = 0;
  let totalLatencyMs = 0;
  let latencyCount = 0;

  for (const a of attempts) {
    if (a.outcome === "SUCCESS") {
      successfulAttempts++;
    } else if (a.outcome === "RETRYABLE_ERROR" || a.outcome === "PERMANENT_ERROR") {
      failedAttempts++;
    }
    if (typeof a.latencyMs === "number") {
      totalLatencyMs += a.latencyMs;
      latencyCount++;
    }
  }

  // Denominator protection: if totalAttempts === 0, rate is null (NO_DATA)
  const providerSuccessRate = totalAttempts > 0 ? Number((successfulAttempts / totalAttempts).toFixed(4)) : null;
  const providerFailureRate = totalAttempts > 0 ? Number((failedAttempts / totalAttempts).toFixed(4)) : null;
  const averageLatencyMs = latencyCount > 0 ? Math.round(totalLatencyMs / latencyCount) : null;

  return {
    windowMinutes,
    totalAttempts,
    successfulAttempts,
    failedAttempts,
    fencingBreaches,
    providerSuccessRate,
    providerFailureRate,
    averageLatencyMs,
  };
}

export async function getOutboxHealthEngineStatus(
  options: { organizationId?: string } = {},
): Promise<OutboxHealthStatus> {
  const now = new Date();
  const { organizationId } = options;

  const whereClause = organizationId ? { organizationId } : {};

  // Current State Metrics
  const statusCountsRaw = await prisma.outboxEvent.groupBy({
    by: ["status"],
    where: whereClause,
    _count: { _all: true },
  });

  const countsByStatus = {
    PENDING: 0,
    PROCESSING: 0,
    FAILED: 0,
    DEAD_LETTER: 0,
    SUCCEEDED: 0,
  };

  for (const item of statusCountsRaw) {
    if (item.status in countsByStatus) {
      countsByStatus[item.status as keyof typeof countsByStatus] = item._count._all;
    }
  }

  const oldestPending = await prisma.outboxEvent.findFirst({
    where: { ...whereClause, status: "PENDING" },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });

  const oldestProcessing = await prisma.outboxEvent.findFirst({
    where: { ...whereClause, status: "PROCESSING" },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  });

  const staleLeaseCount = await prisma.outboxEvent.count({
    where: {
      ...whereClause,
      status: "PROCESSING",
      leaseExpiresAt: { lte: now },
    },
  });

  const currentMetrics: CurrentStateMetrics = {
    pendingCount: countsByStatus.PENDING,
    processingCount: countsByStatus.PROCESSING,
    failedCount: countsByStatus.FAILED,
    deadLetterCount: countsByStatus.DEAD_LETTER,
    oldestPendingAgeSeconds: oldestPending ? Math.floor((now.getTime() - oldestPending.createdAt.getTime()) / 1000) : null,
    oldestProcessingAgeSeconds: oldestProcessing ? Math.floor((now.getTime() - oldestProcessing.createdAt.getTime()) / 1000) : null,
    staleLeaseCount,
  };

  // 3 Rolling Windows
  const [currentWin, shortTermWin, longTermWin] = await Promise.all([
    calculateWindowMetrics(organizationId, 5, now),
    calculateWindowMetrics(organizationId, 15, now),
    calculateWindowMetrics(organizationId, 60, now),
  ]);

  const windows = {
    current: currentWin,
    shortTerm: shortTermWin,
    longTerm: longTermWin,
  };

  const state = evaluateOutboxHealth(currentMetrics, windows);

  return {
    state,
    evaluatedAt: now,
    organizationId,
    current: currentMetrics,
    windows,
  };
}
