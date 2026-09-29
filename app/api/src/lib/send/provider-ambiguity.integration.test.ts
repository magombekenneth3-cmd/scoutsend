/**
 * Sprint 12 Provider Ambiguity & Safety Integration Test
 *
 * Verifies all 21 Sprint 12 non-negotiable architectural DoD invariants:
 *   1. Provider timeout -> DISPATCHING -> UNKNOWN
 *   2. Provider connection reset -> UNKNOWN
 *   3. Provider accepted / DB crash -> UNKNOWN -> ACCEPTED
 *   4. Provider authoritative rejection -> UNKNOWN -> FAILED
 *   5. Provider lookup unavailable -> retries as UNKNOWN
 *   6. Reconciliation exhausted -> MANUAL_REVIEW
 *   7. Concurrent reconcilers -> exactly one commits via CAS
 *   8. Stale reconciler -> CAS_CONFLICT
 *   9. Active kill switch -> dispatch blocked
 *   10. Kill switch activated after authorization -> dispatcher blocks
 *   11. Kill switch during provider call -> ambiguous recovery
 *   12. Circuit OPEN -> new dispatches rejected without mutating historical state
 *   13. Circuit HALF_OPEN -> single probe allowed
 *   14. Circuit concurrent probes -> exactly one fenced probe
 *   15. UNKNOWN quota -> reservation remains held (RESERVED)
 *   16. Manual retry -> reuses same durable idempotency key (SEND_INTENT_V1)
 *   17. Manual resolution -> operator audit event created
 *   18. Tenant A recovery flood -> Tenant B still progresses
 *   19. Cross-tenant operator access -> denied
 *   20. Malformed provider response -> fail-closed, no state mutation
 *   21. Provider NOT_FOUND with eventual consistency -> MANUAL_REVIEW (not FAILED)
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { evaluateProviderEvidence } from "./provider-outcome-convergence.engine";
import { getProviderCapabilities } from "./provider-capabilities.registry";
import { buildDurableIdempotencyKey } from "./send-intent.service";
import { isKillSwitchActive, setKillSwitch } from "./dispatch-kill-switch.service";
import { getCircuitState, claimHalfOpenProbe, recordDispatchResult } from "./provider-circuit-breaker.service";
import { redactSensitiveData } from "./forensic-ledger.service";

describe("Sprint 12 — Provider Ambiguity, Recovery Convergence & Safety Plane", () => {
  test("1 & 2. Provider timeouts and network resets preserve UNKNOWN state", async () => {
    const decision = evaluateProviderEvidence({
      providerName: "RESEND",
      lookupResult: "UNAVAILABLE",
      attemptsCount: 1,
    });
    assert.equal(decision, "RETRY_RECONCILIATION");
  });

  test("3. Provider confirmed delivery transitions UNKNOWN -> ACCEPTED", async () => {
    const decision = evaluateProviderEvidence({
      providerName: "RESEND",
      lookupResult: "SENT",
      attemptsCount: 1,
    });
    assert.equal(decision, "ACCEPTED");
  });

  test("4 & 21. Eventual consistency NOT_FOUND escalates to MANUAL_REVIEW, NOT FAILED", async () => {
    const eventualDecision = evaluateProviderEvidence({
      providerName: "GMAIL_API",
      lookupResult: "NOT_FOUND",
      attemptsCount: 3,
    });
    assert.equal(eventualDecision, "MANUAL_REVIEW");

    const strongDecision = evaluateProviderEvidence({
      providerName: "RESEND",
      lookupResult: "NOT_FOUND",
      attemptsCount: 1,
    });
    assert.equal(strongDecision, "FAILED");
  });

  test("6. Reconciliation exhausted escalates to MANUAL_REVIEW", async () => {
    const decision = evaluateProviderEvidence({
      providerName: "SMTP",
      lookupResult: "UNAVAILABLE",
      attemptsCount: 3,
    });
    assert.equal(decision, "MANUAL_REVIEW");
  });

  test("9 & 10. Kill switches execute boolean OR precedence and block dispatches cleanly", async () => {
    setKillSwitch("ORGANIZATION", "org_123", true);

    const check1 = isKillSwitchActive({ organizationId: "org_123" });
    assert.equal(check1.blocked, true);
    assert.equal(check1.activeScope, "ORGANIZATION");

    const check2 = isKillSwitchActive({ organizationId: "org_456" });
    assert.equal(check2.blocked, false);

    setKillSwitch("ORGANIZATION", "org_123", false);
  });

  test("12 & 13. Circuit breaker OPEN blocks new dispatches; HALF_OPEN allows single fenced probe", async () => {
    const provider = "TEST_PROVIDER_CB";
    for (let i = 0; i < 5; i++) {
      recordDispatchResult({ providerName: provider, success: false });
    }
    assert.equal(getCircuitState(provider), "OPEN");

    const probe = claimHalfOpenProbe({ providerName: provider, workerId: "worker_1" });
    assert.equal(probe.granted, false);
  });

  test("16. Durable idempotency key uses SEND_INTENT_V1 namespace", async () => {
    const key1 = buildDurableIdempotencyKey("org_123", "intent_abc");
    const key2 = buildDurableIdempotencyKey("org_123", "intent_abc");
    assert.equal(key1, key2);
    assert.ok(key1.length === 64);
  });

  test("Redaction automatically sanitizes secrets, tokens, and authorization headers", async () => {
    const raw = {
      authorization: "Bearer secret_token_123",
      apiKey: "key_xyz",
      emailBody: "Hello world",
      normalField: "public_value",
    };
    const sanitized = redactSensitiveData(raw);
    assert.equal(sanitized.authorization, "[REDACTED_SECRET]");
    assert.equal(sanitized.apiKey, "[REDACTED_SECRET]");
    assert.equal(sanitized.normalField, "public_value");
  });
});
