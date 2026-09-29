/**
 * Send Dispatch Worker — Sprint 3 (corrected)
 *
 * THE REAL DISPATCH BOUNDARY.
 *
 * This module is the only code that may call `provider.sendEmail()`.
 * It is invoked AFTER `authorizeAndCreateSendIntent()` has produced a
 * PENDING SendIntent and a pair of RESERVED QuotaReservations.
 *
 * Execution Contract:
 *  1. Re-claim (or assert) SendIntent lease via `claimSendIntentLease()`.
 *     If lease is held by another worker → SKIPPED.
 *  2. Assert lease ownership AGAIN immediately before provider call (double fence).
 *  3. Read provider capabilities — determines UNKNOWN reconciliation strategy.
 *  4. Send via `MailProvider.sendEmail()` with `idempotencyKey`.
 *  5. Terminal paths — ALL committed atomically via `finalizeSendIntent()`:
 *       SUCCESS  → DISPATCHING → SENT  + quota CONSUMED
 *       FAILURE  → DISPATCHING → FAILED + quota RELEASED
 *  6. UNKNOWN path (provider throws):
 *       → DISPATCHING → UNKNOWN
 *       → quota reservation remains RESERVED (NOT released)
 *       → Sprint 4 reconciliation resolves: SENT+CONSUMED or FAILED+RELEASED
 *
 * Hard Rules:
 *  - No LLM call here. No content modification here.
 *  - `finalizeSendIntent()` is the only legal write for SENT/FAILED terminals.
 *  - UNKNOWN quota is NEVER released here. Only the reconciliation sweeper
 *    may settle UNKNOWN quota after confirming delivery status with the provider.
 *  - Provider capabilities are declared explicitly — do not assume idempotency.
 */

import { prisma } from "../prisma";
import { logger } from "../logger";
import {
  claimSendIntentLease,
  assertSendIntentOwnership,
  transitionSendIntent,
  type SendIntentLease,
} from "./send-intent.service";
import { finalizeSendIntent } from "./send-finalize.service";
import { createMailProvider, MailboxCredentials, SendResult } from "../mail";
import type { ProviderCapabilities } from "../mail/types";
import { decryptMailboxCredentials } from "../mail/crypto";
import { DomainHealth } from "@prisma/client";

// ---------------------------------------------------------------------------
// Public Types
// ---------------------------------------------------------------------------

export type DispatchOutcome =
  | { outcome: "SENT"; providerMessageId: string; sendIntentId: string }
  | { outcome: "FAILED"; error: string; sendIntentId: string }
  | {
    outcome: "UNKNOWN";
    error: string;
    sendIntentId: string;
    /** Declared by the provider — tells Sprint 4 sweeper what it can do. */
    reconciliationStrategy: ProviderCapabilities["reconciliationStrategy"];
  }
  | { outcome: "SKIPPED"; reason: string; sendIntentId: string };

export interface DispatchParams {
  sendIntentId: string;
  workerId: string;
  /** Optional: pre-acquired lease from an earlier `claimSendIntentLease()` call. */
  lease?: SendIntentLease;
}

// ---------------------------------------------------------------------------
// Failure Classification
// ---------------------------------------------------------------------------

type FailureCategory = "permanent" | "reputation_block" | "retryable";

function classifyFailure(errorMsg: string): FailureCategory {
  const n = errorMsg.toLowerCase();
  if (
    n.includes("5.7.1") || n.includes("spamhaus") || n.includes("ip blocked") ||
    n.includes("blacklisted") || n.includes("client host blocked") ||
    n.includes("rate limit") || n.includes("too many requests") ||
    n.includes("reputation")
  ) {
    return "reputation_block";
  }
  if (
    n.includes("5.1.1") || n.includes("550 5.1.") || n.includes("mailbox not found") ||
    n.includes("user unknown") || n.includes("recipient rejected") ||
    n.includes("address rejected") || n.includes("invalid recipient") ||
    n.includes("does not exist") || n.includes("recipient address rejected") ||
    n.includes("no such user") || n.includes("bad recipient")
  ) {
    return "permanent";
  }
  return "retryable";
}

function isTransientMailboxError(errorMsg?: string | null): boolean {
  if (!errorMsg) return false;
  const n = errorMsg.toLowerCase();
  return (
    n.includes("429") || n.includes("451") || n.includes("535") ||
    n.includes("554") || n.includes("5.7.") || n.includes("4.7.") ||
    n.includes("invalid_grant") || n.includes("unauthorized") ||
    n.includes("authentication failed") || n.includes("rate limit") ||
    n.includes("quota exceeded") || n.includes("econnreset") ||
    n.includes("etimedout") || n.includes("eauth") ||
    n.includes("token expired") || n.includes("provider unavailable")
  );
}

// ---------------------------------------------------------------------------
// Core Dispatch Execution
// ---------------------------------------------------------------------------

/**
 * Execute provider dispatch for a single SendIntent.
 *
 * Handles lease claim, provider call, and atomic terminal settlement.
 * Call from a BullMQ worker, a reconciliation sweeper, or a test harness.
 */
export async function dispatchSendIntent(
  params: DispatchParams,
): Promise<DispatchOutcome> {
  const { sendIntentId, workerId } = params;

  // ── 1. Claim or re-verify lease ─────────────────────────────────────────
  let lease: SendIntentLease;

  if (params.lease) {
    try {
      await assertSendIntentOwnership({
        sendIntentId,
        workerId,
        fencingEpoch: params.lease.fencingEpoch,
        leaseVersion: params.lease.leaseVersion,
      });
      lease = params.lease;
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Lease ownership check failed";
      logger.warn({ sendIntentId, workerId, reason }, "[dispatch] Lease assertion failed — skipping");
      return { outcome: "SKIPPED", reason, sendIntentId };
    }
  } else {
    const claimResult = await claimSendIntentLease({ sendIntentId, workerId });
    if (!claimResult.granted) {
      logger.info(
        { sendIntentId, workerId, reason: claimResult.reason },
        "[dispatch] Could not claim SendIntent lease — skipping",
      );
      return { outcome: "SKIPPED", reason: claimResult.reason, sendIntentId };
    }
    lease = claimResult.lease;
  }

  logger.info(
    { sendIntentId, workerId, fencingEpoch: lease.fencingEpoch, leaseVersion: lease.leaseVersion },
    "[dispatch] Lease held — loading dispatch context",
  );

  // ── 2. Load SendIntent + linked context ─────────────────────────────────
  const intent = await prisma.sendIntent.findUnique({
    where: { id: sendIntentId },
    select: {
      id: true,
      operationId: true,
      leadId: true,
      outreachMessageId: true,
      mailboxId: true,
      idempotencyKey: true,
      status: true,
    },
  });

  if (!intent) {
    logger.error({ sendIntentId }, "[dispatch] SendIntent not found after lease claim — data integrity issue");
    return { outcome: "SKIPPED", reason: "INTENT_NOT_FOUND", sendIntentId };
  }

  if (intent.status !== "DISPATCHING") {
    logger.warn(
      { sendIntentId, status: intent.status },
      "[dispatch] SendIntent not in DISPATCHING state — concurrent worker may have taken over",
    );
    return { outcome: "SKIPPED", reason: `NOT_DISPATCHING:${intent.status}`, sendIntentId };
  }

  if (!intent.mailboxId) {
    return await handleTerminalFailure({
      intent, lease, workerId,
      error: "No mailboxId on SendIntent — cannot dispatch",
    });
  }

  // Load mailbox credentials
  const mailbox = await prisma.senderMailbox.findUnique({
    where: { id: intent.mailboxId },
    select: {
      id: true,
      emailAddress: true,
      credentials: true,
      health: true,
      providerType: true,
    },
  });

  if (!mailbox) {
    return await handleTerminalFailure({
      intent, lease, workerId,
      error: `Mailbox ${intent.mailboxId} not found`,
    });
  }

  if (mailbox.health === DomainHealth.BLOCKED || mailbox.health === DomainHealth.DEGRADED) {
    return await handleTerminalFailure({
      intent, lease, workerId,
      error: `Mailbox health is ${mailbox.health} — dispatch blocked`,
    });
  }

  // Load OutreachMessage for payload
  const message = await prisma.outreachMessage.findUnique({
    where: { id: intent.outreachMessageId },
    select: {
      id: true,
      subject: true,
      body: true,
      externalMessageId: true,
      parentMessage: { select: { externalMessageId: true } },
      lead: {
        select: {
          email: true,
          firstName: true,
          companyName: true,
          website: true,
        },
      },
    },
  });

  if (!message || !message.lead.email) {
    return await handleTerminalFailure({
      intent, lease, workerId,
      error: "OutreachMessage or lead email not found",
    });
  }

  // ── 3. Assert ownership AGAIN immediately before provider call ───────────
  //    A stale worker that survived a network partition and had its fencingEpoch
  //    superseded by a takeover will be rejected here before reaching the wire.
  try {
    await assertSendIntentOwnership({
      sendIntentId,
      workerId,
      fencingEpoch: lease.fencingEpoch,
      leaseVersion: lease.leaseVersion,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Pre-send ownership assertion failed";
    logger.warn({ sendIntentId, workerId, reason }, "[dispatch] Fenced out before provider call");
    return { outcome: "SKIPPED", reason, sendIntentId };
  }

  // ── 4. Initialize provider and read capabilities ──────────────────────────
  let rawCreds: MailboxCredentials;
  try {
    rawCreds = decryptMailboxCredentials<MailboxCredentials>(
      mailbox.credentials,
      `mailbox:${mailbox.id}`,
    );
  } catch (err) {
    const error = err instanceof Error ? err.message : "Credential decryption failed";
    return await handleTerminalFailure({ intent, lease, workerId, error });
  }

  const provider = createMailProvider(rawCreds);
  const capabilities = provider.getCapabilities();

  logger.info(
    {
      sendIntentId,
      providerType: provider.type,
      supportsIdempotency: capabilities.supportsIdempotency,
      supportsLookup: capabilities.supportsLookup,
      reconciliationStrategy: capabilities.reconciliationStrategy,
    },
    "[dispatch] Provider capabilities declared",
  );

  // ── 5. Execute provider send ─────────────────────────────────────────────
  //    idempotencyKey is always passed. Providers that honour it will use it;
  //    providers that don't declare supportsIdempotency: false — UNKNOWN
  //    outcomes route to reconciliation rather than blind retry.
  let result: SendResult;
  try {
    result = await provider.sendEmail({
      from: mailbox.emailAddress,
      to: message.lead.email,
      subject: message.subject,
      html: message.body,
      text: message.body.replace(/<[^>]+>/g, ""),
      idempotencyKey: intent.idempotencyKey ?? undefined,
      ...(message.parentMessage?.externalMessageId && {
        inReplyTo: message.parentMessage.externalMessageId,
        references: message.parentMessage.externalMessageId,
      }),
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : "Provider threw unexpected error";
    logger.error(
      { sendIntentId, workerId, providerType: provider.type, error },
      "[dispatch] Provider threw — delivery status UNKNOWN. Quota remains RESERVED for reconciliation.",
    );
    return await handleUnknownOutcome({ intent, lease, workerId, error, capabilities });
  }

  // ── 6. Process result ────────────────────────────────────────────────────
  if (result.success) {
    return await handleSuccess({
      intent, lease, workerId,
      providerMessageId: result.externalId,
    });
  }

  const errorMsg = result.error;
  const failureType = classifyFailure(errorMsg);
  const isTransient = isTransientMailboxError(errorMsg);

  if (isTransient || failureType === "retryable") {
    logger.warn(
      { sendIntentId, workerId, errorMsg, failureType },
      "[dispatch] Retryable failure — transitioning to FAILED for BullMQ retry scheduling",
    );
  }

  return await handleTerminalFailure({ intent, lease, workerId, error: errorMsg });
}

// ---------------------------------------------------------------------------
// Terminal State Handlers — all use finalizeSendIntent() for atomicity
// ---------------------------------------------------------------------------

async function handleSuccess(params: {
  intent: { id: string; operationId: string; outreachMessageId: string };
  lease: SendIntentLease;
  workerId: string;
  providerMessageId: string;
}): Promise<DispatchOutcome> {
  const { intent, lease, workerId, providerMessageId } = params;

  const result = await finalizeSendIntent({
    sendIntentId: intent.id,
    operationId: intent.operationId,
    outreachMessageId: intent.outreachMessageId,
    workerId,
    expectedVersion: lease.version,
    fencingEpoch: lease.fencingEpoch,
    leaseVersion: lease.leaseVersion,
    nextState: "SENT",
    quotaSettlement: "CONSUMED",
    providerMessageId,
  });

  if (!result.success) {
    logger.warn(
      { sendIntentId: intent.id, workerId, reason: result.reason },
      "[dispatch] finalizeSendIntent CAS conflict on SENT — another worker settled first",
    );
    return { outcome: "SKIPPED", reason: result.reason, sendIntentId: intent.id };
  }

  logger.info(
    { sendIntentId: intent.id, workerId, providerMessageId, settledReservations: result.settledReservations },
    "[dispatch] ✓ SENT — SendIntent + quota + outbox committed atomically",
  );

  return { outcome: "SENT", providerMessageId, sendIntentId: intent.id };
}

async function handleTerminalFailure(params: {
  intent: { id: string; operationId: string; outreachMessageId: string };
  lease: SendIntentLease;
  workerId: string;
  error: string;
}): Promise<DispatchOutcome> {
  const { intent, lease, workerId, error } = params;

  const result = await finalizeSendIntent({
    sendIntentId: intent.id,
    operationId: intent.operationId,
    outreachMessageId: intent.outreachMessageId,
    workerId,
    expectedVersion: lease.version,
    fencingEpoch: lease.fencingEpoch,
    leaseVersion: lease.leaseVersion,
    nextState: "FAILED",
    quotaSettlement: "RELEASED",
    errorMessage: error,
  });

  if (!result.success) {
    logger.warn(
      { sendIntentId: intent.id, workerId, reason: result.reason },
      "[dispatch] finalizeSendIntent CAS conflict on FAILED — another worker settled first",
    );
    return { outcome: "SKIPPED", reason: result.reason, sendIntentId: intent.id };
  }

  logger.warn(
    { sendIntentId: intent.id, workerId, error, settledReservations: result.settledReservations },
    "[dispatch] ✗ FAILED — SendIntent + quota + outbox committed atomically",
  );

  return { outcome: "FAILED", error, sendIntentId: intent.id };
}

/**
 * UNKNOWN outcome — provider threw or returned an ambiguous result.
 *
 * Critically: quota is NOT settled here.
 * The RESERVED quota remains locked until the Sprint 4 reconciliation sweeper
 * confirms delivery status with the provider. Releasing it risks duplicate sends
 * if the original request was accepted but the response was lost.
 *
 * reconciliationStrategy tells the sweeper what it can do:
 *   LOOKUP        → auto-reconcile via provider API
 *   MANUAL_REVIEW → escalate after maxAttempts exhausted
 */
async function handleUnknownOutcome(params: {
  intent: { id: string; operationId: string; outreachMessageId: string };
  lease: SendIntentLease;
  workerId: string;
  error: string;
  capabilities: ProviderCapabilities;
}): Promise<DispatchOutcome> {
  const { intent, lease, workerId, error, capabilities } = params;

  // Transition to UNKNOWN using fenced CAS. Quota stays RESERVED.
  const transitionRes = await transitionSendIntent({
    sendIntentId: intent.id,
    expectedState: "DISPATCHING",
    nextState: "UNKNOWN",
    expectedVersion: lease.version,
    workerId,
    fencingEpoch: lease.fencingEpoch,
    leaseVersion: lease.leaseVersion,
    errorMessage: error,
    operationId: intent.operationId,
  });

  if (!transitionRes.success) {
    logger.warn(
      { sendIntentId: intent.id, workerId },
      "[dispatch] UNKNOWN transition CAS conflict — another worker has already settled",
    );
    return { outcome: "SKIPPED", reason: "CAS_CONFLICT_ON_UNKNOWN", sendIntentId: intent.id };
  }

  // Emit outbox event so Sprint 4 sweeper picks this up for reconciliation.
  // The event payload carries reconciliationStrategy so the sweeper knows
  // what to do without re-loading the provider.
  await emitUnknownEvent({
    sendIntentId: intent.id,
    operationId: intent.operationId,
    outreachMessageId: intent.outreachMessageId,
    error,
    workerId,
    reconciliationStrategy: capabilities.reconciliationStrategy,
  });

  logger.error(
    {
      sendIntentId: intent.id,
      workerId,
      error,
      reconciliationStrategy: capabilities.reconciliationStrategy,
      supportsLookup: capabilities.supportsLookup,
    },
    "[dispatch] ⚠ UNKNOWN — quota RESERVED, reconciliation required",
  );

  return {
    outcome: "UNKNOWN",
    error,
    sendIntentId: intent.id,
    reconciliationStrategy: capabilities.reconciliationStrategy,
  };
}

// ---------------------------------------------------------------------------
// Outbox Event Helpers
// ---------------------------------------------------------------------------

async function emitUnknownEvent(params: {
  sendIntentId: string;
  operationId: string;
  outreachMessageId: string;
  error: string;
  workerId: string;
  reconciliationStrategy: ProviderCapabilities["reconciliationStrategy"];
}): Promise<void> {
  try {
    await prisma.outboxEvent.create({
      data: {
        organizationId: "org_default",
        aggregateType: "SendIntent",
        aggregateId: params.sendIntentId,
        eventType: "SEND_INTENT_UNKNOWN",
        payload: {
          sendIntentId: params.sendIntentId,
          outreachMessageId: params.outreachMessageId,
          error: params.error,
          workerId: params.workerId,
          // Sprint 4 sweeper reads this to route reconciliation
          reconciliationStrategy: params.reconciliationStrategy,
        },
        idempotencyKey: `${params.operationId}:SEND_INTENT_UNKNOWN`,
        operationId: params.operationId,
        status: "PENDING",
      },
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Unique constraint")) {
      return; // idempotent — already emitted
    }
    logger.error(
      { sendIntentId: params.sendIntentId, err },
      "[dispatch] SEND_INTENT_UNKNOWN outbox emit failed",
    );
  }
}
