/**
 * Sprint 9 — Transactional Outbox Service
 *
 * LOCATION: app/api/src/modules/outbox/outbox.service.ts
 *
 * ARCHITECTURAL INVARIANT:
 * Business state and the intent to perform every external side effect must be committed atomically in the same Prisma transaction.
 *
 * RULES:
 * 1. Must pass Prisma.TransactionClient tx — ensures zero outbox records exist without committed business mutation.
 * 2. Idempotency keys must be deterministic (never random UUIDs).
 * 3. Payload must be PII-minimal JSON value.
 */

import { Prisma } from "@prisma/client";
import { logger } from "../../lib/logger";
import type { OutboxEventType, CreateOutboxEventParams } from "./outbox.types";

// ─── Idempotency Key Builders ───────────────────────────────────────────────

export function buildEmailSendIdempotencyKey(outreachMessageId: string): string {
  return `email:${outreachMessageId}`;
}

export function buildCrmSyncIdempotencyKey(
  leadId: string,
  eventType = "CRM_SYNC",
  contextId?: string,
): string {
  const parts = ["crm", leadId, eventType];
  if (contextId) parts.push(contextId);
  return parts.join(":");
}

export function buildWebhookIdempotencyKey(webhookId: string, eventName: string): string {
  return `webhook:${webhookId}:${eventName}`;
}

export function buildReplyClassifiedIdempotencyKey(replyId: string): string {
  return `reply:${replyId}`;
}

// ─── Atomic Outbox Event Creator ─────────────────────────────────────────────

export async function createOutboxEvent<K extends OutboxEventType>(
  tx: Prisma.TransactionClient,
  params: CreateOutboxEventParams<K>,
) {
  const {
    organizationId,
    eventType,
    aggregateType,
    aggregateId,
    idempotencyKey,
    payload,
    correlationId,
    aggregateVersion = 0,
    operationId,
  } = params;

  logger.debug(
    { organizationId, eventType, aggregateType, aggregateId, idempotencyKey },
    "[outbox.service] Writing transactional OutboxEvent",
  );

  return tx.outboxEvent.create({
    data: {
      organizationId,
      correlationId: correlationId ?? null,
      eventType,
      aggregateType,
      aggregateId,
      aggregateVersion,
      idempotencyKey,
      operationId: operationId ?? null,
      payload: payload as unknown as Prisma.InputJsonValue,
      status: "PENDING",
    },
  });
}
