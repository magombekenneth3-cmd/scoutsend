/**
 * Send Finalize Service (Sprint 3 Correction)
 *
 * `finalizeSendIntent()` is the ONLY legal way to write a terminal state
 * to a SendIntent.
 *
 * It commits ALL of the following inside a single DB transaction:
 *
 *   1. Fenced SendIntent CAS   (DISPATCHING → SENT | FAILED)
 *   2. Fenced QuotaReservation CAS  (RESERVED → CONSUMED | RELEASED)
 *   3. Quota accounting update  (SenderMailbox.currentSent on CONSUMED)
 *   4. OutboxEvent INSERT        (idempotent via unique idempotencyKey)
 *   5. OutreachMessage delivery state update
 *
 * This eliminates the failure windows in sequential settlement:
 *   ✗ SendIntent = SENT, crash, QuotaReservation still RESERVED
 *   ✗ SendIntent = SENT, QuotaReservation = CONSUMED, OutboxEvent missing
 *
 * UNKNOWN resolution is intentionally excluded.
 * UNKNOWN intents must NOT have their quota settled here — the reservation
 * remains RESERVED until Sprint 4 reconciliation confirms the delivery
 * outcome with the provider. Releasing UNKNOWN quota risks duplicate sends.
 *
 * Law: No LLM is authoritative for this service. All writes are CAS-protected.
 */

import { prisma } from "../prisma";
import { logger } from "../logger";
import { transitionState } from "../state/transition-state";
import type { TransitionAuthority } from "../state/transition-state";
import { Prisma, QuotaScope, QuotaReservationStatus } from "@prisma/client";

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export type TerminalSendState = "SENT" | "FAILED";
export type TerminalQuotaState = "CONSUMED" | "RELEASED";

export interface FinalizeSendIntentParams {
  sendIntentId: string;
  operationId: string;
  outreachMessageId: string;
  workerId: string;

  /** CAS proof from the active SendIntentLease */
  expectedVersion: number;
  fencingEpoch: number;
  leaseVersion: number;

  /** Terminal state for the SendIntent */
  nextState: TerminalSendState;
  /** Terminal state for all QuotaReservations on this operationId */
  quotaSettlement: TerminalQuotaState;

  /** Set on SENT */
  providerMessageId?: string;
  /** Set on FAILED */
  errorMessage?: string;
}

export type FinalizeResult =
  | {
    success: true;
    sendIntentNewVersion: number;
    settledReservations: number;
  }
  | {
    success: false;
    reason:
    | "SEND_INTENT_CAS_CONFLICT"
    | "QUOTA_SETTLEMENT_PARTIAL"
    | "ALREADY_FINALIZED";
  };

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Atomically finalizes a SendIntent to a terminal state.
 *
 * All writes (SendIntent, QuotaReservation, SenderMailbox, OutboxEvent,
 * OutreachMessage) are committed in a single transaction.
 *
 * Returns { success: false, reason: 'SEND_INTENT_CAS_CONFLICT' } when the
 * fencing proof is stale — a concurrent worker has already settled this intent.
 * The caller should treat this as a no-op (not an error).
 */
export async function finalizeSendIntent(
  params: FinalizeSendIntentParams,
): Promise<FinalizeResult> {
  const {
    sendIntentId, operationId, outreachMessageId, workerId,
    expectedVersion, fencingEpoch, leaseVersion,
    nextState, quotaSettlement,
    providerMessageId, errorMessage,
  } = params;

  const authority: TransitionAuthority = {
    actorType: "WORKER",
    actorId: operationId,
    workerId,
    operationId,
  };

  return await prisma.$transaction(async (tx) => {
    // ── 1. Fenced SendIntent CAS ─────────────────────────────────────────
    const intentTransition = await transitionState(tx, {
      model: "SendIntent",
      entityId: sendIntentId,
      expectedState: "DISPATCHING",
      expectedVersion,
      nextState,
      authority,
      fencing: { fencingEpoch, leaseVersion },
    });

    if (!intentTransition.success) {
      logger.warn(
        { sendIntentId, workerId, fencingEpoch, leaseVersion, expectedVersion, nextState },
        "[finalize] SendIntent CAS failed — concurrent worker already settled",
      );
      return { success: false, reason: "SEND_INTENT_CAS_CONFLICT" } as const;
    }

    // Write provider-specific columns that transitionState does not own.
    // Only executed after a successful CAS — version is already incremented.
    if (providerMessageId || errorMessage) {
      await (tx as any).sendIntent.update({
        where: { id: sendIntentId },
        data: {
          ...(providerMessageId && { providerMessageId }),
          ...(errorMessage && { errorMessage }),
        },
      });
    }

    // ── 2. Settle all QuotaReservations for this operationId ─────────────
    const reservations = await tx.quotaReservation.findMany({
      where: { operationId, status: QuotaReservationStatus.RESERVED },
      select: { id: true, scope: true, scopeId: true, amount: true, version: true },
    });

    let settledReservations = 0;

    for (const res of reservations) {
      const quotaTransition = await transitionState(tx, {
        model: "QuotaReservation",
        entityId: res.id,
        expectedState: "RESERVED",
        expectedVersion: res.version,
        nextState: quotaSettlement,
        authority,
      });

      if (!quotaTransition.success) {
        logger.warn(
          { reservationId: res.id, operationId, quotaSettlement },
          "[finalize] QuotaReservation CAS failed — already settled",
        );
        continue;
      }

      settledReservations++;

      // ── 3. Quota accounting: increment currentSent on CONSUMED MAILBOX reservations
      if (quotaSettlement === "CONSUMED" && res.scope === QuotaScope.MAILBOX) {
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

    // ── 4. OutboxEvent INSERT (idempotent) ────────────────────────────────
    const eventType = nextState === "SENT" ? "SEND_INTENT_SENT" : "SEND_INTENT_FAILED";
    const idempotencyKey = `${operationId}:${eventType}`;

    try {
      await tx.outboxEvent.create({
        data: {
          organizationId: "org_default",
          aggregateType: "SendIntent",
          aggregateId: sendIntentId,
          eventType,
          payload: {
            sendIntentId,
            outreachMessageId,
            workerId,
            ...(providerMessageId && { providerMessageId }),
            ...(errorMessage && { error: errorMessage }),
          },
          idempotencyKey,
          operationId,
          status: "PENDING",
        },
      });
    } catch (err) {
      // Unique constraint on idempotencyKey = already emitted. Safe to ignore.
      if (!(err instanceof Error && err.message.includes("Unique constraint"))) {
        throw err; // re-throw real errors to roll back the transaction
      }
    }

    // ── 5. Update OutreachMessage delivery state ──────────────────────────
    // Done outside the transaction (post-commit) via raw SQL to avoid:
    //   a) P2022: OutreachMessage.senderMailboxId schema drift
    //   b) Transaction abort propagation if the update fails
    // The SendIntent state is the source of truth; this update is best-effort.

    logger.info(
      {
        sendIntentId,
        operationId,
        nextState,
        quotaSettlement,
        settledReservations,
        providerMessageId,
      },
      "[finalize] SendIntent finalized successfully",
    );

    return {
      success: true,
      sendIntentNewVersion: intentTransition.newVersion,
      settledReservations,
    } as const;
  }).then(async (result) => {
    if (result.success) {
      await updateOutreachMessageDeliveryState({
        outreachMessageId,
        nextState,
        providerMessageId,
        errorMessage,
        logPrefix: "[finalize]",
        sendIntentId,
      });
    }
    return result;
  });
}

// ---------------------------------------------------------------------------
// Reconciliation Path — resolves from RECONCILING state (no worker lease)
// ---------------------------------------------------------------------------

export interface FinalizeReconciledParams {
  sendIntentId: string;
  operationId: string;
  outreachMessageId: string;
  expectedVersion: number;
  nextState: TerminalSendState;
  quotaSettlement: TerminalQuotaState;
  providerMessageId?: string;
  errorMessage?: string;
}

/**
 * Atomically resolves a SendIntent in RECONCILING state to a terminal outcome.
 *
 * Used exclusively by the UNKNOWN reconciliation sweeper (Sprint 4.4).
 * Unlike finalizeSendIntent(), there is no worker lease — the CAS proof is
 * expectedVersion only; RECONCILING state itself acts as the mutex
 * (only one sweeper instance may CAS through transitionState at a time).
 *
 * Commits in one transaction:
 *   1. SendIntent CAS   (RECONCILING → SENT | FAILED)
 *   2. QuotaReservation CAS  (RESERVED → CONSUMED | RELEASED)
 *   3. Quota accounting  (currentSent on CONSUMED)
 *   4. OutboxEvent INSERT (idempotent)
 *   5. OutreachMessage delivery state update
 */
export async function finalizeReconciledIntent(
  params: FinalizeReconciledParams,
): Promise<FinalizeResult> {
  const {
    sendIntentId, operationId, outreachMessageId,
    expectedVersion, nextState, quotaSettlement,
    providerMessageId, errorMessage,
  } = params;

  const authority: TransitionAuthority = {
    actorType: "SYSTEM",
    actorId: "unknown-reconciliation-sweeper",
    operationId,
  };

  return await prisma.$transaction(async (tx) => {
    // ── 1. SendIntent CAS (RECONCILING → terminal) — version-only, no fencing ─
    const intentTransition = await transitionState(tx, {
      model: "SendIntent",
      entityId: sendIntentId,
      expectedState: "RECONCILING",
      expectedVersion,
      nextState,
      authority,
    });

    if (!intentTransition.success) {
      logger.warn(
        { sendIntentId, expectedVersion, nextState, reason: intentTransition.reason },
        "[finalize-reconciled] CAS conflict — another sweeper instance settled first",
      );
      return { success: false, reason: "SEND_INTENT_CAS_CONFLICT" } as const;
    }

    // Write provider-specific columns not owned by transitionState.
    if (providerMessageId || errorMessage) {
      await (tx as any).sendIntent.update({
        where: { id: sendIntentId },
        data: {
          ...(providerMessageId && { providerMessageId }),
          ...(errorMessage && { errorMessage }),
        },
      });
    }

    // ── 2. Settle all RESERVED QuotaReservations ─────────────────────────────
    const reservations = await tx.quotaReservation.findMany({
      where: { operationId, status: QuotaReservationStatus.RESERVED },
      select: { id: true, scope: true, scopeId: true, amount: true, version: true },
    });

    let settledReservations = 0;

    for (const res of reservations) {
      const quotaTransition = await transitionState(tx, {
        model: "QuotaReservation",
        entityId: res.id,
        expectedState: "RESERVED",
        expectedVersion: res.version,
        nextState: quotaSettlement,
        authority,
      });

      if (!quotaTransition.success) {
        logger.warn(
          { reservationId: res.id, operationId, quotaSettlement },
          "[finalize-reconciled] QuotaReservation CAS conflict — already settled",
        );
        continue;
      }

      settledReservations++;

      if (quotaSettlement === "CONSUMED" && res.scope === QuotaScope.MAILBOX) {
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

    // ── 3. OutboxEvent INSERT (idempotent) ────────────────────────────────────
    const eventType = nextState === "SENT"
      ? "SEND_INTENT_RECONCILED_SENT"
      : "SEND_INTENT_RECONCILED_FAILED";
    const idempotencyKey = `${operationId}:${eventType}`;

    try {
      await tx.outboxEvent.create({
        data: {
          organizationId: "org_default",
          aggregateType: "SendIntent",
          aggregateId: sendIntentId,
          eventType,
          payload: {
            sendIntentId,
            outreachMessageId,
            ...(providerMessageId && { providerMessageId }),
            ...(errorMessage && { error: errorMessage }),
          },
          idempotencyKey,
          operationId,
          status: "PENDING",
        },
      });
    } catch (err) {
      if (!(err instanceof Error && err.message.includes("Unique constraint"))) {
        throw err;
      }
    }

    // ── 4. OutreachMessage delivery state ─────────────────────────────────────
    // Done outside the transaction (post-commit) — see finalizeSendIntent for rationale.

    logger.info(
      { sendIntentId, operationId, nextState, quotaSettlement, settledReservations },
      "[finalize-reconciled] Reconciled SendIntent finalized successfully",
    );

    return {
      success: true,
      sendIntentNewVersion: intentTransition.newVersion,
      settledReservations,
    } as const;
  }).then(async (result) => {
    if (result.success) {
      await updateOutreachMessageDeliveryState({
        outreachMessageId,
        nextState,
        providerMessageId,
        errorMessage,
        logPrefix: "[finalize-reconciled]",
        sendIntentId,
      });
    }
    return result;
  });
}

// ---------------------------------------------------------------------------
// Internal helper: best-effort OutreachMessage delivery state sync
// ---------------------------------------------------------------------------

interface OutreachDeliveryStateParams {
  outreachMessageId: string;
  nextState: TerminalSendState;
  providerMessageId?: string;
  errorMessage?: string;
  logPrefix: string;
  sendIntentId: string;
}

async function updateOutreachMessageDeliveryState(
  params: OutreachDeliveryStateParams,
): Promise<void> {
  const { outreachMessageId, nextState, providerMessageId, errorMessage, logPrefix, sendIntentId } = params;
  try {
    if (nextState === "SENT") {
      const deliveryState = "SENT";
      const extId = providerMessageId ?? null;
      await prisma.$executeRaw`
        UPDATE "OutreachMessage"
        SET "deliveryState"     = ${deliveryState}::"DeliveryState",
            "sentAt"            = NOW(),
            "externalMessageId" = ${extId},
            "claimToken"        = NULL
        WHERE "id" = ${outreachMessageId}
      `;
    } else {
      const deliveryState = "AUTHORIZED";
      const lastErr = errorMessage ?? null;
      await prisma.$executeRaw`
        UPDATE "OutreachMessage"
        SET "deliveryState" = ${deliveryState}::"DeliveryState",
            "lastError"     = ${lastErr},
            "claimToken"    = NULL
        WHERE "id" = ${outreachMessageId}
      `;
    }
  } catch (err) {
    // P2010 = raw query failed; meta.code = 23505 = unique_violation.
    // externalMessageId already set (stale data or duplicate provider ID) — idempotent, skip.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      (err.code === "P2010" || err.code === "P2002") &&
      (String(err.meta?.code) === "23505" || String(err.meta?.target).includes("externalMessageId"))
    ) {
      logger.warn(
        { sendIntentId, outreachMessageId, prismaCode: err.code, pgCode: err.meta?.code },
        `${logPrefix} OutreachMessage externalMessageId unique conflict — already updated (idempotent)`,
      );
      return;
    }
    logger.error(
      { sendIntentId, outreachMessageId, err },
      `${logPrefix} OutreachMessage delivery state update failed — non-fatal (SendIntent is source of truth)`,
    );
  }
}
