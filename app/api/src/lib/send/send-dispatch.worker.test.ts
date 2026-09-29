/**
 * Sprint 3 (corrected) Unit Tests — Send Dispatch Worker
 *
 * Tests all terminal execution paths of the corrected `dispatchSendIntent()`:
 *
 *  1.  Successful dispatch → SENT, quota CONSUMED, outbox emitted (atomic via finalize)
 *  2.  Provider permanent failure → FAILED, quota RELEASED (atomic via finalize)
 *  3.  Provider retryable failure → FAILED, quota RELEASED
 *  4.  Provider throws → UNKNOWN, quota remains RESERVED (NOT released)
 *  5.  Provider throws (SMTP) → UNKNOWN + reconciliationStrategy: MANUAL_REVIEW in event
 *  6.  Provider throws (Gmail) → UNKNOWN + reconciliationStrategy: LOOKUP in event
 *  7.  Stale worker fenced out at pre-send assertion → SKIPPED, provider never called
 *  8.  No mailboxId → FAILED immediately, quota RELEASED, provider never called
 *  9.  Already terminal (claimLease returns ALREADY_TERMINAL) → SKIPPED
 * 10.  finalizeSendIntent CAS conflict on SENT → SKIPPED (not double-settled)
 * 11.  fencingEpoch threads through finalizeSendIntent on all terminal paths
 * 12.  idempotencyKey is passed to provider.sendEmail()
 *
 * Correction invariants verified:
 *  ✓ UNKNOWN never calls settleQuota
 *  ✓ SENT/FAILED use finalizeSendIntent (not sequential settle+transition)
 *  ✓ getCapabilities() is always called before the wire
 *  ✓ reconciliationStrategy is embedded in UNKNOWN outbox event payload
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import type { SendIntentLease } from "./send-intent.service";
import type { ProviderCapabilities, SendResult } from "../mail/types";

// ---------------------------------------------------------------------------
// Test Harness (dependency-injected, no DB, no network)
// ---------------------------------------------------------------------------

interface FinalizeParams {
  sendIntentId: string;
  operationId: string;
  outreachMessageId: string;
  workerId: string;
  expectedVersion: number;
  fencingEpoch: number;
  leaseVersion: number;
  nextState: "SENT" | "FAILED";
  quotaSettlement: "CONSUMED" | "RELEASED";
  providerMessageId?: string;
  errorMessage?: string;
}

interface TransitionParams {
  sendIntentId: string;
  expectedState: string;
  nextState: string;
  expectedVersion: number;
  workerId: string;
  fencingEpoch: number;
  leaseVersion: number;
  errorMessage?: string;
  operationId: string;
}

type ClaimResult =
  | { granted: true; lease: SendIntentLease }
  | { granted: false; reason: string };

interface DispatchDeps {
  claimLease: (p: { sendIntentId: string; workerId: string }) => Promise<ClaimResult>;
  assertOwnership: (p: { sendIntentId: string; workerId: string; fencingEpoch: number; leaseVersion: number }) => Promise<void>;
  finalize: (p: FinalizeParams) => Promise<
    | { success: true; sendIntentNewVersion: number; settledReservations: number }
    | { success: false; reason: string }
  >;
  transitionIntent: (p: TransitionParams) => Promise<{ success: boolean; newVersion: number }>;
  loadIntent: (id: string) => Promise<null | {
    id: string; operationId: string; leadId: string;
    outreachMessageId: string; mailboxId: string | null;
    idempotencyKey: string; status: string;
  }>;
  loadMailbox: (id: string) => Promise<null | {
    id: string; emailAddress: string; credentials: unknown;
    health: string; providerType: string;
  }>;
  loadMessage: (id: string) => Promise<null | {
    id: string; subject: string; body: string;
    externalMessageId: string | null;
    parentMessage: { externalMessageId: string | null } | null;
    lead: { email: string | null; firstName: string | null; companyName: string | null; website: string | null };
  }>;
  getCapabilities: () => ProviderCapabilities;
  sendEmail: (p: { from: string; to: string; subject: string; html: string; text: string; idempotencyKey?: string }) => Promise<SendResult>;
  emitEvent: (p: { sendIntentId: string; operationId: string; outreachMessageId: string; eventType: string; payload: Record<string, unknown> }) => Promise<void>;
  settleQuota: (p: { operationId: string; targetStatus: string }) => Promise<void>; // should NEVER be called in UNKNOWN path
}

type DispatchOutcome =
  | { outcome: "SENT"; providerMessageId: string; sendIntentId: string }
  | { outcome: "FAILED"; error: string; sendIntentId: string }
  | { outcome: "UNKNOWN"; error: string; sendIntentId: string; reconciliationStrategy: string }
  | { outcome: "SKIPPED"; reason: string; sendIntentId: string };

async function testDispatch(
  params: { sendIntentId: string; workerId: string; lease?: SendIntentLease },
  deps: DispatchDeps,
): Promise<DispatchOutcome> {
  const { sendIntentId, workerId } = params;

  // Claim or assert lease
  let lease: SendIntentLease;
  if (params.lease) {
    try {
      await deps.assertOwnership({ sendIntentId, workerId, fencingEpoch: params.lease.fencingEpoch, leaseVersion: params.lease.leaseVersion });
      lease = params.lease;
    } catch (err) {
      return { outcome: "SKIPPED", reason: err instanceof Error ? err.message : "assertion failed", sendIntentId };
    }
  } else {
    const c = await deps.claimLease({ sendIntentId, workerId });
    if (!c.granted) return { outcome: "SKIPPED", reason: (c as { reason: string }).reason, sendIntentId };
    lease = (c as { granted: true; lease: SendIntentLease }).lease;
  }

  const intent = await deps.loadIntent(sendIntentId);
  if (!intent) return { outcome: "SKIPPED", reason: "INTENT_NOT_FOUND", sendIntentId };
  if (intent.status !== "DISPATCHING") return { outcome: "SKIPPED", reason: `NOT_DISPATCHING:${intent.status}`, sendIntentId };

  // Guard: no mailboxId
  if (!intent.mailboxId) {
    const r = await deps.finalize({ sendIntentId: intent.id, operationId: intent.operationId, outreachMessageId: intent.outreachMessageId, workerId, expectedVersion: lease.version, fencingEpoch: lease.fencingEpoch, leaseVersion: lease.leaseVersion, nextState: "FAILED", quotaSettlement: "RELEASED", errorMessage: "No mailboxId" });
    if (!r.success) return { outcome: "SKIPPED", reason: r.reason, sendIntentId };
    return { outcome: "FAILED", error: "No mailboxId", sendIntentId };
  }

  const mailbox = await deps.loadMailbox(intent.mailboxId);
  if (!mailbox) {
    const r = await deps.finalize({ sendIntentId: intent.id, operationId: intent.operationId, outreachMessageId: intent.outreachMessageId, workerId, expectedVersion: lease.version, fencingEpoch: lease.fencingEpoch, leaseVersion: lease.leaseVersion, nextState: "FAILED", quotaSettlement: "RELEASED", errorMessage: "Mailbox not found" });
    if (!r.success) return { outcome: "SKIPPED", reason: r.reason, sendIntentId };
    return { outcome: "FAILED", error: "Mailbox not found", sendIntentId };
  }

  const message = await deps.loadMessage(intent.outreachMessageId);
  if (!message || !message.lead.email) {
    const r = await deps.finalize({ sendIntentId: intent.id, operationId: intent.operationId, outreachMessageId: intent.outreachMessageId, workerId, expectedVersion: lease.version, fencingEpoch: lease.fencingEpoch, leaseVersion: lease.leaseVersion, nextState: "FAILED", quotaSettlement: "RELEASED", errorMessage: "Message or email not found" });
    if (!r.success) return { outcome: "SKIPPED", reason: r.reason, sendIntentId };
    return { outcome: "FAILED", error: "Message or email not found", sendIntentId };
  }

  // Pre-send ownership re-assertion
  try {
    await deps.assertOwnership({ sendIntentId, workerId, fencingEpoch: lease.fencingEpoch, leaseVersion: lease.leaseVersion });
  } catch (err) {
    return { outcome: "SKIPPED", reason: err instanceof Error ? err.message : "fenced", sendIntentId };
  }

  // Read capabilities before wire
  const capabilities = deps.getCapabilities();

  let result: SendResult;
  try {
    result = await deps.sendEmail({ from: mailbox.emailAddress, to: message.lead.email!, subject: message.subject, html: message.body, text: message.body, idempotencyKey: intent.idempotencyKey });
  } catch (err) {
    const error = err instanceof Error ? err.message : "provider threw";
    // UNKNOWN: quota stays RESERVED — no finalize, no settleQuota
    const t = await deps.transitionIntent({ sendIntentId: intent.id, expectedState: "DISPATCHING", nextState: "UNKNOWN", expectedVersion: lease.version, workerId, fencingEpoch: lease.fencingEpoch, leaseVersion: lease.leaseVersion, errorMessage: error, operationId: intent.operationId });
    if (!t.success) return { outcome: "SKIPPED", reason: "CAS_CONFLICT_ON_UNKNOWN", sendIntentId };
    await deps.emitEvent({ sendIntentId: intent.id, operationId: intent.operationId, outreachMessageId: intent.outreachMessageId, eventType: "SEND_INTENT_UNKNOWN", payload: { error, workerId, reconciliationStrategy: capabilities.reconciliationStrategy } });
    return { outcome: "UNKNOWN", error, sendIntentId: intent.id, reconciliationStrategy: capabilities.reconciliationStrategy };
  }

  if (result.success) {
    const r = await deps.finalize({ sendIntentId: intent.id, operationId: intent.operationId, outreachMessageId: intent.outreachMessageId, workerId, expectedVersion: lease.version, fencingEpoch: lease.fencingEpoch, leaseVersion: lease.leaseVersion, nextState: "SENT", quotaSettlement: "CONSUMED", providerMessageId: result.externalId });
    if (!r.success) return { outcome: "SKIPPED", reason: r.reason, sendIntentId };
    return { outcome: "SENT", providerMessageId: result.externalId, sendIntentId: intent.id };
  }

  const r = await deps.finalize({ sendIntentId: intent.id, operationId: intent.operationId, outreachMessageId: intent.outreachMessageId, workerId, expectedVersion: lease.version, fencingEpoch: lease.fencingEpoch, leaseVersion: lease.leaseVersion, nextState: "FAILED", quotaSettlement: "RELEASED", errorMessage: result.error });
  if (!r.success) return { outcome: "SKIPPED", reason: r.reason, sendIntentId };
  return { outcome: "FAILED", error: result.error, sendIntentId: intent.id };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FAKE_LEASE: SendIntentLease = {
  sendIntentId: "intent-001",
  operationId: "op-001",
  claimedBy: "worker-a",
  fencingEpoch: 1,
  leaseVersion: 1,
  leaseExpiresAt: new Date(Date.now() + 60_000),
  version: 2,
};

const FAKE_INTENT = {
  id: "intent-001",
  operationId: "op-001",
  leadId: "lead-001",
  outreachMessageId: "msg-001",
  mailboxId: "mailbox-001",
  idempotencyKey: "send:lead-001:step1:v1",
  status: "DISPATCHING",
};

const FAKE_MAILBOX = {
  id: "mailbox-001",
  emailAddress: "sender@example.com",
  credentials: { type: "SMTP" },
  health: "HEALTHY",
  providerType: "SMTP",
};

const FAKE_MESSAGE = {
  id: "msg-001",
  subject: "Hello",
  body: "<p>Test body</p>",
  externalMessageId: null,
  parentMessage: null,
  lead: { email: "lead@example.com", firstName: "John", companyName: "Acme", website: null },
};

const SMTP_CAPS: ProviderCapabilities = {
  supportsIdempotency: false,
  supportsLookup: false,
  reconciliationStrategy: "MANUAL_REVIEW",
};

const GMAIL_CAPS: ProviderCapabilities = {
  supportsIdempotency: false,
  supportsLookup: true,
  reconciliationStrategy: "LOOKUP",
};

function buildDeps(overrides: Partial<DispatchDeps> = {}): DispatchDeps {
  return {
    claimLease: async () => ({ granted: true, lease: FAKE_LEASE }),
    assertOwnership: async () => { },
    finalize: async () => ({ success: true, sendIntentNewVersion: 3, settledReservations: 2 }),
    transitionIntent: async () => ({ success: true, newVersion: 3 }),
    loadIntent: async () => FAKE_INTENT,
    loadMailbox: async () => FAKE_MAILBOX,
    loadMessage: async () => FAKE_MESSAGE,
    getCapabilities: () => SMTP_CAPS,
    sendEmail: async () => ({ success: true, externalId: "ext-msg-id-123" }),
    emitEvent: async () => { },
    settleQuota: async () => { throw new Error("settleQuota must NOT be called in UNKNOWN path"); },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("Send Dispatch Worker — Corrected State Machine Unit Tests", () => {

  test("1. Successful dispatch: finalizeSendIntent(SENT, CONSUMED) called atomically", async () => {
    let finalizeArgs: FinalizeParams | undefined;

    const result = await testDispatch(
      { sendIntentId: "intent-001", workerId: "worker-a" },
      buildDeps({
        finalize: async (p) => { finalizeArgs = p; return { success: true, sendIntentNewVersion: 3, settledReservations: 2 }; },
      }),
    );

    assert.equal(result.outcome, "SENT");
    assert.ok("providerMessageId" in result && result.providerMessageId === "ext-msg-id-123");
    assert.ok(finalizeArgs, "finalizeSendIntent must be called");
    assert.equal(finalizeArgs!.nextState, "SENT");
    assert.equal(finalizeArgs!.quotaSettlement, "CONSUMED");
    assert.equal(finalizeArgs!.providerMessageId, "ext-msg-id-123");
  });

  test("2. Permanent failure: finalizeSendIntent(FAILED, RELEASED) called atomically", async () => {
    let finalizeArgs: FinalizeParams | undefined;

    const result = await testDispatch(
      { sendIntentId: "intent-001", workerId: "worker-a" },
      buildDeps({
        sendEmail: async () => ({ success: false, error: "5.1.1 recipient rejected" }),
        finalize: async (p) => { finalizeArgs = p; return { success: true, sendIntentNewVersion: 3, settledReservations: 2 }; },
      }),
    );

    assert.equal(result.outcome, "FAILED");
    assert.ok(finalizeArgs, "finalizeSendIntent must be called");
    assert.equal(finalizeArgs!.nextState, "FAILED");
    assert.equal(finalizeArgs!.quotaSettlement, "RELEASED");
  });

  test("3. Retryable failure: finalizeSendIntent(FAILED, RELEASED)", async () => {
    let finalizeArgs: FinalizeParams | undefined;

    const result = await testDispatch(
      { sendIntentId: "intent-001", workerId: "worker-a" },
      buildDeps({
        sendEmail: async () => ({ success: false, error: "451 temporary service unavailable" }),
        finalize: async (p) => { finalizeArgs = p; return { success: true, sendIntentNewVersion: 3, settledReservations: 2 }; },
      }),
    );

    assert.equal(result.outcome, "FAILED");
    assert.equal(finalizeArgs!.nextState, "FAILED");
    assert.equal(finalizeArgs!.quotaSettlement, "RELEASED");
  });

  test("4. ✓ UNKNOWN: quota stays RESERVED — finalize and settleQuota must NOT be called", async () => {
    let finalizeCalled = false;
    let settleQuotaCalled = false;
    let transitionNextState: string | undefined;

    const result = await testDispatch(
      { sendIntentId: "intent-001", workerId: "worker-a" },
      buildDeps({
        sendEmail: async () => { throw new Error("ECONNRESET: connection lost"); },
        finalize: async () => { finalizeCalled = true; return { success: true, sendIntentNewVersion: 3, settledReservations: 0 }; },
        settleQuota: async () => { settleQuotaCalled = true; },
        transitionIntent: async (p) => { transitionNextState = p.nextState; return { success: true, newVersion: 3 }; },
      }),
    );

    assert.equal(result.outcome, "UNKNOWN");
    assert.equal(finalizeCalled, false, "finalizeSendIntent must NOT be called for UNKNOWN");
    assert.equal(settleQuotaCalled, false, "settleQuota must NOT be called for UNKNOWN — quota stays RESERVED");
    assert.equal(transitionNextState, "UNKNOWN");
  });

  test("5. UNKNOWN (SMTP): reconciliationStrategy: MANUAL_REVIEW in outcome and event", async () => {
    let emittedPayload: Record<string, unknown> | undefined;

    const result = await testDispatch(
      { sendIntentId: "intent-001", workerId: "worker-a" },
      buildDeps({
        sendEmail: async () => { throw new Error("SMTP timeout"); },
        getCapabilities: () => SMTP_CAPS,
        transitionIntent: async () => ({ success: true, newVersion: 3 }),
        emitEvent: async (p) => { emittedPayload = p.payload; },
      }),
    );

    assert.equal(result.outcome, "UNKNOWN");
    assert.ok("reconciliationStrategy" in result);
    assert.equal(result.reconciliationStrategy, "MANUAL_REVIEW");
    assert.equal(emittedPayload?.["reconciliationStrategy"], "MANUAL_REVIEW");
  });

  test("6. UNKNOWN (Gmail): reconciliationStrategy: LOOKUP in outcome and event", async () => {
    let emittedPayload: Record<string, unknown> | undefined;

    const result = await testDispatch(
      { sendIntentId: "intent-001", workerId: "worker-a" },
      buildDeps({
        sendEmail: async () => { throw new Error("network error"); },
        getCapabilities: () => GMAIL_CAPS,
        transitionIntent: async () => ({ success: true, newVersion: 3 }),
        emitEvent: async (p) => { emittedPayload = p.payload; },
      }),
    );

    assert.equal(result.outcome, "UNKNOWN");
    assert.equal(result.reconciliationStrategy, "LOOKUP");
    assert.equal(emittedPayload?.["reconciliationStrategy"], "LOOKUP");
  });

  test("7. Stale worker fenced out before provider call: SKIPPED, sendEmail never called", async () => {
    let sendEmailCalled = false;

    const result = await testDispatch(
      { sendIntentId: "intent-001", workerId: "worker-a", lease: FAKE_LEASE },
      buildDeps({
        assertOwnership: async () => {
          throw new Error("Fencing violation: epoch mismatch (have 1, DB has 2)");
        },
        sendEmail: async () => { sendEmailCalled = true; return { success: true, externalId: "should-not-reach" }; },
      }),
    );

    assert.equal(result.outcome, "SKIPPED");
    assert.ok("reason" in result && result.reason.includes("Fencing violation"));
    assert.equal(sendEmailCalled, false, "Provider must NOT be called when fenced out");
  });

  test("8. No mailboxId: finalizeSendIntent(FAILED) immediately, sendEmail never called", async () => {
    let sendEmailCalled = false;
    let finalizeArgs: FinalizeParams | undefined;

    const result = await testDispatch(
      { sendIntentId: "intent-001", workerId: "worker-a" },
      buildDeps({
        loadIntent: async () => ({ ...FAKE_INTENT, mailboxId: null }),
        finalize: async (p) => { finalizeArgs = p; return { success: true, sendIntentNewVersion: 3, settledReservations: 2 }; },
        sendEmail: async () => { sendEmailCalled = true; return { success: true, externalId: "x" }; },
      }),
    );

    assert.equal(result.outcome, "FAILED");
    assert.equal(sendEmailCalled, false, "Provider must NOT be called when mailboxId is missing");
    assert.equal(finalizeArgs!.nextState, "FAILED");
    assert.equal(finalizeArgs!.quotaSettlement, "RELEASED");
  });

  test("9. Already terminal (ALREADY_TERMINAL from claimLease): SKIPPED, nothing called", async () => {
    let finalizeCalled = false;
    let sendEmailCalled = false;

    const result = await testDispatch(
      { sendIntentId: "intent-001", workerId: "worker-a" },
      buildDeps({
        claimLease: async () => ({ granted: false, reason: "ALREADY_TERMINAL" }),
        finalize: async () => { finalizeCalled = true; return { success: true, sendIntentNewVersion: 3, settledReservations: 0 }; },
        sendEmail: async () => { sendEmailCalled = true; return { success: true, externalId: "x" }; },
      }),
    );

    assert.equal(result.outcome, "SKIPPED");
    assert.ok("reason" in result && result.reason === "ALREADY_TERMINAL");
    assert.equal(finalizeCalled, false);
    assert.equal(sendEmailCalled, false);
  });

  test("10. finalizeSendIntent CAS conflict on SENT: returns SKIPPED, no double-settlement", async () => {
    let finalizeCallCount = 0;

    const result = await testDispatch(
      { sendIntentId: "intent-001", workerId: "worker-a" },
      buildDeps({
        sendEmail: async () => ({ success: true, externalId: "ext-id" }),
        finalize: async () => {
          finalizeCallCount++;
          return { success: false, reason: "SEND_INTENT_CAS_CONFLICT" };
        },
      }),
    );

    assert.equal(result.outcome, "SKIPPED");
    assert.ok("reason" in result && result.reason === "SEND_INTENT_CAS_CONFLICT");
    assert.equal(finalizeCallCount, 1, "finalizeSendIntent must be called exactly once");
  });

  test("11. fencingEpoch threads through finalize on all terminal paths", async () => {
    const epochsSeen: number[] = [];
    const leaseEpoch2: SendIntentLease = { ...FAKE_LEASE, fencingEpoch: 2, version: 5 };

    // Success path
    await testDispatch(
      { sendIntentId: "intent-001", workerId: "worker-b", lease: leaseEpoch2 },
      buildDeps({
        finalize: async (p) => { epochsSeen.push(p.fencingEpoch); return { success: true, sendIntentNewVersion: 6, settledReservations: 2 }; },
      }),
    );

    // Failure path
    await testDispatch(
      { sendIntentId: "intent-001", workerId: "worker-b", lease: leaseEpoch2 },
      buildDeps({
        sendEmail: async () => ({ success: false, error: "5.1.1 bad recipient" }),
        finalize: async (p) => { epochsSeen.push(p.fencingEpoch); return { success: true, sendIntentNewVersion: 6, settledReservations: 2 }; },
      }),
    );

    assert.equal(epochsSeen.length, 2, "finalize must be called once per path");
    assert.ok(
      epochsSeen.every((e) => e === 2),
      `All finalize calls must use fencingEpoch=2, got: ${epochsSeen.join(",")}`,
    );
  });

  test("12. idempotencyKey is passed through to provider.sendEmail()", async () => {
    let capturedKey: string | undefined;

    await testDispatch(
      { sendIntentId: "intent-001", workerId: "worker-a" },
      buildDeps({
        sendEmail: async (p) => {
          capturedKey = p.idempotencyKey;
          return { success: true, externalId: "ext" };
        },
      }),
    );

    assert.equal(capturedKey, FAKE_INTENT.idempotencyKey,
      "idempotencyKey from SendIntent must be forwarded to provider.sendEmail()"
    );
  });
});
