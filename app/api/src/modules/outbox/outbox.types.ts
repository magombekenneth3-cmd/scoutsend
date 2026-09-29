/**
 * Sprint 9 — Outbox Event Contract & Strongly-Typed Payload Definitions
 *
 * KEY INVARIANTS:
 * 1. Zero `any` types — strict type checking across all event payloads.
 * 2. PII-minimal payloads — no full email contents, prompts, credentials, or secrets stored in payload JSON.
 * 3. Idempotency Key binding — deterministic string format per event type.
 */

export interface EmailSendRequestedPayload {
  readonly outreachMessageId: string;
  readonly leadId: string;
  readonly campaignId: string;
  readonly senderMailboxId?: string;
}

export interface CrmSyncRequestedPayload {
  readonly leadId: string;
  readonly replyId?: string;
  readonly intent?: string;
  readonly campaignId?: string;
}

export interface WebhookRequestedPayload {
  readonly webhookId: string;
  readonly eventName: string;
  readonly aggregateId: string;
}

export interface ReplyIntentClassifiedPayload {
  readonly replyId: string;
  readonly leadId: string;
  readonly intent: string;
  readonly confidence: number;
}

export interface OutboxEventMap {
  EMAIL_SEND_REQUESTED: EmailSendRequestedPayload;
  CRM_SYNC_REQUESTED: CrmSyncRequestedPayload;
  WEBHOOK_REQUESTED: WebhookRequestedPayload;
  REPLY_INTENT_CLASSIFIED: ReplyIntentClassifiedPayload;
}

export type OutboxEventType = keyof OutboxEventMap;

export type OutboxStatus = "PENDING" | "PROCESSING" | "PUBLISHED" | "SUCCEEDED" | "FAILED" | "DEAD_LETTER";

export interface CreateOutboxEventParams<K extends OutboxEventType> {
  readonly organizationId: string;
  readonly eventType: K;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly idempotencyKey: string;
  readonly payload: OutboxEventMap[K];
  readonly correlationId?: string;
  readonly aggregateVersion?: number;
  readonly operationId?: string;
}
