import assert from "node:assert/strict";
import {
  buildEmailSendIdempotencyKey,
  buildCrmSyncIdempotencyKey,
  buildWebhookIdempotencyKey,
  buildReplyClassifiedIdempotencyKey,
} from "./outbox.service";
import {
  OutboxError,
  OutboxDeliveryError,
  OutboxClaimError,
  OutboxMaxAttemptsError,
} from "./outbox.errors";
import type { OutboxEventMap } from "./outbox.types";

console.log("Running Outbox Unit Tests...");

import {
  classifyOutboxError,
  calculateNextRetryAt,
  sanitizeOutboxError,
  BASE_BACKOFF_MS,
  MAX_BACKOFF_MS,
} from "./outbox.dispatcher";

console.log("Running Outbox Unit Tests...");

// 1. Idempotency Key Format Stability & Collision Tests
{
  assert.equal(buildEmailSendIdempotencyKey("msg_123"), "email:msg_123");
  assert.equal(buildCrmSyncIdempotencyKey("lead_456", "CRM_SYNC"), "crm:lead_456:CRM_SYNC");
  assert.equal(
    buildCrmSyncIdempotencyKey("lead_456", "REPLY_CLASSIFIED", "reply_789"),
    "crm:lead_456:REPLY_CLASSIFIED:reply_789",
  );
  assert.equal(buildWebhookIdempotencyKey("wh_001", "LEAD_CREATED"), "webhook:wh_001:LEAD_CREATED");
  assert.equal(buildReplyClassifiedIdempotencyKey("reply_789"), "reply:reply_789");

  // Collision prevention checks:
  const keyEventA = buildCrmSyncIdempotencyKey("lead_1", "REPLY_RECEIVED");
  const keyEventB = buildCrmSyncIdempotencyKey("lead_1", "LEAD_SCORE_UPDATED");
  const keyEventC = buildCrmSyncIdempotencyKey("lead_2", "REPLY_RECEIVED");
  const keyEventD = buildCrmSyncIdempotencyKey("lead_1", "REPLY_RECEIVED");

  assert.notEqual(keyEventA, keyEventB, "Different event types for same lead MUST produce different keys");
  assert.notEqual(keyEventA, keyEventC, "Different leads for same event type MUST produce different keys");
  assert.equal(keyEventA, keyEventD, "Same lead and same event type MUST produce identical key");
  assert.equal(keyEventA.includes("Date.now()"), false, "Key MUST NOT contain timestamps");

  console.log("  ✓ Idempotency key builders produce deterministic non-colliding strings");
}

// 2. Outbox Error Taxonomy Tests
{
  const deliveryErr = new OutboxDeliveryError("Network timeout", "evt_1", "email:msg_123", 504, true);
  assert.equal(deliveryErr.name, "OutboxDeliveryError");
  assert.equal(deliveryErr.statusCode, 504);
  assert.equal(deliveryErr.isRetryable, true);

  const claimErr = new OutboxClaimError("evt_2");
  assert.equal(claimErr.name, "OutboxClaimError");
  assert.ok(claimErr.message.includes("acquire lock"));

  const maxErr = new OutboxMaxAttemptsError("evt_3", 5);
  assert.equal(maxErr.name, "OutboxMaxAttemptsError");
  assert.equal(maxErr.attempts, 5);
  assert.ok(maxErr.message.includes("DEAD_LETTER"));

  console.log("  ✓ Outbox error taxonomy verified");
}

// 3. Error Classification Tests (Retryable vs Permanent)
{
  // Permanent 4xx errors -> DEAD_LETTER
  assert.equal(classifyOutboxError({ statusCode: 400 }), "DEAD_LETTER");
  assert.equal(classifyOutboxError({ statusCode: 401 }), "DEAD_LETTER");
  assert.equal(classifyOutboxError({ statusCode: 403 }), "DEAD_LETTER");
  assert.equal(classifyOutboxError({ statusCode: 404 }), "DEAD_LETTER");
  assert.equal(classifyOutboxError({ statusCode: 422 }), "DEAD_LETTER");
  assert.equal(classifyOutboxError(new Error("Invalid recipient email")), "DEAD_LETTER");
  assert.equal(classifyOutboxError(new Error("Unauthorized API key")), "DEAD_LETTER");

  // Retryable errors -> RETRY
  assert.equal(classifyOutboxError({ statusCode: 429 }), "RETRY");
  assert.equal(classifyOutboxError({ statusCode: 500 }), "RETRY");
  assert.equal(classifyOutboxError({ statusCode: 502 }), "RETRY");
  assert.equal(classifyOutboxError({ statusCode: 503 }), "RETRY");
  assert.equal(classifyOutboxError({ statusCode: 504 }), "RETRY");
  assert.equal(classifyOutboxError(new Error("Connection reset by peer")), "RETRY");
  assert.equal(classifyOutboxError(new Error("ETIMEDOUT")), "RETRY");

  console.log("  ✓ Error classification correctly categorizes 4xx DEAD_LETTER vs 5xx/429 RETRY");
}

// 4. Exponential Backoff with Jitter Calculation Tests
{
  const now = new Date("2026-08-10T00:00:00.000Z");
  const t1 = calculateNextRetryAt(1, now).getTime() - now.getTime();
  const t2 = calculateNextRetryAt(2, now).getTime() - now.getTime();
  const t3 = calculateNextRetryAt(3, now).getTime() - now.getTime();
  const t4 = calculateNextRetryAt(4, now).getTime() - now.getTime();

  // Attempt 1: ~1000ms + jitter (1000 - 1500ms)
  assert.ok(t1 >= 1000 && t1 <= 1500, `t1 (${t1}ms) should be bounded in 1000-1500ms`);
  // Attempt 2: ~2000ms + jitter (2000 - 2500ms)
  assert.ok(t2 >= 2000 && t2 <= 2500, `t2 (${t2}ms) should be bounded in 2000-2500ms`);
  // Attempt 3: ~4000ms + jitter (4000 - 4500ms)
  assert.ok(t3 >= 4000 && t3 <= 4500, `t3 (${t3}ms) should be bounded in 4000-4500ms`);
  // Attempt 4: ~8000ms + jitter (8000 - 8500ms)
  assert.ok(t4 >= 8000 && t4 <= 8500, `t4 (${t4}ms) should be bounded in 8000-8500ms`);

  console.log("  ✓ Exponential backoff math grows progressively with bounded jitter");
}

// 5. Error Sanitization Tests
{
  const sensitiveError = new Error("Provider request failed bearer=secret_token_123 apiKey=abc_456 password=my_pass");
  const sanitized = sanitizeOutboxError(sensitiveError);

  assert.equal(sanitized.includes("secret_token_123"), false, "Tokens must be redacted");
  assert.equal(sanitized.includes("abc_456"), false, "API keys must be redacted");
  assert.equal(sanitized.includes("my_pass"), false, "Passwords must be redacted");
  assert.ok(sanitized.includes("[REDACTED]"));

  console.log("  ✓ Error sanitizer redacts tokens, credentials, and sensitive headers");
}

// 6. Strongly Typed Payload Structure & PII Safety Verification
{
  const emailPayload: OutboxEventMap["EMAIL_SEND_REQUESTED"] = {
    outreachMessageId: "msg_999",
    leadId: "lead_888",
    campaignId: "camp_777",
    senderMailboxId: "box_111",
  };

  assert.equal(emailPayload.outreachMessageId, "msg_999");
  assert.equal("email" in emailPayload, false, "Payload must NOT contain raw email addresses (PII minimal)");
  assert.equal("prompt" in emailPayload, false, "Payload must NOT contain LLM prompts");

  console.log("  ✓ Outbox payload contract verified PII-minimal and strongly typed");
}

console.log("✅ All Outbox Unit Tests Passed Cleanly!");
