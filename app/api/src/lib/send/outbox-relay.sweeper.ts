/**
 * Outbox Relay Sweeper  (Sprint 4 — 4.5)
 *
 * The transactional outbox pattern: events are first written to `OutboxEvent`
 * inside the same DB transaction as the business mutation (guaranteed atomic).
 * This sweeper is the *relay* — it polls PENDING OutboxEvents and publishes
 * them to BullMQ so downstream workers can react.
 *
 * Why BullMQ and not direct webhooks/Kafka here?
 *   - BullMQ is already the system's durable async bus.
 *   - Downstream event handlers (e.g. marking OutreachMessage SENT, triggering
 *     reply-poll, lead state transitions) all run as BullMQ workers.
 *   - This keeps the relay thin: it is not responsible for the business logic,
 *     only for moving PENDING → PUBLISHED in the queue.
 *
 * Event routing:
 *   SEND_INTENT_SENT              → maintenanceQueue  (lead state machine update)
 *   SEND_INTENT_FAILED            → maintenanceQueue  (lead state machine update)
 *   SEND_INTENT_RECONCILED_SENT   → maintenanceQueue
 *   SEND_INTENT_RECONCILED_FAILED → maintenanceQueue
 *   SEND_INTENT_UNKNOWN           → maintenanceQueue  (triggers sweep-unknown-intents)
 *   SEND_INTENT_HUMAN_REVIEW_*    → maintenanceQueue  (operator alert)
 *   (all others)                  → maintenanceQueue  (default)
 *
 * Idempotency:
 *   Each OutboxEvent has a unique `idempotencyKey`.
 *   BullMQ job IDs are set to `outbox:${event.idempotencyKey}` — a duplicate
 *   enqueue of the same key is silently ignored by BullMQ (deduplication).
 *
 * Safety contracts:
 *   1. The event status is updated to PUBLISHED only after BullMQ confirms enqueue.
 *   2. On BullMQ failure, status is marked FAILED with the error — retry on next tick.
 *   3. Events that fail > MAX_RELAY_ATTEMPTS times are marked DEAD — operator alert.
 *   4. The sweeper does NOT delete events — they are the durable audit trail.
 *   5. Batch size is bounded to prevent unbounded memory usage per tick.
 */

import { prisma } from "../prisma";
import { logger } from "../logger";
import { maintenanceQueue } from "../../modules/gemini/campaign.queue";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const RELAY_BATCH_SIZE = 100;
const MAX_RELAY_ATTEMPTS = 5;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface OutboxRelaySweepResult {
  scanned: number;
  published: number;
  failed: number;
  dead: number;
}

/**
 * Relay PENDING OutboxEvents to BullMQ.
 * Intended to run as a periodic BullMQ repeatable job (~every minute).
 */
export async function sweepOutboxEvents(): Promise<OutboxRelaySweepResult> {
  // ── Query ──────────────────────────────────────────────────────────────────
  // Include FAILED events that haven't exceeded MAX_RELAY_ATTEMPTS yet (retry).
  // Order by createdAt ASC so oldest events are delivered first (FIFO).
  const events = await prisma.outboxEvent.findMany({
    where: {
      status: { in: ["PENDING", "FAILED"] },
      attempts: { lt: MAX_RELAY_ATTEMPTS },
    },
    select: {
      id: true,
      aggregateType: true,
      aggregateId: true,
      aggregateVersion: true,
      eventType: true,
      payload: true,
      idempotencyKey: true,
      operationId: true,
      attempts: true,
    },
    orderBy: { createdAt: "asc" },
    take: RELAY_BATCH_SIZE,
  });

  const result: OutboxRelaySweepResult = {
    scanned: events.length,
    published: 0,
    failed: 0,
    dead: 0,
  };

  if (events.length === 0) return result;

  logger.info(
    { count: events.length },
    "[outbox-relay] Starting relay batch",
  );

  for (const event of events) {
    await relayEvent(event, result);
  }

  // ── Dead-letter pass ──────────────────────────────────────────────────────
  // Mark events that have exceeded MAX_RELAY_ATTEMPTS and are still FAILED.
  const deadCount = await prisma.outboxEvent.updateMany({
    where: {
      status: "FAILED",
      attempts: { gte: MAX_RELAY_ATTEMPTS },
    },
    data: { status: "DEAD_LETTER" },
  });

  if (deadCount.count > 0) {
    result.dead += deadCount.count;
    logger.error(
      { dead: deadCount.count },
      "[outbox-relay] 🚨 OutboxEvents exceeded max relay attempts — marked DEAD (operator attention required)",
    );
  }

  logger.info(result, "[outbox-relay] Relay batch complete");
  return result;
}

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------

type OutboxEventRow = {
  id: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  eventType: string;
  payload: unknown;
  idempotencyKey: string;
  operationId: string | null;
  attempts: number;
};

import { randomUUID } from "node:crypto";

async function relayEvent(
  event: OutboxEventRow,
  result: OutboxRelaySweepResult,
): Promise<void> {
  const now = new Date();
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + 5 * 60 * 1000);

  // Claim with leaseToken
  const claimed = await prisma.outboxEvent.updateMany({
    where: {
      id: event.id,
      status: { in: ["PENDING", "FAILED"] },
    },
    data: {
      status: "PROCESSING",
      leaseToken,
      leaseExpiresAt,
    },
  });

  if (claimed.count === 0) return;

  const jobId = `outbox:${event.idempotencyKey}`;
  const jobName = mapEventToJobName(event.eventType);
  const jobData = {
    outboxEventId: event.id,
    eventType: event.eventType,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    aggregateVersion: event.aggregateVersion,
    operationId: event.operationId,
    payload: event.payload,
  };

  try {
    // BullMQ deduplicates on jobId — safe to call even if already enqueued.
    await maintenanceQueue.add(jobName, jobData, {
      jobId,
      // Remove completed jobs quickly — the OutboxEvent row is the durable record.
      removeOnComplete: { age: 300 },
      // Keep failed jobs for 24h for debugging.
      removeOnFail: { age: 86_400 },
    });

    // Fenced Mark as PUBLISHED in DB — only after BullMQ confirms enqueue.
    const fencedResult = await prisma.outboxEvent.updateMany({
      where: { id: event.id, status: "PROCESSING", leaseToken },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null,
        attempts: { increment: 1 },
      },
    });

    if (fencedResult.count === 0) {
      logger.warn(
        { outboxEventId: event.id, leaseToken },
        "[outbox-relay] Fencing breach — worker lost lease before PUBLISHED update",
      );
      return;
    }

    result.published++;

    logger.debug(
      { outboxEventId: event.id, eventType: event.eventType, jobId },
      "[outbox-relay] Event published to BullMQ",
    );
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    await prisma.outboxEvent.updateMany({
      where: { id: event.id, status: "PROCESSING", leaseToken },
      data: {
        status: "FAILED",
        lastError: errorMsg,
        leaseToken: null,
        leaseExpiresAt: null,
        attempts: { increment: 1 },
      },
    }).catch((dbErr) => {
      logger.error(
        { outboxEventId: event.id, dbErr },
        "[outbox-relay] Failed to update event status to FAILED — DB error",
      );
    });

    logger.warn(
      { outboxEventId: event.id, eventType: event.eventType, attempt: event.attempts + 1, error: errorMsg },
      "[outbox-relay] Failed to relay event — will retry on next tick",
    );

    result.failed++;
  }
}

/**
 * Map OutboxEvent eventType to a BullMQ job name in the maintenance queue.
 *
 * Convention: outbox-event handlers in the maintenance worker receive jobs
 * named `handle-outbox-event`. Specific high-priority events get dedicated
 * job names so they can be prioritized differently.
 */
function mapEventToJobName(eventType: string): string {
  switch (eventType) {
    // High-priority: these drive lead state transitions
    case "SEND_INTENT_SENT":
    case "SEND_INTENT_RECONCILED_SENT":
      return "handle-send-intent-sent";

    case "SEND_INTENT_FAILED":
    case "SEND_INTENT_RECONCILED_FAILED":
      return "handle-send-intent-failed";

    // Reconciliation trigger
    case "SEND_INTENT_UNKNOWN":
      return "sweep-unknown-intents";

    // Operator escalation
    case "SEND_INTENT_HUMAN_REVIEW_REQUIRED":
      return "handle-send-intent-human-review";

    // Default: generic handler for extension
    default:
      return "handle-outbox-event";
  }
}
