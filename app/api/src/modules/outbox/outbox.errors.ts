/**
 * Sprint 9 — Outbox Error Taxonomy
 *
 * SECURITY INVARIANT:
 * Does NOT expose raw PII, lead emails, credentials, prompt content, or raw tokens.
 * Exposes only safe event identifiers, error codes, and aggregate IDs.
 */

export class OutboxError extends Error {
  public readonly outboxEventId?: string;
  public readonly idempotencyKey?: string;

  constructor(message: string, outboxEventId?: string, idempotencyKey?: string) {
    super(message);
    this.name = "OutboxError";
    this.outboxEventId = outboxEventId;
    this.idempotencyKey = idempotencyKey;
  }
}

export class OutboxDeliveryError extends OutboxError {
  public readonly statusCode?: number;
  public readonly isRetryable: boolean;

  constructor(
    message: string,
    outboxEventId?: string,
    idempotencyKey?: string,
    statusCode?: number,
    isRetryable = true,
  ) {
    super(message, outboxEventId, idempotencyKey);
    this.name = "OutboxDeliveryError";
    this.statusCode = statusCode;
    this.isRetryable = isRetryable;
  }
}

export class OutboxClaimError extends OutboxError {
  constructor(outboxEventId: string) {
    super(`Failed to acquire lock/lease on OutboxEvent (${outboxEventId})`, outboxEventId);
    this.name = "OutboxClaimError";
  }
}

export class OutboxMaxAttemptsError extends OutboxError {
  public readonly attempts: number;

  constructor(outboxEventId: string, attempts: number) {
    super(
      `OutboxEvent (${outboxEventId}) exceeded max delivery attempts (${attempts}) — moved to DEAD_LETTER`,
      outboxEventId,
    );
    this.name = "OutboxMaxAttemptsError";
    this.attempts = attempts;
  }
}
