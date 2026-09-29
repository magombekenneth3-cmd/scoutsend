import { prisma } from "../prisma";
import { logger } from "../logger";
import { recoverExpiredOperations } from "../operations/operation.service";
import { findStaleIntents, beginReconciliation, recordReconciledFailed, recordUnresolved } from "./send-intent.service";
import { finalizeReconciledIntent } from "./send-finalize.service";
import { transitionState } from "../state/transition-state";
import { reconcileExpiredReservations } from "../daily-quota";
import { processOutboxEvent } from "../../modules/outbox/outbox.dispatcher";

export async function reconcileOperations(): Promise<{ recovered: number }> {
  const recovered = await recoverExpiredOperations();
  return { recovered };
}

export async function reconcileSendIntents(): Promise<{ processed: number; resolved: number; unresolved: number }> {
  const stale = await findStaleIntents(15);

  if (stale.length === 0) {
    return { processed: 0, resolved: 0, unresolved: 0 };
  }

  let resolved = 0;
  let unresolvedCount = 0;

  for (const intent of stale) {
    const acquired = await beginReconciliation(intent.idempotencyKey);
    if (!acquired) continue;

    const message = await prisma.outreachMessage.findUnique({
      where: { id: intent.outreachMessageId },
      select: { id: true, deliveryState: true, externalMessageId: true },
    });

    if (message?.deliveryState === "SENT" && message.externalMessageId) {
      // Fix 1A: Use finalizeReconciledIntent() for atomic CAS + quota + outbox + outreach message settlement.
      // The intent is in RECONCILING state (set by beginReconciliation above).
      // We must load its current version to pass the CAS proof.
      const intentRow = await prisma.sendIntent.findUnique({
        where: { idempotencyKey: intent.idempotencyKey },
        select: { id: true, version: true, operationId: true },
      });

      if (!intentRow) {
        logger.warn({ idempotencyKey: intent.idempotencyKey }, "[reconciliation] Intent disappeared after RECONCILING lock — skipping");
        continue;
      }

      const finalizeResult = await finalizeReconciledIntent({
        sendIntentId: intentRow.id,
        operationId: intentRow.operationId,
        outreachMessageId: intent.outreachMessageId,
        expectedVersion: intentRow.version,
        nextState: "SENT",
        quotaSettlement: "CONSUMED",
        providerMessageId: message.externalMessageId,
      });

      if (finalizeResult.success) {
        resolved++;
        logger.info(
          { idempotencyKey: intent.idempotencyKey, settledReservations: finalizeResult.settledReservations },
          "[reconciliation] SendIntent resolved via message state → SENT (atomic finalize)",
        );
      } else {
        logger.warn(
          { idempotencyKey: intent.idempotencyKey, reason: finalizeResult.reason },
          "[reconciliation] finalizeReconciledIntent CAS conflict — another worker settled first",
        );
      }
      continue;
    }

    if (intent.status === "DISPATCHING") {
      // GAP-006 Fix: Do not fail DISPATCHING intents unconditionally — check if lease has expired
      const expired = intent.leaseExpiresAt ? new Date(intent.leaseExpiresAt) < new Date() : true;
      if (!expired) {
        // Active worker lease owner is still executing — skip to prevent duplicate send
        continue;
      }

      await recordReconciledFailed(
        intent.idempotencyKey,
        "Stale DISPATCHING intent — lease expired",
      );
      resolved++;

      // Fix 1B: Use transitionState for OutreachMessage revert so the CAS is predicated on
      // the expected state. Without a version predicate the bare update could overwrite
      // a newer delivery state written by a concurrent finalize.
      if (message && message.deliveryState === "SENDING") {
        const msgRow = await prisma.outreachMessage.findUnique({
          where: { id: intent.outreachMessageId },
          select: { id: true, version: true },
        });
        if (msgRow) {
          await transitionState(prisma, {
            model: "OutreachMessage",
            entityId: msgRow.id,
            expectedState: "SENDING",
            expectedVersion: msgRow.version,
            nextState: "QUEUED",
            authority: {
              actorType: "SYSTEM",
              actorId: "reconciliation-worker",
              operationId: intent.idempotencyKey,
            },
          });
        }
      }

      continue;
    }

    await recordUnresolved(intent.idempotencyKey);
    unresolvedCount++;
  }

  logger.info(
    { processed: stale.length, resolved, unresolved: unresolvedCount },
    "[reconciliation] SendIntent reconciliation complete",
  );

  return { processed: stale.length, resolved, unresolved: unresolvedCount };
}

export async function reconcileQuotaReservations(): Promise<{ released: number }> {
  const released = await reconcileExpiredReservations();
  return { released };
}

export async function reconcileMessageClaims(): Promise<{ requeued: number }> {
  const now = new Date();

  const staleMessages = await prisma.outreachMessage.findMany({
    where: {
      deliveryState: "SENDING",
      claimExpiresAt: { lt: now },
    },
    select: { id: true, leadId: true },
    take: 200,
  });

  if (staleMessages.length === 0) {
    return { requeued: 0 };
  }

  const messageIds = staleMessages.map((m) => m.id);

  const associatedIntents = await prisma.sendIntent.findMany({
    where: { outreachMessageId: { in: messageIds } },
    select: { outreachMessageId: true, status: true, providerMessageId: true },
  });

  const intentMap = new Map(
    associatedIntents.map((i) => [i.outreachMessageId, i]),
  );

  let requeued = 0;

  for (const msg of staleMessages) {
    const intent = intentMap.get(msg.id);

    if (intent?.status === "ACCEPTED" && intent.providerMessageId) {
      await prisma.outreachMessage.update({
        where: { id: msg.id },
        data: {
          deliveryState: "SENT",
          externalMessageId: intent.providerMessageId,
          sentAt: new Date(),
          claimToken: null,
          claimExpiresAt: null,
        },
      }).catch(() => null);

      logger.info(
        { messageId: msg.id },
        "[reconciliation] Stale SENDING message recovered → SENT (intent was ACCEPTED)",
      );
      continue;
    }

    if (intent?.status === "UNKNOWN" || intent?.status === "RECONCILING" || intent?.status === "UNRESOLVED") {
      continue;
    }

    await prisma.outreachMessage.update({
      where: { id: msg.id },
      data: {
        deliveryState: "QUEUED",
        claimToken: null,
        claimExpiresAt: null,
      },
    }).catch(() => null);

    requeued++;
  }

  if (requeued > 0) {
    logger.warn(
      { requeued, total: staleMessages.length },
      "[reconciliation] Stale SENDING messages requeued",
    );
  }

  return { requeued };
}

export async function reconcileOutboxEvents(): Promise<{ published: number; failed: number }> {
  // GAP-003 Fix: Delegate outbox recovery to processOutboxEvent in outbox.dispatcher.ts
  const pending = await prisma.outboxEvent.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      attempts: { lt: 5 },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
    },
    orderBy: { createdAt: "asc" },
    take: 50,
  });

  if (pending.length === 0) {
    return { published: 0, failed: 0 };
  }

  let published = 0;
  let failed = 0;

  for (const event of pending) {
    try {
      const ok = await processOutboxEvent(event.id);
      if (ok) published++;
      else failed++;
    } catch {
      failed++;
    }
  }

  if (published > 0 || failed > 0) {
    logger.info(
      { published, failed, total: pending.length },
      "[reconciliation] Outbox event reconciliation complete",
    );
  }

  return { published, failed };
}
