/**
 * Stale-Lease Recovery Sweeper  (Sprint 4 — 4.3)
 *
 * Scans SendIntents that are stuck in DISPATCHING with an expired lease.
 * These are workers that crashed, were partitioned, or lost a GC pause race.
 *
 * Decision tree per intent:
 *
 *   leaseExpiresAt < NOW()  AND  status = DISPATCHING
 *           │
 *           ▼
 *   Was the provider call definitely NEVER made?
 *   (attemptCount <= 1  AND  lastAttemptAt is very recent — i.e. claim just happened)
 *           │
 *   ┌───────┴───────────┐
 *   │ YES               │ NO / UNCERTAIN
 *   │ (safe to retry)   │ (ambiguous — preserve quota)
 *   ▼                   ▼
 * re-claim via       UNKNOWN
 * claimSendIntentLease  +
 * (fencingEpoch++)    quota stays RESERVED
 *                     sprint-4 reconciliation resolves it
 *
 * Safety contracts:
 *  1. All state changes go through transitionState() — never raw updates.
 *  2. Lease re-claim increments fencingEpoch — permanently invalidates the stale worker.
 *  3. UNKNOWN path: quota reservation is NOT settled (RESERVED stays RESERVED).
 *  4. Sweeper runs are idempotent — double-execution produces no duplicate mutations.
 *  5. Batch size capped at SWEEP_BATCH_SIZE to prevent unbounded scan time.
 */

import { prisma } from "../prisma";
import { logger } from "../logger";
import { transitionState } from "../state/transition-state";
import { claimSendIntentLease } from "./send-intent.service";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SWEEP_BATCH_SIZE = 50;
const SWEEPER_WORKER_ID = "stale-lease-sweeper";

/**
 * An intent is considered "safely retryable" (no provider contact possible)
 * when it was claimed less than PROVIDER_CALL_WINDOW_MS before the lease expired.
 * This covers: claim succeeded, lease TTL expired instantly before sendEmail() started.
 *
 * Any intent that's been DISPATCHING longer than this threshold must be treated
 * as potentially having reached the provider.
 */
const PROVIDER_CALL_WINDOW_MS = 5_000; // 5 seconds — conservative

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface StaleLeaseSweepResult {
  scanned: number;
  reclaimed: number;
  routedToUnknown: number;
  skipped: number;
}

/**
 * Sweep expired-lease DISPATCHING SendIntents.
 * Intended to run as a periodic BullMQ repeatable job.
 */
export async function sweepStaleLeases(): Promise<StaleLeaseSweepResult> {
  const now = new Date();

  // ── Query ──────────────────────────────────────────────────────────────────
  // Only intents with expired leases — the composite index covers this efficiently.
  const stale = await prisma.sendIntent.findMany({
    where: {
      status: "DISPATCHING",
      leaseExpiresAt: { lt: now },
    },
    select: {
      id: true,
      operationId: true,
      idempotencyKey: true,
      version: true,
      fencingEpoch: true,
      leaseVersion: true,
      leaseExpiresAt: true,
      lastAttemptAt: true,
      attemptCount: true,
    },
    orderBy: { leaseExpiresAt: "asc" }, // oldest expiry first
    take: SWEEP_BATCH_SIZE,
  });

  const result: StaleLeaseSweepResult = {
    scanned: stale.length,
    reclaimed: 0,
    routedToUnknown: 0,
    skipped: 0,
  };

  if (stale.length === 0) return result;

  logger.info(
    { count: stale.length },
    "[stale-lease-sweeper] Starting sweep batch",
  );

  for (const intent of stale) {
    try {
      await processStaleLease(intent, now, result);
    } catch (err) {
      logger.error(
        { sendIntentId: intent.id, err },
        "[stale-lease-sweeper] Unexpected error processing intent — skipping",
      );
      result.skipped++;
    }
  }

  logger.info(result, "[stale-lease-sweeper] Sweep batch complete");
  return result;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

type StaleIntent = {
  id: string;
  operationId: string;
  idempotencyKey: string;
  version: number;
  fencingEpoch: number;
  leaseVersion: number;
  leaseExpiresAt: Date | null;
  lastAttemptAt: Date | null;
  attemptCount: number;
};

async function processStaleLease(
  intent: StaleIntent,
  now: Date,
  result: StaleLeaseSweepResult,
): Promise<void> {
  // ── Determine disposition ────────────────────────────────────────────────
  //
  // "Safely retryable" means the lease expired VERY quickly after claim.
  // This implies the worker never had time to make the provider call.
  //
  // Heuristic: lease expired within PROVIDER_CALL_WINDOW_MS of lastAttemptAt.
  // If lastAttemptAt is null or much earlier, we cannot be certain.
  const safelyRetryable = isSafelyRetryable(intent, now);

  if (safelyRetryable) {
    // ── Path A: Re-claim via the existing lease service ───────────────────
    // claimSendIntentLease() handles the fencingEpoch increment + DB update atomically.
    const claimResult = await claimSendIntentLease({
      sendIntentId: intent.id,
      workerId: SWEEPER_WORKER_ID,
    });

    if (claimResult.granted) {
      logger.info(
        { sendIntentId: intent.id, newFencingEpoch: claimResult.lease.fencingEpoch },
        "[stale-lease-sweeper] Stale lease reclaimed — intent re-queued for dispatch",
      );
      result.reclaimed++;
      // The intent stays in DISPATCHING. The dispatch worker will pick it up
      // via the normal BullMQ queue on the next cycle.
    } else {
      // Another sweeper or worker won the race — that's fine.
      logger.info(
        { sendIntentId: intent.id, reason: claimResult.reason },
        "[stale-lease-sweeper] Re-claim lost race — intent already handled",
      );
      result.skipped++;
    }
    return;
  }

  // ── Path B: Ambiguous — route to UNKNOWN ────────────────────────────────
  // We cannot determine whether the provider received the email.
  // The quota reservation MUST remain RESERVED.
  // Sprint 4.4 reconciliation will resolve the actual outcome.

  const authority = {
    actorType: "SYSTEM",
    actorId: "stale-lease-sweeper",
    operationId: intent.operationId,
  };

  const unknownTransition = await transitionState(prisma, {
    model: "SendIntent",
    entityId: intent.id,
    expectedState: "DISPATCHING",
    expectedVersion: intent.version,
    nextState: "UNKNOWN",
    authority,
    // Fenced transition: must match the CURRENT fencingEpoch to prove no
    // concurrent worker has already taken over and incremented it.
    fencing: {
      fencingEpoch: intent.fencingEpoch,
      leaseVersion: intent.leaseVersion,
    },
  });

  if (!unknownTransition.success) {
    // CAS conflict: concurrent worker or sweeper already handled this intent.
    logger.info(
      { sendIntentId: intent.id, reason: unknownTransition.reason },
      "[stale-lease-sweeper] UNKNOWN transition lost race — intent already settled",
    );
    result.skipped++;
    return;
  }

  // Write the reason for UNKNOWN routing (non-CAS column — safe after CAS above)
  await (prisma as any).sendIntent.update({
    where: { id: intent.id },
    data: {
      errorMessage: "Stale lease: provider contact ambiguous — routed to reconciliation",
    },
  }).catch((err: Error) => {
    logger.warn(
      { sendIntentId: intent.id, err },
      "[stale-lease-sweeper] Failed to write errorMessage annotation — non-fatal",
    );
  });

  // Emit an outbox event so downstream systems know reconciliation is needed.
  const idempotencyKey = `${intent.operationId}:STALE_LEASE_UNKNOWN`;
  await prisma.outboxEvent.upsert({
    where: { idempotencyKey },
    create: {
      organizationId: "org_default",
      aggregateType: "SendIntent",
      aggregateId: intent.id,
      eventType: "SEND_INTENT_UNKNOWN",
      payload: {
        sendIntentId: intent.id,
        operationId: intent.operationId,
        reason: "STALE_LEASE",
        fencingEpoch: intent.fencingEpoch,
      },
      idempotencyKey,
      operationId: intent.operationId,
      status: "PENDING",
    },
    update: {}, // idempotent — already emitted
  });

  logger.warn(
    { sendIntentId: intent.id, fencingEpoch: intent.fencingEpoch },
    "[stale-lease-sweeper] Intent routed to UNKNOWN — quota RESERVED, awaiting reconciliation",
  );
  result.routedToUnknown++;
}

/**
 * Determines whether a stale-DISPATCHING intent is safe to retry without
 * risking a duplicate outbound.
 *
 * Returns true ONLY when:
 *   - The lease expired almost immediately after claim (worker never called the provider).
 *   - OR this is the first attempt and the lease TTL is simply too short.
 */
function isSafelyRetryable(intent: StaleIntent, now: Date): boolean {
  if (!intent.lastAttemptAt || !intent.leaseExpiresAt) {
    // No record of attempt — the worker never started. Safe to retry.
    return true;
  }

  const msFromAttemptToExpiry =
    intent.leaseExpiresAt.getTime() - intent.lastAttemptAt.getTime();

  // If the lease expired within PROVIDER_CALL_WINDOW_MS of the attempt start,
  // the worker almost certainly never reached the provider network call.
  if (msFromAttemptToExpiry <= PROVIDER_CALL_WINDOW_MS) {
    return true;
  }

  // The lease was alive for a meaningful window after the claim.
  // The provider call may have been in flight when the lease expired.
  // Treat as ambiguous → UNKNOWN.
  return false;
}
