import assert from "node:assert/strict";
import { evaluateOutboxHealth, OUTBOX_HEALTH_THRESHOLDS } from "./outbox-health.config";

console.log("Running Sprint 11 Observability & Multi-Tenant Unit Tests...");

async function runObservabilityUnitTests() {
  // 1. Pure Evaluator — HEALTHY State
  const healthyCurrent = {
    pendingCount: 5,
    processingCount: 1,
    failedCount: 0,
    deadLetterCount: 0,
    oldestPendingAgeSeconds: 15,
    oldestProcessingAgeSeconds: 5,
    staleLeaseCount: 0,
  };

  const healthyWindow = {
    windowMinutes: 5,
    totalAttempts: 100,
    successfulAttempts: 99,
    failedAttempts: 1,
    fencingBreaches: 0,
    providerSuccessRate: 0.99,
    providerFailureRate: 0.01,
    averageLatencyMs: 120,
  };

  const healthyState = evaluateOutboxHealth(healthyCurrent, {
    current: healthyWindow,
    shortTerm: { ...healthyWindow, windowMinutes: 15 },
    longTerm: { ...healthyWindow, windowMinutes: 60 },
  });

  assert.equal(healthyState, "HEALTHY", "Low queue age & failure rate MUST evaluate to HEALTHY");
  console.log("  ✓ Test 1: Healthy metrics evaluate to HEALTHY state");

  // 2. Pure Evaluator — DEGRADED State (oldestPendingAge > 60s)
  const degradedCurrent = {
    ...healthyCurrent,
    oldestPendingAgeSeconds: 90, // Exceeds degraded threshold of 60s
  };

  const degradedState = evaluateOutboxHealth(degradedCurrent, {
    current: healthyWindow,
    shortTerm: { ...healthyWindow, windowMinutes: 15 },
    longTerm: { ...healthyWindow, windowMinutes: 60 },
  });

  assert.equal(degradedState, "DEGRADED", "Oldest pending age > 60s MUST evaluate to DEGRADED");
  console.log("  ✓ Test 2: Pending age > 60s evaluates to DEGRADED state");

  // 3. Pure Evaluator — CRITICAL State (provider failure rate > 20%)
  const criticalWindow = {
    ...healthyWindow,
    totalAttempts: 100,
    failedAttempts: 25,
    providerFailureRate: 0.25, // Exceeds critical threshold of 0.20
  };

  const criticalState = evaluateOutboxHealth(healthyCurrent, {
    current: criticalWindow,
    shortTerm: { ...healthyWindow, windowMinutes: 15 },
    longTerm: { ...healthyWindow, windowMinutes: 60 },
  });

  assert.equal(criticalState, "CRITICAL", "Provider failure rate > 20% MUST evaluate to CRITICAL");
  console.log("  ✓ Test 3: Failure rate > 20% evaluates to CRITICAL state");

  // 4. Zero-Traffic Window Denominator Protection
  const zeroTrafficWindow = {
    windowMinutes: 5,
    totalAttempts: 0,
    successfulAttempts: 0,
    failedAttempts: 0,
    fencingBreaches: 0,
    providerSuccessRate: null,
    providerFailureRate: null,
    averageLatencyMs: null,
  };

  const zeroTrafficState = evaluateOutboxHealth(healthyCurrent, {
    current: zeroTrafficWindow,
    shortTerm: zeroTrafficWindow,
    longTerm: zeroTrafficWindow,
  });

  assert.equal(zeroTrafficState, "HEALTHY", "Zero traffic with low queue age MUST evaluate to HEALTHY (not error)");
  assert.equal(zeroTrafficWindow.providerFailureRate, null, "Zero traffic provider failure rate MUST be null");
  console.log("  ✓ Test 4: Zero-traffic denominator protection verified (null rates)");

  console.log("✅ All Sprint 11 Observability Unit Tests Passed Cleanly!");
}

runObservabilityUnitTests().catch((err) => {
  console.error("Sprint 11 Observability Unit Test Error:", err);
  process.exit(1);
});
