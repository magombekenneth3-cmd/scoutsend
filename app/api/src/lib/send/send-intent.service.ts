/**
 * SendIntent Authority & Fencing Service
 *
 * Controls worker claiming, state transitions, lease renewals, and fencing
 * checks for SendIntent execution.
 *
 * Hard Rules (Sprint 2):
 *  1. No raw `prisma.sendIntent.update({ data: { status } })` calls bypassing transitionState().
 *  2. Worker claims use fenced CAS (`fencingEpoch` + `leaseVersion` + `leaseExpiresAt`).
 *  3. Stale worker execution is permanently rejected when `fencingEpoch` is incremented.
 *  4. All state transitions pass through `transitionState()` engine.
 */

import { prisma } from "../prisma";
import { logger } from "../logger";
import { transitionState } from "../state/transition-state";
import type { TransitionAuthority, FencingProof } from "../state/transition-state";
import type { SendIntentState } from "../state/state-transition-registry";
import { randomUUID, createHash } from "crypto";

const DEFAULT_INTENT_LEASE_TTL_MS = 60_000; // 60 seconds

export function buildDurableIdempotencyKey(orgId: string, sendIntentId: string): string {
  return createHash("sha256")
    .update(`SEND_INTENT_V1:${orgId}:${sendIntentId}`)
    .digest("hex");
}

export function buildSendIdempotencyKey(
  leadId: string,
  sequenceStep: number,
  messageVersion: string,
): string {
  return `send:${leadId}:step${sequenceStep}:v${messageVersion}`;
}

export interface SendIntentLease {
  sendIntentId: string;
  operationId: string;
  claimedBy: string;
  fencingEpoch: number;
  leaseVersion: number;
  leaseExpiresAt: Date;
  version: number;
}

export type ClaimSendIntentResult =
  | { granted: true; lease: SendIntentLease }
  | { granted: false; reason: "ALREADY_TERMINAL" | "LEASE_HELD" | "INTENT_NOT_FOUND" | "CAS_CONFLICT" };

/**
 * Claim execution lease for a PENDING or EXPIRED SendIntent.
 * Establishes or increments fencingEpoch and leaseVersion.
 */
export async function claimSendIntentLease(params: {
  sendIntentId: string;
  workerId: string;
  ttlMs?: number;
}): Promise<ClaimSendIntentResult> {
  const { sendIntentId, workerId, ttlMs = DEFAULT_INTENT_LEASE_TTL_MS } = params;
  const now = new Date();
  const leaseExpiresAt = new Date(now.getTime() + ttlMs);

  return await prisma.$transaction(async (tx) => {
    const intent = await tx.sendIntent.findUnique({
      where: { id: sendIntentId },
      select: {
        id: true,
        operationId: true,
        status: true,
        version: true,
        claimedBy: true,
        fencingEpoch: true,
        leaseVersion: true,
        leaseExpiresAt: true,
      },
    });

    if (!intent) {
      return { granted: false, reason: "INTENT_NOT_FOUND" } as const;
    }

    if (intent.status === "SENT" || intent.status === "FAILED") {
      return { granted: false, reason: "ALREADY_TERMINAL" } as const;
    }

    // Check existing lease
    if (intent.leaseExpiresAt && intent.leaseExpiresAt > now) {
      if (intent.claimedBy !== workerId) {
        logger.info(
          { sendIntentId, claimedBy: intent.claimedBy, workerId },
          "[send-intent] Claim rejected — valid lease held by another worker",
        );
        return { granted: false, reason: "LEASE_HELD" } as const;
      }

      // Re-claim by same worker
      return {
        granted: true,
        lease: {
          sendIntentId: intent.id,
          operationId: intent.operationId,
          claimedBy: workerId,
          fencingEpoch: intent.fencingEpoch,
          leaseVersion: intent.leaseVersion,
          leaseExpiresAt: intent.leaseExpiresAt,
          version: intent.version,
        },
      } as const;
    }

    // Takeover or Fresh Claim
    const isTakeover = intent.leaseExpiresAt && intent.leaseExpiresAt <= now && intent.claimedBy !== workerId;
    const nextFencingEpoch = isTakeover ? intent.fencingEpoch + 1 : intent.fencingEpoch;
    const nextLeaseVersion = 1;

    // Transition status to DISPATCHING via transitionState if PENDING.
    // transitionState increments `version` by 1; capture the new version.
    let dbVersionAfterTransition = intent.version;

    if (intent.status === "PENDING") {
      const authority: TransitionAuthority = {
        actorType: "WORKER",
        actorId: intent.operationId,
        workerId,
        operationId: intent.operationId,
      };

      const transitionRes = await transitionState(tx, {
        model: "SendIntent",
        entityId: intent.id,
        expectedState: "PENDING",
        expectedVersion: intent.version,
        nextState: "DISPATCHING",
        authority,
      });

      if (!transitionRes.success) {
        return { granted: false, reason: "CAS_CONFLICT" } as const;
      }

      dbVersionAfterTransition = transitionRes.newVersion;
    }

    // Lease ownership fields + increment version so CAS proofs stay in sync.
    // For takeover/fresh-claim we always bump version by 1 beyond whatever the
    // state-transition engine last wrote (or the current intent.version if status
    // was already DISPATCHING and no state transition ran).
    const nextVersion = dbVersionAfterTransition + 1;

    // Fix 3: Add version predicate to prevent two concurrent sweepers both succeeding
    // on the same DISPATCHING takeover. Without this, both can compute nextFencingEpoch = N+1
    // and both UPDATE succeeds (last writer wins silently). With version, the second writer
    // is rejected by the CAS — they cannot both hold version dbVersionAfterTransition.
    const updatedCount = await tx.$executeRaw`
      UPDATE "SendIntent"
      SET    "claimedBy"      = ${workerId},
             "fencingEpoch"   = ${nextFencingEpoch},
             "leaseVersion"   = ${nextLeaseVersion},
             "leaseExpiresAt" = ${leaseExpiresAt},
             "version"        = ${nextVersion},
             "attemptCount"   = "attemptCount" + 1,
             "lastAttemptAt"  = NOW() AT TIME ZONE 'utc',
             "updatedAt"      = NOW() AT TIME ZONE 'utc'
      WHERE  "id"             = ${sendIntentId}
        AND  "version"        = ${dbVersionAfterTransition}
    `;

    if (updatedCount === 0) {
      return { granted: false, reason: "CAS_CONFLICT" } as const;
    }

    logger.info(
      { sendIntentId, workerId, fencingEpoch: nextFencingEpoch, leaseVersion: nextLeaseVersion },
      "[send-intent] Lease claimed & transition committed",
    );

    return {
      granted: true,
      lease: {
        sendIntentId: intent.id,
        operationId: intent.operationId,
        claimedBy: workerId,
        fencingEpoch: nextFencingEpoch,
        leaseVersion: nextLeaseVersion,
        leaseExpiresAt,
        version: nextVersion,
      },
    } as const;
  });
}

/**
 * CAS-protected lease renewal for active SendIntent worker execution.
 */
export async function renewSendIntentLease(params: {
  sendIntentId: string;
  workerId: string;
  fencingEpoch: number;
  leaseVersion: number;
  ttlMs?: number;
}): Promise<{ renewed: boolean; nextLeaseVersion: number; expiresAt: Date }> {
  const { sendIntentId, workerId, fencingEpoch, leaseVersion, ttlMs = DEFAULT_INTENT_LEASE_TTL_MS } = params;
  const now = new Date();
  const nextLeaseVersion = leaseVersion + 1;
  const expiresAt = new Date(now.getTime() + ttlMs);

  const updatedCount = await prisma.$executeRaw`
    UPDATE "SendIntent"
    SET    "leaseVersion"   = ${nextLeaseVersion},
           "leaseExpiresAt" = ${expiresAt},
           "updatedAt"      = NOW() AT TIME ZONE 'utc'
    WHERE  "id"           = ${sendIntentId}
      AND  "claimedBy"    = ${workerId}
      AND  "fencingEpoch" = ${fencingEpoch}
      AND  "leaseVersion" = ${leaseVersion}
      AND  "leaseExpiresAt" > (NOW() AT TIME ZONE 'utc')
  `;

  if (updatedCount === 0) {
    logger.warn(
      { sendIntentId, workerId, fencingEpoch, leaseVersion },
      "[send-intent] Lease renewal failed — lease stolen or expired",
    );
    return { renewed: false, nextLeaseVersion: leaseVersion, expiresAt: now };
  }

  return { renewed: true, nextLeaseVersion, expiresAt };
}

/**
 * Pre-mutation guard verifying worker lease ownership before executing provider dispatch.
 */
export async function assertSendIntentOwnership(params: {
  sendIntentId: string;
  workerId: string;
  fencingEpoch: number;
  leaseVersion: number;
}): Promise<void> {
  const { sendIntentId, workerId, fencingEpoch, leaseVersion } = params;

  const intent = await prisma.sendIntent.findUnique({
    where: { id: sendIntentId },
    select: { claimedBy: true, fencingEpoch: true, leaseVersion: true, leaseExpiresAt: true },
  });

  if (!intent) {
    throw new Error(`[send-intent] Ownership assertion failed: intent ${sendIntentId} not found`);
  }

  if (intent.claimedBy !== workerId) {
    throw new Error(`[send-intent] Ownership assertion failed: claimed by ${intent.claimedBy}, expected ${workerId}`);
  }

  if (intent.fencingEpoch !== fencingEpoch) {
    throw new Error(`[send-intent] Fencing violation: intent fencingEpoch is ${intent.fencingEpoch}, worker holds ${fencingEpoch}`);
  }

  if (intent.leaseVersion !== leaseVersion) {
    throw new Error(`[send-intent] Fencing violation: leaseVersion mismatch (${intent.leaseVersion} vs ${leaseVersion})`);
  }

  if (!intent.leaseExpiresAt || intent.leaseExpiresAt <= new Date()) {
    throw new Error(`[send-intent] Ownership assertion failed: lease expired`);
  }
}

/**
 * Fenced transition helper for SendIntent terminal or progress states.
 */
export async function transitionSendIntent(params: {
  sendIntentId: string;
  expectedState: SendIntentState;
  nextState: SendIntentState;
  expectedVersion: number;
  workerId: string;
  fencingEpoch: number;
  leaseVersion: number;
  providerMessageId?: string;
  errorMessage?: string;
  operationId: string;
}): Promise<{ success: boolean; newVersion: number }> {
  const {
    sendIntentId,
    expectedState,
    nextState,
    expectedVersion,
    workerId,
    fencingEpoch,
    leaseVersion,
    providerMessageId,
    errorMessage,
    operationId,
  } = params;

  const authority: TransitionAuthority = {
    actorType: "WORKER",
    actorId: workerId,
    workerId,
    operationId,
  };

  const fencing: FencingProof = {
    fencingEpoch,
    leaseVersion,
  };

  return await prisma.$transaction(async (tx) => {
    const transitionRes = await transitionState(tx, {
      model: "SendIntent",
      entityId: sendIntentId,
      expectedState,
      expectedVersion,
      nextState,
      authority,
      fencing,
    });

    if (!transitionRes.success) {
      logger.warn(
        { sendIntentId, expectedState, nextState, reason: transitionRes.reason },
        "[send-intent] Transition failed in engine",
      );
      return { success: false, newVersion: expectedVersion };
    }

    // Attach provider result or error details
    if (providerMessageId || errorMessage) {
      await tx.sendIntent.update({
        where: { id: sendIntentId },
        data: {
          ...(providerMessageId && { providerMessageId }),
          ...(errorMessage && { errorMessage }),
        },
      });
    }

    return { success: true, newVersion: transitionRes.newVersion };
  });
}

// ---------------------------------------------------------------------------
// Compatibility Helpers for Reconciliation & Send Agent
// ---------------------------------------------------------------------------

export async function findStaleIntents(
  olderThanMinutes: number = 15,
): Promise<Array<{ id: string; idempotencyKey: string; outreachMessageId: string; status: string; provider: string | null; leaseExpiresAt: Date | null }>> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);

  return prisma.sendIntent.findMany({
    where: {
      status: { in: ["DISPATCHING", "UNKNOWN"] },
      updatedAt: { lt: cutoff },
    },
    select: {
      id: true,
      idempotencyKey: true,
      outreachMessageId: true,
      status: true,
      provider: true,
      leaseExpiresAt: true,
    },
    take: 100,
  });
}

export async function beginReconciliation(
  idempotencyKey: string,
): Promise<boolean> {
  const intent = await prisma.sendIntent.findUnique({
    where: { idempotencyKey },
    select: { id: true, status: true, version: true, operationId: true },
  });

  if (!intent || (intent.status !== "UNKNOWN" && intent.status !== "DISPATCHING")) {
    return false;
  }

  const res = await transitionState(prisma, {
    model: "SendIntent",
    entityId: intent.id,
    expectedState: intent.status,
    expectedVersion: intent.version,
    nextState: "RECONCILING",
    authority: { actorType: "SYSTEM", actorId: intent.operationId, operationId: intent.operationId },
  });

  return res.success;
}

export async function recordReconciledFailed(
  idempotencyKey: string,
  errorMessage: string,
): Promise<void> {
  const intent = await prisma.sendIntent.findUnique({
    where: { idempotencyKey },
    select: { id: true, status: true, version: true, operationId: true },
  });

  if (!intent) return;

  // Fix 1C: Wrap the transitionState CAS and the errorMessage annotation in a single
  // transaction. Previously these were two separate writes; a crash between them
  // left the status as FAILED but errorMessage unpersisted — and the bare update
  // had no WHERE version predicate, risking a dirty overwrite.
  await prisma.$transaction(async (tx) => {
    const transitionRes = await transitionState(tx, {
      model: "SendIntent",
      entityId: intent.id,
      expectedState: intent.status,
      expectedVersion: intent.version,
      nextState: "FAILED",
      authority: { actorType: "SYSTEM", actorId: intent.operationId, operationId: intent.operationId },
    });

    if (!transitionRes.success) {
      // CAS conflict — another worker already settled this intent. No-op.
      logger.info(
        { intentId: intent.id, reason: transitionRes.reason },
        "[send-intent] recordReconciledFailed CAS conflict — intent already settled",
      );
      return;
    }

    // Write errorMessage inside the same transaction; newVersion from CAS is already committed.
    await (tx as any).sendIntent.update({
      where: { id: intent.id },
      data: { errorMessage },
    });
  });
}

export async function recordUnresolved(
  idempotencyKey: string,
): Promise<void> {
  const intent = await prisma.sendIntent.findUnique({
    where: { idempotencyKey },
    select: { id: true, status: true, version: true, operationId: true },
  });

  if (!intent) return;

  // Fix 4: Write UNRESOLVED (not UNKNOWN) — the two are distinct states in the registry.
  // UNRESOLVED signals operator-acknowledged but unresolvable; UNKNOWN feeds the sweeper.
  // Callers in reconciliation.workers.ts that expect UNRESOLVED now get the correct state.
  await transitionState(prisma, {
    model: "SendIntent",
    entityId: intent.id,
    expectedState: intent.status,
    expectedVersion: intent.version,
    nextState: "UNRESOLVED",
    authority: { actorType: "SYSTEM", actorId: intent.operationId, operationId: intent.operationId },
  });
}

export async function createOrRecoverSendIntent(params: {
  operationId: string;
  leadId: string;
  outreachMessageId: string;
  sequenceStep: number;
  idempotencyKey: string;
  provider?: string;
  payloadHash?: string;
}): Promise<{ alreadyAccepted: boolean; providerMessageId: string | null; requiresReconciliation: boolean }> {
  const existing = await prisma.sendIntent.findUnique({
    where: { idempotencyKey: params.idempotencyKey },
    select: { status: true, providerMessageId: true },
  });

  if (existing?.status === "ACCEPTED" || existing?.status === "SENT") {
    return {
      alreadyAccepted: true,
      providerMessageId: existing.providerMessageId,
      requiresReconciliation: false,
    };
  }

  if (existing?.status === "UNKNOWN" || existing?.status === "RECONCILING") {
    return {
      alreadyAccepted: false,
      providerMessageId: existing.providerMessageId,
      requiresReconciliation: true,
    };
  }

  await prisma.sendIntent.upsert({
    where: { idempotencyKey: params.idempotencyKey },
    create: {
      operationId: params.operationId,
      leadId: params.leadId,
      outreachMessageId: params.outreachMessageId,
      sequenceStep: params.sequenceStep,
      idempotencyKey: params.idempotencyKey,
      status: "DISPATCHING",
      provider: params.provider,
      payloadHash: params.payloadHash,
      attemptCount: 1,
      lastAttemptAt: new Date(),
    },
    update: {
      status: "DISPATCHING",
      attemptCount: { increment: 1 },
      lastAttemptAt: new Date(),
      provider: params.provider,
      payloadHash: params.payloadHash,
    },
  });

  return { alreadyAccepted: false, providerMessageId: null, requiresReconciliation: false };
}

/**
 * @deprecated Sprint 2 API — bypasses transitionState() and has no CAS.
 * Use finalizeSendIntent() from send-finalize.service.ts for SENT/FAILED terminals.
 * This function will be removed once all callers are migrated.
 */
export async function recordSendAccepted(
  idempotencyKey: string,
  providerMessageId: string,
): Promise<void> {
  await prisma.sendIntent.update({
    where: { idempotencyKey },
    data: {
      status: "ACCEPTED",
      providerMessageId,
      updatedAt: new Date(),
    },
  });
}

/**
 * @deprecated Sprint 2 API — bypasses transitionState() and has no CAS.
 * Use finalizeSendIntent() from send-finalize.service.ts for FAILED terminals.
 * This function will be removed once all callers are migrated.
 */
export async function recordSendFailed(
  idempotencyKey: string,
  errorMessage: string,
): Promise<void> {
  await prisma.sendIntent
    .update({
      where: { idempotencyKey },
      data: {
        status: "FAILED",
        errorMessage,
        updatedAt: new Date(),
      },
    })
    .catch(() => null);
}

/**
 * @deprecated Sprint 2 API — bypasses transitionState() and has no CAS.
 * Use the UNKNOWN path in send-dispatch.worker.ts (handleUnknownOutcome) instead.
 * This function will be removed once all callers are migrated.
 */
export async function recordSendUnknown(
  idempotencyKey: string,
  errorMessage: string,
): Promise<void> {
  await prisma.sendIntent
    .update({
      where: { idempotencyKey },
      data: {
        status: "UNKNOWN",
        errorMessage,
        updatedAt: new Date(),
      },
    })
    .catch(() => null);
}

