/**
 * Send Quota & Ledger Service (Sprint 2)
 *
 * Implements atomic quota reservation and settlement for Mailbox & Campaign scopes.
 *
 * Invariants:
 *  - Quota is linked to an `operationId` via `QuotaReservation`.
 *  - `(activeReserved + consumed) <= dailyLimit` is enforced under concurrency.
 *  - Settlement (`RESERVED` → `CONSUMED` / `RELEASED`) is idempotent and CAS-protected.
 *  - Single atomic transaction creates reservations alongside SendIntent.
 */

import { prisma } from "../prisma";
import { logger } from "../logger";
import { transitionState } from "../state/transition-state";
import type { TransitionAuthority } from "../state/transition-state";
import type { Prisma } from "@prisma/client";
import { QuotaScope, QuotaReservationStatus } from "@prisma/client";

const DEFAULT_RESERVATION_TTL_MS = 15 * 60_000; // 15 minutes

export interface QuotaCheckResult {
  allowed: boolean;
  scope: QuotaScope;
  scopeId: string;
  limit: number;
  currentUsed: number;
  activeReserved: number;
  reason?: string;
}

/**
 * Get start of current UTC daily window for quota calculations.
 */
export function getDailyWindowStart(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * Check if mailbox has capacity to reserve 1 quota unit.
 */
export async function checkMailboxQuota(params: {
  mailboxId: string;
  tx: Prisma.TransactionClient;
}): Promise<QuotaCheckResult> {
  const client = params.tx;
  const now = new Date();
  const windowStart = getDailyWindowStart(now);

  // Row-level lock to serialize concurrent quota check + reservation transactions
  await client.$queryRaw`SELECT "id" FROM "SenderMailbox" WHERE "id" = ${params.mailboxId} FOR UPDATE`;

  const mailbox = await client.senderMailbox.findUnique({
    where: { id: params.mailboxId },
    select: { id: true, dailyLimit: true, currentSent: true, health: true },
  });

  if (!mailbox) {
    return {
      allowed: false,
      scope: QuotaScope.MAILBOX,
      scopeId: params.mailboxId,
      limit: 0,
      currentUsed: 0,
      activeReserved: 0,
      reason: "Mailbox not found",
    };
  }

  if (mailbox.health === "BLOCKED" || mailbox.health === "DEGRADED") {
    return {
      allowed: false,
      scope: QuotaScope.MAILBOX,
      scopeId: params.mailboxId,
      limit: mailbox.dailyLimit,
      currentUsed: mailbox.currentSent,
      activeReserved: 0,
      reason: `Mailbox health is ${mailbox.health}`,
    };
  }

  // Count active reservations in current window
  const activeReservations = await client.quotaReservation.aggregate({
    where: {
      scope: QuotaScope.MAILBOX,
      scopeId: params.mailboxId,
      status: QuotaReservationStatus.RESERVED,
      expiresAt: { gt: now },
      windowStart: { gte: windowStart },
    },
    _sum: { amount: true },
  });

  const activeReserved = activeReservations._sum.amount ?? 0;
  const currentUsed = mailbox.currentSent;
  const totalAllocated = currentUsed + activeReserved;

  if (totalAllocated >= mailbox.dailyLimit) {
    return {
      allowed: false,
      scope: QuotaScope.MAILBOX,
      scopeId: params.mailboxId,
      limit: mailbox.dailyLimit,
      currentUsed,
      activeReserved,
      reason: `Mailbox daily limit reached (${totalAllocated}/${mailbox.dailyLimit})`,
    };
  }

  return {
    allowed: true,
    scope: QuotaScope.MAILBOX,
    scopeId: params.mailboxId,
    limit: mailbox.dailyLimit,
    currentUsed,
    activeReserved,
  };
}

/**
 * Check if campaign has capacity to reserve 1 quota unit.
 */
export async function checkCampaignQuota(params: {
  campaignId: string;
  tx: Prisma.TransactionClient;
}): Promise<QuotaCheckResult> {
  const client = params.tx;
  const now = new Date();
  const windowStart = getDailyWindowStart(now);

  // Row-level lock to serialize concurrent campaign quota check + reservation transactions
  await client.$queryRaw`SELECT "id" FROM "Campaign" WHERE "id" = ${params.campaignId} FOR UPDATE`;

  const campaign = await client.campaign.findUnique({
    where: { id: params.campaignId },
    select: { id: true, dailySendLimit: true, status: true },
  });

  if (!campaign) {
    return {
      allowed: false,
      scope: QuotaScope.CAMPAIGN,
      scopeId: params.campaignId,
      limit: 0,
      currentUsed: 0,
      activeReserved: 0,
      reason: "Campaign not found",
    };
  }

  const activeReservations = await client.quotaReservation.aggregate({
    where: {
      scope: QuotaScope.CAMPAIGN,
      scopeId: params.campaignId,
      status: QuotaReservationStatus.RESERVED,
      expiresAt: { gt: now },
      windowStart: { gte: windowStart },
    },
    _sum: { amount: true },
  });

  const activeReserved = activeReservations._sum.amount ?? 0;

  // Consumed reservations in current window
  const consumedReservations = await client.quotaReservation.aggregate({
    where: {
      scope: QuotaScope.CAMPAIGN,
      scopeId: params.campaignId,
      status: QuotaReservationStatus.CONSUMED,
      windowStart: { gte: windowStart },
    },
    _sum: { amount: true },
  });

  const currentUsed = consumedReservations._sum.amount ?? 0;
  const totalAllocated = currentUsed + activeReserved;

  if (totalAllocated >= campaign.dailySendLimit) {
    return {
      allowed: false,
      scope: QuotaScope.CAMPAIGN,
      scopeId: params.campaignId,
      limit: campaign.dailySendLimit,
      currentUsed,
      activeReserved,
      reason: `Campaign daily send limit reached (${totalAllocated}/${campaign.dailySendLimit})`,
    };
  }

  return {
    allowed: true,
    scope: QuotaScope.CAMPAIGN,
    scopeId: params.campaignId,
    limit: campaign.dailySendLimit,
    currentUsed,
    activeReserved,
  };
}

/**
 * Create a QuotaReservation record inside a transaction.
 */
export async function createQuotaReservation(
  tx: any,
  params: {
    operationId: string;
    scope: QuotaScope;
    scopeId: string;
    amount?: number;
    ttlMs?: number;
  },
): Promise<any> {
  const { operationId, scope, scopeId, amount = 1, ttlMs = DEFAULT_RESERVATION_TTL_MS } = params;
  const now = new Date();
  const windowStart = getDailyWindowStart(now);
  const expiresAt = new Date(now.getTime() + ttlMs);

  return await tx.quotaReservation.create({
    data: {
      operationId,
      scope,
      scopeId,
      amount,
      status: QuotaReservationStatus.RESERVED,
      windowStart,
      expiresAt,
      version: 1,
    },
  });
}

/**
 * Settle all QuotaReservation records for an operationId.
 * Idempotently transitions RESERVED → CONSUMED or RESERVED → RELEASED.
 */
export async function settleQuotaReservation(params: {
  operationId: string;
  targetStatus: "CONSUMED" | "RELEASED";
  workerId?: string;
}): Promise<{ settledCount: number; alreadySettled: boolean }> {
  const { operationId, targetStatus, workerId = "SYSTEM" } = params;

  return await prisma.$transaction(async (tx) => {
    const reservations = await tx.quotaReservation.findMany({
      where: { operationId },
      select: { id: true, scope: true, scopeId: true, amount: true, status: true, version: true },
    });

    if (reservations.length === 0) {
      return { settledCount: 0, alreadySettled: false };
    }

    const alreadySettled = reservations.every((r) => r.status === targetStatus);
    if (alreadySettled) {
      return { settledCount: reservations.length, alreadySettled: true };
    }

    let settledCount = 0;

    for (const res of reservations) {
      if (res.status === targetStatus) {
        continue;
      }

      if (res.status !== QuotaReservationStatus.RESERVED) {
        logger.warn(
          { reservationId: res.id, currentStatus: res.status, targetStatus },
          "[quota-settlement] Skipping settlement for non-RESERVED status",
        );
        continue;
      }

      const authority: TransitionAuthority = {
        actorType: workerId ? "WORKER" : "SYSTEM",
        actorId: operationId,
        workerId,
        operationId,
      };

      const result = await transitionState(tx, {
        model: "QuotaReservation",
        entityId: res.id,
        expectedState: "RESERVED",
        expectedVersion: res.version,
        nextState: targetStatus,
        authority,
      });

      if (result.success) {
        settledCount++;

        // If Mailbox CONSUMED, update currentSent on SenderMailbox
        if (targetStatus === "CONSUMED" && res.scope === QuotaScope.MAILBOX) {
          await tx.senderMailbox.update({
            where: { id: res.scopeId },
            data: {
              currentSent: { increment: res.amount },
              totalSent: { increment: res.amount },
            },
            select: { id: true },
          });
        }
      }
    }

    logger.info(
      { operationId, targetStatus, settledCount },
      "[quota-settlement] Settled reservations",
    );

    return { settledCount, alreadySettled: false };
  });
}
