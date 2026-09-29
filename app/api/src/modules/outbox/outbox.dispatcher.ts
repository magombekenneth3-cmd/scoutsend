/**
 * Sprint 9 — Outbox Event Dispatcher & Durable Recovery Engine
 *
 * LOCATION: app/api/src/modules/outbox/outbox.dispatcher.ts
 *
 * RESPONSIBILITIES:
 * 1. DB-backed atomic claiming with lease expiration.
 * 2. Asynchronous delivery to external providers with idempotency key preservation.
 * 3. Exponential backoff retry handling.
 * 4. Automatic dead-letter transition on max attempts.
 * 5. Stale PROCESSING event crash recovery.
 */

import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { isKillSwitchActive } from "../../lib/send/dispatch-kill-switch.service";
import { getCircuitState } from "../../lib/send/provider-circuit-breaker.service";
import {
  OutboxError,
  OutboxDeliveryError,
  OutboxClaimError,
  OutboxMaxAttemptsError,
} from "./outbox.errors";
import type { OutboxEventType, OutboxEventMap } from "./outbox.types";

export const MAX_OUTBOX_ATTEMPTS = 5;
export const LEASE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes lease timeout
export const BASE_BACKOFF_MS = 1000;
export const MAX_BACKOFF_MS = 10 * 60 * 1000; // 10 minutes max backoff cap

export type OutboxErrorDisposition = "RETRY" | "DEAD_LETTER";

export interface DispatchOutboxResult {
  processed: number;
  succeeded: number;
  retried: number;
  deadLettered: number;
  fencingBreaches: number;
}

// ─── Error Classifier & Backoff Calculators ────────────────────────────────

export function classifyOutboxError(error: unknown): OutboxErrorDisposition {
  if (!error) return "RETRY";

  let statusCode: number | undefined;

  if (error instanceof OutboxDeliveryError) {
    statusCode = error.statusCode;
    if (error.isRetryable === false) return "DEAD_LETTER";
  } else if (typeof error === "object" && error !== null) {
    if ("statusCode" in error && typeof (error as Record<string, unknown>).statusCode === "number") {
      statusCode = (error as Record<string, unknown>).statusCode as number;
    } else if ("status" in error && typeof (error as Record<string, unknown>).status === "number") {
      statusCode = (error as Record<string, unknown>).status as number;
    }
  }

  if (statusCode !== undefined) {
    if (statusCode === 429 || statusCode >= 500) {
      return "RETRY";
    }
    if (statusCode >= 400 && statusCode < 500) {
      return "DEAD_LETTER";
    }
  }

  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();

  if (
    msg.includes("invalid payload") ||
    msg.includes("invalid recipient") ||
    msg.includes("unauthorized") ||
    msg.includes("forbidden") ||
    msg.includes("bad request") ||
    msg.includes("not found") ||
    msg.includes("unprocessable entity") ||
    msg.includes("invalid credentials")
  ) {
    return "DEAD_LETTER";
  }

  return "RETRY";
}

export function calculateNextRetryAt(attempts: number, now: Date = new Date()): Date {
  const safeAttempts = Math.max(0, attempts - 1);
  const exponential = BASE_BACKOFF_MS * Math.pow(2, safeAttempts);
  const jitter = Math.floor(Math.random() * 500); // 0-500ms bounded jitter
  const delay = Math.min(exponential + jitter, MAX_BACKOFF_MS);
  return new Date(now.getTime() + delay);
}

export function sanitizeOutboxError(error: unknown): string {
  let msg = error instanceof Error ? error.message : String(error);
  msg = msg.replace(/(bearer|token|apikey|key|password|auth)=?[^\s&"']+/gi, "$1=[REDACTED]");
  msg = msg.replace(/(prompt|body)=?[^\s&"']+/gi, "$1=[REDACTED]");
  return msg.slice(0, 500);
}

// ─── External Provider Handlers (Injectable/Mockable) ─────────────────────

export type ProviderDeliveryHandler = (
  eventType: OutboxEventType,
  idempotencyKey: string,
  payload: unknown,
) => Promise<{ success: boolean; statusCode?: number; error?: string }>;

let customDeliveryHandler: ProviderDeliveryHandler | null = null;

export function registerProviderDeliveryHandler(handler: ProviderDeliveryHandler) {
  customDeliveryHandler = handler;
}

export function resetProviderDeliveryHandler() {
  customDeliveryHandler = null;
}

async function defaultDeliverToProvider(
  eventType: OutboxEventType,
  idempotencyKey: string,
  payload: unknown,
) {
  if (customDeliveryHandler) {
    return customDeliveryHandler(eventType, idempotencyKey, payload);
  }

  logger.info(
    { eventType, idempotencyKey },
    "[outbox.dispatcher] Delivering event to external provider",
  );
  return { success: true, statusCode: 200 };
}

// ─── Event Claiming & Fenced Dispatcher Engine ─────────────────────────────

export async function processOutboxEvent(eventId: string): Promise<boolean> {
  const now = new Date();
  const leaseCutoff = new Date(now.getTime() - LEASE_TIMEOUT_MS);
  const leaseToken = randomUUID();
  const leaseExpiresAt = new Date(now.getTime() + LEASE_TIMEOUT_MS);

  // 1. Atomic DB-backed Claim (Generating fresh leaseToken UUID & leaseExpiresAt)
  const claimed = await prisma.outboxEvent.updateMany({
    where: {
      id: eventId,
      OR: [
        { status: "PENDING" },
        {
          status: "FAILED",
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        },
        { status: "PROCESSING", leaseExpiresAt: { lte: now } }, // Expired lease recovery
        { status: "PROCESSING", createdAt: { lt: leaseCutoff } }, // Stale crash fallback
      ],
      attempts: { lt: MAX_OUTBOX_ATTEMPTS },
    },
    data: {
      status: "PROCESSING",
      leaseToken,
      leaseExpiresAt,
      attempts: { increment: 1 },
    },
  });

  if (claimed.count === 0) {
    const current = await prisma.outboxEvent.findUnique({ where: { id: eventId } });
    if (current?.status === "SUCCEEDED" || current?.status === "PUBLISHED") {
      return true;
    }
    if (current?.attempts && current.attempts >= MAX_OUTBOX_ATTEMPTS) {
      await prisma.outboxEvent.updateMany({
        where: { id: eventId, status: { not: "SUCCEEDED" } },
        data: { status: "DEAD_LETTER", nextRetryAt: null, leaseToken: null, leaseExpiresAt: null, lastError: "Max delivery attempts reached" },
      }).catch(() => {});
      throw new OutboxMaxAttemptsError(eventId, current.attempts);
    }
    throw new OutboxClaimError(eventId);
  }

  const event = await prisma.outboxEvent.findUnique({ where: { id: eventId } });
  if (!event) throw new OutboxError(`OutboxEvent ${eventId} disappeared after claiming`);

  // Kill Switch Safety Check (Pre-Invocation Gating)
  const killSwitch = isKillSwitchActive({
    organizationId: event.organizationId,
    providerName: "DEFAULT_MAIL_PROVIDER",
  });

  if (killSwitch.blocked) {
    logger.warn(
      { outboxEventId: eventId, scope: killSwitch.activeScope },
      "[outbox.dispatcher] Emergency kill switch active — deferring dispatch",
    );
    await prisma.outboxEvent.updateMany({
      where: { id: eventId, leaseToken },
      data: {
        status: "PENDING",
        leaseToken: null,
        leaseExpiresAt: null,
        nextRetryAt: new Date(Date.now() + 60_000),
      },
    }).catch(() => {});
    return false;
  }

  // Circuit Breaker Gating Check
  const circuitState = getCircuitState("DEFAULT_MAIL_PROVIDER");
  if (circuitState === "OPEN") {
    logger.warn(
      { outboxEventId: eventId },
      "[outbox.dispatcher] Provider circuit OPEN — deferring dispatch",
    );
    await prisma.outboxEvent.updateMany({
      where: { id: eventId, leaseToken },
      data: {
        status: "PENDING",
        leaseToken: null,
        leaseExpiresAt: null,
        nextRetryAt: new Date(Date.now() + 30_000),
      },
    }).catch(() => {});
    return false;
  }

  // 2. Log ProviderDeliveryAttempt in PROCESSING state (Non-blocking Telemetry)
  let attemptId: string | null = null;
  const startTime = Date.now();
  try {
    const createdAttempt = await prisma.providerDeliveryAttempt.upsert({
      where: {
        outboxEventId_attemptNumber: {
          outboxEventId: eventId,
          attemptNumber: event.attempts,
        },
      },
      create: {
        organizationId: event.organizationId,
        outboxEventId: eventId,
        attemptNumber: event.attempts,
        leaseToken,
        provider: "DEFAULT_MAIL_PROVIDER",
        outcome: "PROCESSING",
        startedAt: now,
      },
      update: {
        leaseToken,
        startedAt: now,
      },
    });
    attemptId = createdAttempt.id;
  } catch (telemetryErr) {
    logger.warn({ outboxEventId: eventId, error: telemetryErr }, "[outbox.dispatcher] Failed to log initial ProviderDeliveryAttempt (non-blocking)");
  }

  // Helper for non-blocking attempt outcome updates
  const safeUpdateAttemptOutcome = async (outcome: string, statusCode?: number, providerMessageId?: string, errorCode?: string) => {
    if (!attemptId) return;
    try {
      await prisma.providerDeliveryAttempt.update({
        where: { id: attemptId },
        data: {
          completedAt: new Date(),
          latencyMs: Date.now() - startTime,
          outcome,
          statusCode: statusCode ?? null,
          providerMessageId: providerMessageId ?? null,
          errorCode: errorCode ?? null,
        },
      });
    } catch (err) {
      logger.warn({ attemptId, err }, "[outbox.dispatcher] Failed to update ProviderDeliveryAttempt outcome (non-blocking)");
    }
  };

  // Helper for non-blocking fencing incident recording
  const safeRecordFencingIncident = async () => {
    try {
      const currentEv = await prisma.outboxEvent.findUnique({
        where: { id: eventId },
        select: { leaseToken: true, leaseExpiresAt: true },
      });
      await prisma.outboxFencingIncident.create({
        data: {
          organizationId: event.organizationId,
          outboxEventId: eventId,
          staleLeaseToken: leaseToken,
          currentLeaseToken: currentEv?.leaseToken ?? null,
          leaseExpiresAt: currentEv?.leaseExpiresAt ?? null,
        },
      });
    } catch (fencingErr) {
      logger.warn({ outboxEventId: eventId, error: fencingErr }, "[outbox.dispatcher] Failed to record OutboxFencingIncident (non-blocking)");
    }
  };

  // 3. Execute Provider Delivery with Idempotency Key Preservation
  try {
    const delivery = await defaultDeliverToProvider(
      event.eventType as OutboxEventType,
      event.idempotencyKey,
      event.payload,
    );

    if (delivery.success) {
      await safeUpdateAttemptOutcome("SUCCESS", delivery.statusCode, (delivery as any).providerMessageId);

      // Fenced Completion Update — Must match leaseToken
      const fencedResult = await prisma.outboxEvent.updateMany({
        where: {
          id: eventId,
          status: "PROCESSING",
          leaseToken,
        },
        data: {
          status: "SUCCEEDED",
          publishedAt: new Date(),
          nextRetryAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: null,
        },
      });

      if (fencedResult.count === 0) {
        logger.warn(
          { outboxEventId: eventId, leaseToken },
          "[outbox.dispatcher] Fencing breach — worker lost lease before SUCCEEDED update",
        );
        await safeRecordFencingIncident();
        return false; // Stalled worker aborted safely
      }

      logger.info(
        { outboxEventId: eventId, idempotencyKey: event.idempotencyKey, leaseToken },
        "[outbox.dispatcher] OutboxEvent delivered & fenced SUCCEEDED successfully",
      );
      return true;
    } else {
      throw new OutboxDeliveryError(
        delivery.error ?? "External provider delivery failed",
        eventId,
        event.idempotencyKey,
        delivery.statusCode,
      );
    }
  } catch (err: unknown) {
    const sanitizedMsg = sanitizeOutboxError(err);
    const disposition = classifyOutboxError(err);
    const nextAttempts = event.attempts + 1;

    const outcomeType = disposition === "DEAD_LETTER" || nextAttempts >= MAX_OUTBOX_ATTEMPTS ? "PERMANENT_ERROR" : "RETRYABLE_ERROR";
    await safeUpdateAttemptOutcome(outcomeType, (err as any)?.statusCode, undefined, sanitizedMsg);

    // Immediately DEAD_LETTER permanent errors or max attempts reached
    if (disposition === "DEAD_LETTER" || nextAttempts >= MAX_OUTBOX_ATTEMPTS) {
      const fencedResult = await prisma.outboxEvent.updateMany({
        where: {
          id: eventId,
          status: "PROCESSING",
          leaseToken,
        },
        data: {
          status: "DEAD_LETTER",
          nextRetryAt: null,
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: sanitizedMsg,
        },
      });

      if (fencedResult.count === 0) {
        logger.warn(
          { outboxEventId: eventId, leaseToken },
          "[outbox.dispatcher] Fencing breach — worker lost lease before DEAD_LETTER update",
        );
        await safeRecordFencingIncident();
        return false;
      }

      logger.error(
        { outboxEventId: eventId, idempotencyKey: event.idempotencyKey, sanitizedMsg, disposition },
        "[outbox.dispatcher] OutboxEvent transitioned to DEAD_LETTER",
      );
      throw new OutboxMaxAttemptsError(eventId, nextAttempts);
    }

    // Schedule retryable error with exponential backoff + jitter (Fenced update)
    const nextRetryAt = calculateNextRetryAt(nextAttempts, now);
    const fencedResult = await prisma.outboxEvent.updateMany({
      where: {
        id: eventId,
        status: "PROCESSING",
        leaseToken,
      },
      data: {
        status: "FAILED",
        nextRetryAt,
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: sanitizedMsg,
      },
    });

    if (fencedResult.count === 0) {
      logger.warn(
        { outboxEventId: eventId, leaseToken },
        "[outbox.dispatcher] Fencing breach — worker lost lease before FAILED update",
      );
      await safeRecordFencingIncident();
      return false;
    }

    logger.warn(
      { outboxEventId: eventId, idempotencyKey: event.idempotencyKey, attempts: nextAttempts, nextRetryAt },
      "[outbox.dispatcher] OutboxEvent failed — scheduled retry with backoff",
    );

    throw err;
  }
}

// ─── Batch Sweeper & Stale Crash Recovery ─────────────────────────────────────

export async function dispatchPendingOutboxEvents(batchSize = 50): Promise<DispatchOutboxResult> {
  const now = new Date();
  const leaseCutoff = new Date(now.getTime() - LEASE_TIMEOUT_MS);

  const pendingEvents = await prisma.outboxEvent.findMany({
    where: {
      OR: [
        { status: "PENDING" },
        {
          status: "FAILED",
          OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
        },
        { status: "PROCESSING", leaseExpiresAt: { lte: now } }, // Recover expired leases
        { status: "PROCESSING", createdAt: { lt: leaseCutoff } }, // Recover crashed workers
      ],
      attempts: { lt: MAX_OUTBOX_ATTEMPTS },
    },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });

  const result: DispatchOutboxResult = {
    processed: pendingEvents.length,
    succeeded: 0,
    retried: 0,
    deadLettered: 0,
    fencingBreaches: 0,
  };

  for (const event of pendingEvents) {
    try {
      const ok = await processOutboxEvent(event.id);
      if (ok) {
        result.succeeded += 1;
      } else {
        result.fencingBreaches += 1;
      }
    } catch (err: unknown) {
      if (err instanceof OutboxMaxAttemptsError) {
        result.deadLettered += 1;
      } else {
        result.retried += 1;
      }
    }
  }

  return result;
}
