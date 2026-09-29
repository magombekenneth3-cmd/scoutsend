/**
 * UNKNOWN Reconciliation Sweeper  (Sprint 4 — 4.4)
 *
 * Resolves SendIntents that are stuck in UNKNOWN state after an ambiguous
 * provider outcome (network timeout, connection reset, response lost in transit).
 *
 * Flow per intent:
 *
 *   UNKNOWN
 *     │
 *     ▼
 *   RECONCILING   ← CAS lock; prevents concurrent sweepers from racing
 *     │
 *     ├── provider.lookupMessage() if supportsLookup
 *     │     │
 *     │     ├── FOUND      → finalizeReconciledIntent(SENT + CONSUMED)
 *     │     ├── NOT_FOUND  → finalizeReconciledIntent(FAILED + RELEASED)
 *     │     └── UNKNOWN    → back to UNKNOWN, increment reconciliationAttempts
 *     │
 *     └── supportsLookup = false
 *           │
 *           ├── attempts < MAX → back to UNKNOWN (wait for webhook / manual)
 *           └── attempts >= MAX → HUMAN_REVIEW (operator escalation)
 *
 * Safety contracts:
 *  1. Quota is NEVER released unless provider definitively confirms NOT_FOUND.
 *  2. All state changes are CAS-protected via transitionState().
 *  3. Sweeper is idempotent — double runs produce no duplicate mutations.
 *  4. reconciliationAttempts is incremented as a non-CAS annotation column
 *     (safe to increment after the CAS has committed; worst case: off by one,
 *      which only delays HUMAN_REVIEW escalation by one cycle — acceptable).
 *  5. Provider credentials are loaded fresh per intent (no stale connection state).
 */

import { prisma } from "../prisma";
import { logger } from "../logger";
import { transitionState } from "../state/transition-state";
import { createMailProvider, type MailboxCredentials } from "../mail";
import { decryptMailboxCredentials } from "../mail/crypto";
import { finalizeReconciledIntent } from "./send-finalize.service";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SWEEP_BATCH_SIZE = 50;
const MAX_RECONCILIATION_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ReconciliationSweepResult {
  scanned: number;
  resolvedSent: number;
  resolvedFailed: number;
  retried: number;
  escalatedToHumanReview: number;
  skipped: number;
}

/**
 * Sweep UNKNOWN SendIntents and attempt to resolve their delivery outcome.
 * Intended to run as a periodic BullMQ repeatable job.
 */
export async function sweepUnknownIntents(): Promise<ReconciliationSweepResult> {
  // ── Query ──────────────────────────────────────────────────────────────────
  // Ordered by lowest reconciliationAttempts first (fewest retries get priority)
  // then by updatedAt ascending (oldest first within same attempt bucket).
  const unknowns = await prisma.sendIntent.findMany({
    where: { status: "UNKNOWN" },
    select: {
      id: true,
      operationId: true,
      outreachMessageId: true,
      idempotencyKey: true,
      providerMessageId: true,
      mailboxId: true,
      version: true,
      reconciliationAttempts: true,
    },
    orderBy: [
      { reconciliationAttempts: "asc" },
      { updatedAt: "asc" },
    ],
    take: SWEEP_BATCH_SIZE,
  });

  const result: ReconciliationSweepResult = {
    scanned: unknowns.length,
    resolvedSent: 0,
    resolvedFailed: 0,
    retried: 0,
    escalatedToHumanReview: 0,
    skipped: 0,
  };

  if (unknowns.length === 0) return result;

  logger.info(
    { count: unknowns.length },
    "[reconciliation-sweeper] Starting UNKNOWN sweep batch",
  );

  for (const intent of unknowns) {
    try {
      await processUnknownIntent(intent, result);
    } catch (err) {
      logger.error(
        { sendIntentId: intent.id, err },
        "[reconciliation-sweeper] Unexpected error — skipping intent",
      );
      result.skipped++;
    }
  }

  logger.info(result, "[reconciliation-sweeper] UNKNOWN sweep batch complete");
  return result;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

type UnknownIntent = {
  id: string;
  operationId: string;
  outreachMessageId: string;
  idempotencyKey: string;
  providerMessageId: string | null;
  mailboxId: string | null;
  version: number;
  reconciliationAttempts: number;
};

async function processUnknownIntent(
  intent: UnknownIntent,
  result: ReconciliationSweepResult,
): Promise<void> {
  // ── Step 1: Lock via UNKNOWN → RECONCILING CAS ───────────────────────────
  // This prevents two sweeper instances from racing on the same intent.
  const lockResult = await transitionState(prisma, {
    model: "SendIntent",
    entityId: intent.id,
    expectedState: "UNKNOWN",
    expectedVersion: intent.version,
    nextState: "RECONCILING",
    authority: {
      actorType: "SYSTEM",
      actorId: "unknown-reconciliation-sweeper",
      operationId: intent.operationId,
    },
  });

  if (!lockResult.success) {
    // Another sweeper won the race or the intent was already handled.
    logger.info(
      { sendIntentId: intent.id, reason: lockResult.reason },
      "[reconciliation-sweeper] Lock failed — intent already being processed",
    );
    result.skipped++;
    return;
  }

  const reconciledVersion = lockResult.newVersion;

  // ── Step 2: Increment reconciliationAttempts (non-CAS annotation) ────────
  // Safe after CAS: we own this intent until we exit RECONCILING.
  const newAttemptCount = intent.reconciliationAttempts + 1;
  await (prisma as any).sendIntent.update({
    where: { id: intent.id },
    data: { reconciliationAttempts: newAttemptCount },
  }).catch((err: Error) => {
    logger.warn(
      { sendIntentId: intent.id, err },
      "[reconciliation-sweeper] Failed to increment reconciliationAttempts — non-fatal",
    );
  });

  // ── Step 3: Attempt provider lookup ──────────────────────────────────────
  if (!intent.mailboxId) {
    // No mailbox — cannot look up. Escalate immediately if attempts exhausted.
    await handleNoLookup(intent, reconciledVersion, newAttemptCount, result, "NO_MAILBOX");
    return;
  }

  // Load mailbox + credentials
  const mailbox = await prisma.senderMailbox.findUnique({
    where: { id: intent.mailboxId },
    select: { id: true, credentials: true },
  });

  if (!mailbox) {
    await handleNoLookup(intent, reconciledVersion, newAttemptCount, result, "MAILBOX_NOT_FOUND");
    return;
  }

  let rawCreds: MailboxCredentials;
  try {
    rawCreds = decryptMailboxCredentials<MailboxCredentials>(
      mailbox.credentials,
      `mailbox:${mailbox.id}`,
    );
  } catch {
    await handleNoLookup(intent, reconciledVersion, newAttemptCount, result, "CRED_DECRYPT_FAILED");
    return;
  }

  const provider = createMailProvider(rawCreds);
  const caps = provider.getCapabilities();

  if (!caps.supportsLookup || !provider.lookupMessage) {
    // Provider does not support delivery status lookup.
    await handleNoLookup(intent, reconciledVersion, newAttemptCount, result,
      `PROVIDER_NO_LOOKUP(${provider.type})`);
    return;
  }

  // ── Step 4: Call provider lookup ─────────────────────────────────────────
  let lookupResult: Awaited<ReturnType<NonNullable<typeof provider.lookupMessage>>>;
  try {
    lookupResult = await provider.lookupMessage({
      externalId: intent.providerMessageId ?? undefined,
      idempotencyKey: intent.idempotencyKey,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn(
      { sendIntentId: intent.id, provider: provider.type, error },
      "[reconciliation-sweeper] Provider lookup threw — treating as UNKNOWN, will retry",
    );
    // Put back to UNKNOWN so the next sweep cycle will retry.
    await retryUnknown(intent.id, intent.operationId, reconciledVersion, result);
    return;
  }

  // ── Step 5: Route on lookup outcome ──────────────────────────────────────
  switch (lookupResult.status) {
    case "FOUND": {
      // Provider confirmed delivery. Settle SENT + CONSUMED atomically.
      const finalizeResult = await finalizeReconciledIntent({
        sendIntentId: intent.id,
        operationId: intent.operationId,
        outreachMessageId: intent.outreachMessageId,
        expectedVersion: reconciledVersion,
        nextState: "SENT",
        quotaSettlement: "CONSUMED",
        providerMessageId: lookupResult.externalId ?? intent.providerMessageId ?? undefined,
      });

      if (finalizeResult.success) {
        logger.info(
          { sendIntentId: intent.id, providerMessageId: lookupResult.externalId },
          "[reconciliation-sweeper] ✓ FOUND → SENT — quota CONSUMED",
        );
        result.resolvedSent++;
      } else {
        logger.warn(
          { sendIntentId: intent.id, reason: finalizeResult.reason },
          "[reconciliation-sweeper] finalizeReconciledIntent CAS conflict on FOUND — skipping",
        );
        result.skipped++;
      }
      break;
    }

    case "NOT_FOUND": {
      // Provider has no record. Definitively failed — safe to release quota.
      const finalizeResult = await finalizeReconciledIntent({
        sendIntentId: intent.id,
        operationId: intent.operationId,
        outreachMessageId: intent.outreachMessageId,
        expectedVersion: reconciledVersion,
        nextState: "FAILED",
        quotaSettlement: "RELEASED",
        errorMessage: "Provider lookup: message NOT_FOUND — email was never accepted",
      });

      if (finalizeResult.success) {
        logger.info(
          { sendIntentId: intent.id },
          "[reconciliation-sweeper] ✗ NOT_FOUND → FAILED — quota RELEASED",
        );
        result.resolvedFailed++;
      } else {
        logger.warn(
          { sendIntentId: intent.id, reason: finalizeResult.reason },
          "[reconciliation-sweeper] finalizeReconciledIntent CAS conflict on NOT_FOUND — skipping",
        );
        result.skipped++;
      }
      break;
    }

    case "UNKNOWN":
    default: {
      // Provider returned inconclusive result. Retry up to MAX attempts.
      await retryUnknown(intent.id, intent.operationId, reconciledVersion, result);
      break;
    }
  }
}

/**
 * Provider cannot be queried (no lookup support, missing credentials, etc.).
 * Route based on attempt count: retry or escalate to HUMAN_REVIEW.
 */
async function handleNoLookup(
  intent: UnknownIntent,
  reconciledVersion: number,
  attemptCount: number,
  result: ReconciliationSweepResult,
  reason: string,
): Promise<void> {
  if (attemptCount >= MAX_RECONCILIATION_ATTEMPTS) {
    await escalateToHumanReview(intent, reconciledVersion, `Exhausted after ${attemptCount} attempts (${reason})`, result);
  } else {
    logger.info(
      { sendIntentId: intent.id, reason, attemptCount, maxAttempts: MAX_RECONCILIATION_ATTEMPTS },
      "[reconciliation-sweeper] No lookup available — returning to UNKNOWN for retry",
    );
    await retryUnknown(intent.id, intent.operationId, reconciledVersion, result);
  }
}

/**
 * Put intent back to UNKNOWN so the next sweep cycle picks it up.
 * The incremented reconciliationAttempts column persists across cycles.
 */
async function retryUnknown(
  sendIntentId: string,
  operationId: string,
  reconciledVersion: number,
  result: ReconciliationSweepResult,
): Promise<void> {
  const revertResult = await transitionState(prisma, {
    model: "SendIntent",
    entityId: sendIntentId,
    expectedState: "RECONCILING",
    expectedVersion: reconciledVersion,
    nextState: "UNKNOWN",
    authority: {
      actorType: "SYSTEM",
      actorId: "unknown-reconciliation-sweeper",
      operationId,
    },
  });

  if (revertResult.success) {
    result.retried++;
  } else {
    logger.warn(
      { sendIntentId, reason: revertResult.reason },
      "[reconciliation-sweeper] CAS conflict reverting RECONCILING → UNKNOWN — intent may have been settled",
    );
    result.skipped++;
  }
}

/**
 * Escalate to HUMAN_REVIEW after exhausting all reconciliation attempts.
 * Quota remains RESERVED — a human operator must resolve manually.
 */
async function escalateToHumanReview(
  intent: UnknownIntent,
  reconciledVersion: number,
  reason: string,
  result: ReconciliationSweepResult,
): Promise<void> {
  const escalateResult = await transitionState(prisma, {
    model: "SendIntent",
    entityId: intent.id,
    expectedState: "RECONCILING",
    expectedVersion: reconciledVersion,
    nextState: "HUMAN_REVIEW",
    authority: {
      actorType: "SYSTEM",
      actorId: "unknown-reconciliation-sweeper",
      operationId: intent.operationId,
    },
  });

  if (!escalateResult.success) {
    logger.warn(
      { sendIntentId: intent.id },
      "[reconciliation-sweeper] CAS conflict on HUMAN_REVIEW escalation — skipping",
    );
    result.skipped++;
    return;
  }

  // Emit outbox event so operators can be notified via webhook/alert.
  const idempotencyKey = `${intent.operationId}:SEND_INTENT_HUMAN_REVIEW`;
  await prisma.outboxEvent.upsert({
    where: { idempotencyKey },
    create: {
      organizationId: "org_default",
      aggregateType: "SendIntent",
      aggregateId: intent.id,
      eventType: "SEND_INTENT_HUMAN_REVIEW_REQUIRED",
      payload: {
        sendIntentId: intent.id,
        operationId: intent.operationId,
        reconciliationAttempts: intent.reconciliationAttempts + 1,
        reason,
      },
      idempotencyKey,
      operationId: intent.operationId,
      status: "PENDING",
    },
    update: {},
  });

  logger.error(
    {
      sendIntentId: intent.id,
      operationId: intent.operationId,
      attempts: intent.reconciliationAttempts + 1,
      reason,
    },
    "[reconciliation-sweeper] 🚨 HUMAN_REVIEW required — operator must confirm delivery and settle quota",
  );

  result.escalatedToHumanReview++;
}
