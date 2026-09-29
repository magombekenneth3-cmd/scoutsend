/**
 * warmup-apply.service.ts — Atomic application of warmup decisions.
 *
 * This is the ONLY path through which warmup state and limits change.
 *
 * Contract:
 *   1. Validates transition via StateTransitionRegistry
 *   2. Atomically updates entity state + limit + counters
 *   3. Writes WarmupDecisionLog (audit trail)
 *   4. Creates OutboxEvent (fence relay)
 *   5. INV-3:  PAUSE preserves dailyLimit
 *   6. INV-12: effectiveLimit on PAUSE = currentLimit
 *   7. INV-13: Decision is readonly — persisted as-is, never recomputed
 *
 * System law:
 *   Engine proposes → Registry validates → THIS SERVICE applies.
 */

import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import {
  validateTransition,
} from "../../lib/state/state-transition-registry";
import type {
  WarmupDecision,
  WarmupState,
} from "../../lib/warmup/warmup-types.js";

// ─── Types ───────────────────────────────────────────────────────────────────

interface WarmupEntity {
  readonly id: string;
  readonly warmupState: string;
  readonly warmupFenceVersion: number;
  readonly dailyLimit: number;
  readonly warmupDay: number;
  readonly orgId: string | null;
}

export type WarmupModelType = "SenderMailbox" | "SenderDomain";

interface ApplyResult {
  readonly success: boolean;
  readonly reason?: "NO_CHANGE" | "VALIDATION_ERROR" | "DB_ERROR";
}

// ─── Core ────────────────────────────────────────────────────────────────────

/**
 * Apply a warmup decision atomically.
 *
 * This function:
 *   1. Validates the state transition (if state is changing)
 *   2. Updates the entity row atomically
 *   3. Writes a WarmupDecisionLog row
 *   4. Creates an OutboxEvent for fence relay (on state change)
 *
 * All writes happen inside a single Prisma transaction.
 */
export async function applyWarmupDecision(
  model: WarmupModelType,
  entity: WarmupEntity,
  decision: WarmupDecision,
): Promise<ApplyResult> {
  const registryModel = model === "SenderMailbox" ? "WarmupMailbox" : "WarmupDomain";
  const previousState = entity.warmupState as WarmupState;
  const stateChanged = decision.nextState !== previousState;

  // ── 1. Validate transition ────────────────────────────────────────────
  if (stateChanged) {
    try {
      validateTransition(registryModel, previousState, decision.nextState);
    } catch (err) {
      logger.warn(
        {
          model,
          entityId: entity.id,
          from: previousState,
          to: decision.nextState,
          err: (err as Error).message,
        },
        "[warmup-apply] Illegal transition rejected by registry",
      );
      return { success: false, reason: "VALIDATION_ERROR" };
    }
  }

  // ── 2. Compute update data ────────────────────────────────────────────
  //
  // INV-3/INV-12: On PAUSE, dailyLimit is NOT changed.
  // The pause is enforced by warmupState=PAUSED + fence, not by dailyLimit=0.

  const isPausing = decision.action === "PAUSE";

  const newFenceVersion = isPausing
    ? entity.warmupFenceVersion + 1
    : entity.warmupFenceVersion;

  const updateData: Record<string, unknown> = {
    warmupState: decision.nextState,
    warmupFenceVersion: newFenceVersion,
    consecutiveHealthyEvals: decision.consecutiveHealthyEvals,
    consecutiveDegradedEvals: decision.consecutiveDegradedEvals,
  };

  // Only update dailyLimit when NOT pausing (INV-3)
  if (!isPausing && decision.effectiveLimit !== entity.dailyLimit) {
    updateData.dailyLimit = decision.effectiveLimit;
  }

  // Map health to DomainHealth enum
  const healthMapping: Record<string, string> = {
    CRITICAL: "BLOCKED",
    DEGRADED: "WARNING",
    HEALTHY: "HEALTHY",
  };
  if (stateChanged || decision.healthAssessment.health !== "HEALTHY") {
    updateData.health = healthMapping[decision.healthAssessment.health] ?? "HEALTHY";
  }

  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // ── 2a. Update entity ─────────────────────────────────────────────
      if (model === "SenderMailbox") {
        await tx.senderMailbox.update({
          where: { id: entity.id },
          data: updateData,
          select: { id: true },
        });
      } else {
        await tx.senderDomain.update({
          where: { id: entity.id },
          data: updateData,
          select: { id: true },
        });
      }

      // ── 2b. Write decision log ────────────────────────────────────────
      await tx.warmupDecisionLog.create({
        data: {
          scope: decision.scope,
          entityId: entity.id,
          policyVersion: decision.policyVersion,
          inputHash: decision.inputHash,
          action: decision.action,
          previousState: previousState,
          nextState: decision.nextState,
          previousLimit: entity.dailyLimit,
          effectiveLimit: decision.effectiveLimit,
          targetLimit: decision.targetLimit,
          health: decision.healthAssessment.health,
          reasons: decision.reasons as unknown as Prisma.InputJsonValue,
          insufficientData: decision.insufficientData,
          consecutiveHealthyEvals: decision.consecutiveHealthyEvals,
          consecutiveDegradedEvals: decision.consecutiveDegradedEvals,
          fenceVersion: newFenceVersion,
          warmupDay: entity.warmupDay,
          ...(model === "SenderMailbox"
            ? { senderMailboxId: entity.id }
            : { senderDomainId: entity.id }),
        },
      });

      // ── 2c. Create outbox event on state change ───────────────────────
      if (stateChanged && entity.orgId) {
        await tx.outboxEvent.create({
          data: {
            organizationId: entity.orgId,
            aggregateType: model,
            aggregateId: entity.id,
            aggregateVersion: newFenceVersion,
            eventType: isPausing
              ? "WARMUP_PAUSED"
              : `WARMUP_STATE_CHANGED`,
            payload: {
              previousState,
              nextState: decision.nextState,
              action: decision.action,
              effectiveLimit: decision.effectiveLimit,
              fenceVersion: newFenceVersion,
              policyVersion: decision.policyVersion,
              inputHash: decision.inputHash,
            },
            idempotencyKey: `warmup:${entity.id}:v${newFenceVersion}:${decision.inputHash.slice(0, 12)}`,
          },
        });
      }
    });

    logger.info(
      {
        model,
        entityId: entity.id,
        action: decision.action,
        from: previousState,
        to: decision.nextState,
        prevLimit: entity.dailyLimit,
        newLimit: isPausing ? entity.dailyLimit : decision.effectiveLimit,
        fenceVersion: newFenceVersion,
        health: decision.healthAssessment.health,
      },
      "[warmup-apply] Decision applied",
    );

    return { success: true };

  } catch (err) {
    logger.error(
      {
        model,
        entityId: entity.id,
        err: (err as Error).message,
      },
      "[warmup-apply] Failed to apply decision",
    );
    return { success: false, reason: "DB_ERROR" };
  }
}
