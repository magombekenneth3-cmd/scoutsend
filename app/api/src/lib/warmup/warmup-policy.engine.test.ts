/**
 * Exhaustive unit tests for the warmup pure policy engine (v7).
 *
 * Runner: node:test (project standard — `pnpm test` / `node --import tsx --test`)
 * Pure unit tests — no network, no DB, no Redis.
 *
 * Coverage:
 *   Ramp interpolation (monotonicity, checkpoints, bounds)
 *   INV-1:   safeBaseLimit = min(baseDailyLimit, warmupSafeDailyLimit)
 *   INV-8:   cooldownTarget = floor(currentLimit × multiplier)
 *   INV-9:   Critical before sample gate
 *   INV-11:  Engine input is EvaluatableWarmupState (NOT_STARTED/PAUSED compile-rejected)
 *   INV-12:  PAUSE preserves dailyLimit (effectiveLimit = currentLimit, never 0)
 *   INV-13:  Decision includes policyVersion, inputHash, scope
 *   Rule #1-#11: Action precedence table
 *   Boundary-exact threshold tests (Finding 9)
 *   Counter semantics
 *   Multi-provider cooldown
 *   Scope parity (mailbox === domain for same inputs)
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  computeWarmupDecision,
  computeRampTarget,
  assessHealth,
  WARMUP_POLICY_VERSION,
} from "./warmup-policy.engine.js";

import type {
  WarmupPolicyInput,
  WarmupMetrics,
  SenderProviderPolicy,
  PlacementProviderPolicy,
  PlacementProvider,
  EvaluatableWarmupState,
} from "./warmup-types.js";

import {
  MIN_SAMPLE_SIZE,
  BOUNCE_DEGRADED_THRESHOLD,
  BOUNCE_CRITICAL_THRESHOLD,
  COMPLAINT_DEGRADED_THRESHOLD,
  COMPLAINT_CRITICAL_THRESHOLD,
} from "./warmup-types.js";

// Utility: strip readonly for test fixtures that need mutation
type Mutable<T> = { -readonly [P in keyof T]: T[P] };

// ─── Fixtures ────────────────────────────────────────────────────────────────

function cleanMetrics(): Mutable<WarmupMetrics> {
  return {
    sent24h: 20,
    bounces24h: 0,
    complaints24h: 0,
    seedInteractions24h: 20,
    seedSpamLandings24h: 0,
    blockEvents24h: 0,
    googleSeedInteractions24h: 10,
    googleSeedSpamLandings24h: 0,
    msSeedInteractions24h: 10,
    msSeedSpamLandings24h: 0,
    sent7d: 100,
    bounces7d: 0,
    complaints7d: 0,
    seedInteractions7d: 100,
    seedSpamLandings7d: 0,
    googleSeedInteractions7d: 50,
    googleSeedSpamLandings7d: 0,
    msSeedInteractions7d: 50,
    msSeedSpamLandings7d: 0,
    sentLifetime: 200,
    bouncesLifetime: 0,
  };
}

const DEFAULT_SENDER_POLICY: SenderProviderPolicy = {
  warmupSafeDailyLimit: 40,
  minObservationPeriodDays: 3,
};

const DEFAULT_PLACEMENT_POLICIES: Record<PlacementProvider, PlacementProviderPolicy> = {
  GOOGLE: {
    spamThreshold: 0.08,
    cooldownMultiplier: 0.75,
    degradedThreshold: 2,
    recoveryThreshold: 3,
  },
  MICROSOFT: {
    spamThreshold: 0.08,
    cooldownMultiplier: 0.8,
    degradedThreshold: 2,
    recoveryThreshold: 3,
  },
};

function makeInput(overrides: Partial<WarmupPolicyInput> = {}): WarmupPolicyInput {
  return {
    scope: "mailbox",
    warmupDay: 7,
    currentState: "RAMPING",
    currentDailyLimit: 15,
    baseDailyLimit: 500,
    consecutiveHealthyEvals: 0,
    consecutiveDegradedEvals: 0,
    metrics: cleanMetrics(),
    senderPolicy: DEFAULT_SENDER_POLICY,
    placementPolicies: DEFAULT_PLACEMENT_POLICIES,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Ramp Curve
// ═══════════════════════════════════════════════════════════════════════════════

test("ramp · returns minimum for day 0", () => {
  assert.equal(computeRampTarget(0, 40), 2);
});

test("ramp · returns safeBaseLimit for day 28", () => {
  assert.equal(computeRampTarget(28, 40), 40);
});

test("ramp · returns safeBaseLimit for day 30+", () => {
  assert.equal(computeRampTarget(30, 40), 40);
});

test("ramp · returns 1 for zero safeBaseLimit", () => {
  assert.equal(computeRampTarget(5, 0), 1);
});

test("ramp · interpolates linearly between day 7 (38%) and day 14 (60%)", () => {
  assert.equal(computeRampTarget(8, 40), 16);
  assert.equal(computeRampTarget(10, 40), 19);
});

test("ramp · never exceeds safeBaseLimit", () => {
  for (let day = 0; day <= 30; day++) {
    assert.ok(computeRampTarget(day, 40) <= 40, `Day ${day} exceeded 40`);
  }
});

test("ramp · monotonically non-decreasing", () => {
  let prev = 0;
  for (let day = 0; day <= 28; day++) {
    const t = computeRampTarget(day, 40);
    assert.ok(t >= prev, `Day ${day}: ${t} < prev ${prev}`);
    prev = t;
  }
});

test("ramp · exact checkpoint values on checkpoint days", () => {
  assert.equal(computeRampTarget(1, 40), 2);
  assert.equal(computeRampTarget(7, 40), 15);
  assert.equal(computeRampTarget(28, 40), 40);
});

// ═══════════════════════════════════════════════════════════════════════════════
// INV-1: safeBaseLimit
// ═══════════════════════════════════════════════════════════════════════════════

test("INV-1 · caps ramp at warmupSafeDailyLimit when baseDailyLimit is higher", () => {
  const decision = computeWarmupDecision(makeInput({
    baseDailyLimit: 500, warmupDay: 28, currentState: "RAMPING", currentDailyLimit: 38,
  }));
  assert.ok(decision.effectiveLimit <= 40);
});

test("INV-1 · uses baseDailyLimit when lower than warmupSafeDailyLimit", () => {
  const decision = computeWarmupDecision(makeInput({
    baseDailyLimit: 30, warmupDay: 28, currentState: "RAMPING", currentDailyLimit: 28,
    senderPolicy: { warmupSafeDailyLimit: 40, minObservationPeriodDays: 3 },
  }));
  assert.ok(decision.effectiveLimit <= 30);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Rule #1: CRITICAL before sample gate (INV-9)
// ═══════════════════════════════════════════════════════════════════════════════

test("Rule #1 · block event with sent24h=3 → PAUSE (critical before sample gate)", () => {
  const m = cleanMetrics();
  m.sent24h = 3;
  m.blockEvents24h = 1;

  const d = computeWarmupDecision(makeInput({ metrics: m }));
  assert.equal(d.action, "PAUSE");
  assert.equal(d.nextState, "PAUSED");
  assert.ok(d.reasons.some((r) => r.code === "BLOCK_EVENTS_CRITICAL"));
});

test("Rule #1 · extreme bounce (≥5%) → PAUSE", () => {
  const m = cleanMetrics();
  m.sent24h = 20;
  m.bounces24h = 1;

  const d = computeWarmupDecision(makeInput({ metrics: m }));
  assert.equal(d.action, "PAUSE");
  assert.equal(d.nextState, "PAUSED");
});

test("Rule #1 · extreme Google spam (≥2× threshold) → PAUSE", () => {
  const m = cleanMetrics();
  m.googleSeedInteractions24h = 10;
  m.googleSeedSpamLandings24h = 2;

  const d = computeWarmupDecision(makeInput({ metrics: m }));
  assert.equal(d.action, "PAUSE");
  assert.ok(d.reasons.some((r) => r.code === "GOOGLE_SPAM_CRITICAL"));
});

// ═══════════════════════════════════════════════════════════════════════════════
// INV-12: PAUSE preserves dailyLimit (effectiveLimit = currentLimit, never 0)
// ═══════════════════════════════════════════════════════════════════════════════

test("INV-12 · PAUSE effectiveLimit equals currentDailyLimit (not 0)", () => {
  const m = cleanMetrics();
  m.blockEvents24h = 1;

  const d = computeWarmupDecision(makeInput({ metrics: m, currentDailyLimit: 35 }));
  assert.equal(d.action, "PAUSE");
  assert.equal(d.effectiveLimit, 35);
  assert.notEqual(d.effectiveLimit, 0);
});

test("INV-12 · PAUSE from 7d critical also preserves limit", () => {
  const m = cleanMetrics();
  m.bounces7d = 5; // 5/100 = 5% CRITICAL

  const d = computeWarmupDecision(makeInput({ metrics: m, currentDailyLimit: 25 }));
  assert.equal(d.action, "PAUSE");
  assert.equal(d.effectiveLimit, 25);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Rule #2: Insufficient sample
// ═══════════════════════════════════════════════════════════════════════════════

test("Rule #2 · holds when sent24h < MIN_SAMPLE_SIZE", () => {
  const m = cleanMetrics();
  m.sent24h = 5;

  const d = computeWarmupDecision(makeInput({ metrics: m }));
  assert.equal(d.action, "HOLD");
  assert.equal(d.insufficientData, true);
  assert.equal(d.nextState, "RAMPING");
});

test("Rule #2 · preserves both counters on insufficient data", () => {
  const m = cleanMetrics();
  m.sent24h = 5;

  const d = computeWarmupDecision(makeInput({
    metrics: m, consecutiveHealthyEvals: 3, consecutiveDegradedEvals: 1,
  }));
  assert.equal(d.consecutiveHealthyEvals, 3);
  assert.equal(d.consecutiveDegradedEvals, 1);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Rule #3: OBSERVATION gate
// ═══════════════════════════════════════════════════════════════════════════════

test("Rule #3 · holds in OBSERVATION when warmupDay < minObservationPeriodDays", () => {
  const d = computeWarmupDecision(makeInput({
    currentState: "OBSERVATION", warmupDay: 1, currentDailyLimit: 2,
  }));
  assert.equal(d.action, "HOLD");
  assert.equal(d.nextState, "OBSERVATION");
  assert.ok(d.reasons.some((r) => r.code === "OBSERVATION_PERIOD"));
});

// ═══════════════════════════════════════════════════════════════════════════════
// Rules #4 & #5: DEGRADED + hysteresis
// ═══════════════════════════════════════════════════════════════════════════════

function degradedMetrics(): Mutable<WarmupMetrics> {
  const m = cleanMetrics();
  m.googleSeedSpamLandings7d = 5; // 10% > 8%
  return m;
}

test("Rule #5 · holds on first degraded eval (hysteresis not met)", () => {
  const d = computeWarmupDecision(makeInput({
    metrics: degradedMetrics(), consecutiveDegradedEvals: 0,
  }));
  assert.equal(d.action, "HOLD");
  assert.equal(d.consecutiveDegradedEvals, 1);
  assert.equal(d.consecutiveHealthyEvals, 0);
  assert.ok(d.reasons.some((r) => r.code === "HYSTERESIS_HOLD"));
});

test("Rule #4 · cools down after degradedThreshold consecutive degraded evals", () => {
  const d = computeWarmupDecision(makeInput({
    metrics: degradedMetrics(), consecutiveDegradedEvals: 1, currentDailyLimit: 40,
  }));
  assert.equal(d.action, "COOL_DOWN");
  assert.equal(d.nextState, "COOLDOWN");
  assert.equal(d.effectiveLimit, 30); // floor(40 × 0.75)
});

test("Rule #4 · degraded eval resets healthy counter", () => {
  const d = computeWarmupDecision(makeInput({
    metrics: degradedMetrics(), consecutiveHealthyEvals: 5, consecutiveDegradedEvals: 0,
  }));
  assert.equal(d.consecutiveHealthyEvals, 0);
  assert.equal(d.consecutiveDegradedEvals, 1);
});

// ═══════════════════════════════════════════════════════════════════════════════
// INV-8: cooldownTarget = floor(currentLimit × multiplier)
// ═══════════════════════════════════════════════════════════════════════════════

test("INV-8 · cooldownTarget uses currentLimit not rampTarget", () => {
  const d = computeWarmupDecision(makeInput({
    metrics: degradedMetrics(), currentDailyLimit: 35, consecutiveDegradedEvals: 1,
  }));
  assert.equal(d.action, "COOL_DOWN");
  assert.equal(d.effectiveLimit, Math.floor(35 * 0.75)); // 26
});

// ═══════════════════════════════════════════════════════════════════════════════
// Multi-provider cooldown
// ═══════════════════════════════════════════════════════════════════════════════

test("multi-provider · uses min(multipliers) when both degraded", () => {
  const m = cleanMetrics();
  m.googleSeedSpamLandings7d = 5;
  m.msSeedSpamLandings7d = 5;

  const d = computeWarmupDecision(makeInput({
    metrics: m, currentDailyLimit: 40, consecutiveDegradedEvals: 1,
  }));
  assert.equal(d.action, "COOL_DOWN");
  assert.equal(d.effectiveLimit, 30); // min(0.75, 0.80) = 0.75 → floor(40 × 0.75)
});

// ═══════════════════════════════════════════════════════════════════════════════
// Rule #6: COOLDOWN → RAMPING (not RECOVERY)
// ═══════════════════════════════════════════════════════════════════════════════

test("Rule #6 · COOLDOWN → RAMPING after recoveryThreshold healthy evals", () => {
  const d = computeWarmupDecision(makeInput({
    currentState: "COOLDOWN", consecutiveHealthyEvals: 2, currentDailyLimit: 20,
  }));
  assert.equal(d.action, "ACCELERATE");
  assert.equal(d.nextState, "RAMPING");
  assert.notEqual(d.nextState, "RECOVERY");
});

test("Rule #6 · holds in COOLDOWN when healthy threshold not reached", () => {
  const d = computeWarmupDecision(makeInput({
    currentState: "COOLDOWN", consecutiveHealthyEvals: 0, currentDailyLimit: 20,
  }));
  assert.equal(d.action, "HOLD");
  assert.equal(d.nextState, "COOLDOWN");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Rule #7: RECOVERY → RAMPING
// ═══════════════════════════════════════════════════════════════════════════════

test("Rule #7 · RECOVERY + healthy → RAMPING", () => {
  const d = computeWarmupDecision(makeInput({
    currentState: "RECOVERY", currentDailyLimit: 20,
  }));
  assert.equal(d.action, "ACCELERATE");
  assert.equal(d.nextState, "RAMPING");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Rule #8: OBSERVATION complete → RAMPING
// ═══════════════════════════════════════════════════════════════════════════════

test("Rule #8 · OBSERVATION complete + healthy → RAMPING", () => {
  const d = computeWarmupDecision(makeInput({
    currentState: "OBSERVATION", warmupDay: 3, currentDailyLimit: 2,
  }));
  assert.equal(d.action, "ACCELERATE");
  assert.equal(d.nextState, "RAMPING");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Rule #9: HEALTHY + target > current → ACCELERATE
// ═══════════════════════════════════════════════════════════════════════════════

test("Rule #9 · accelerates when rampTarget exceeds current", () => {
  const d = computeWarmupDecision(makeInput({ warmupDay: 7, currentDailyLimit: 10 }));
  assert.equal(d.action, "ACCELERATE");
  assert.ok(d.effectiveLimit > 10);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Rule #10: HEALTHY + at target → HOLD
// ═══════════════════════════════════════════════════════════════════════════════

test("Rule #10 · holds when at ramp target and day < 28", () => {
  const target = computeRampTarget(7, 40);
  const d = computeWarmupDecision(makeInput({ warmupDay: 7, currentDailyLimit: target }));
  assert.equal(d.action, "HOLD");
  assert.equal(d.nextState, "RAMPING");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Rule #11: STABLE
// ═══════════════════════════════════════════════════════════════════════════════

test("Rule #11 · transitions to STABLE when at safeBaseLimit", () => {
  const d = computeWarmupDecision(makeInput({
    warmupDay: 28, currentDailyLimit: 40, currentState: "RAMPING",
  }));
  assert.equal(d.nextState, "STABLE");
  assert.equal(d.effectiveLimit, 40);
  assert.ok(d.reasons.some((r) => r.code === "WARMUP_COMPLETE"));
});

// ═══════════════════════════════════════════════════════════════════════════════
// Counter semantics
// ═══════════════════════════════════════════════════════════════════════════════

test("counters · healthy eval increments healthy and resets degraded", () => {
  const d = computeWarmupDecision(makeInput({
    consecutiveHealthyEvals: 2, consecutiveDegradedEvals: 3,
  }));
  assert.equal(d.consecutiveHealthyEvals, 3);
  assert.equal(d.consecutiveDegradedEvals, 0);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Engine boundaries
// ═══════════════════════════════════════════════════════════════════════════════

test("engine · never emits RECOVERY as nextState", () => {
  const states: EvaluatableWarmupState[] = ["OBSERVATION", "RAMPING", "STABLE", "COOLDOWN", "RECOVERY"];
  for (const state of states) {
    const d = computeWarmupDecision(makeInput({ currentState: state }));
    assert.notEqual(d.nextState, "RECOVERY", `State ${state} produced RECOVERY`);
  }
});

test("engine · inputHash is deterministic for same inputs", () => {
  const input = makeInput();
  const d1 = computeWarmupDecision(input);
  const d2 = computeWarmupDecision(input);
  assert.equal(d1.inputHash, d2.inputHash);
  assert.equal(d1.inputHash.length, 64);
});

test("engine · inputHash differs for different inputs", () => {
  const d1 = computeWarmupDecision(makeInput({ warmupDay: 5 }));
  const d2 = computeWarmupDecision(makeInput({ warmupDay: 6 }));
  assert.notEqual(d1.inputHash, d2.inputHash);
});

test("engine · includes policyVersion", () => {
  const d = computeWarmupDecision(makeInput());
  assert.equal(d.policyVersion, WARMUP_POLICY_VERSION);
});

test("engine · scope field is carried through", () => {
  const d1 = computeWarmupDecision(makeInput({ scope: "mailbox" }));
  const d2 = computeWarmupDecision(makeInput({ scope: "domain" }));
  assert.equal(d1.scope, "mailbox");
  assert.equal(d2.scope, "domain");
});

test("engine · domain scope produces identical decisions as mailbox for same inputs", () => {
  const base = makeInput();
  const d1 = computeWarmupDecision({ ...base, scope: "mailbox" });
  const d2 = computeWarmupDecision({ ...base, scope: "domain" });
  assert.equal(d1.action, d2.action);
  assert.equal(d1.nextState, d2.nextState);
  assert.equal(d1.effectiveLimit, d2.effectiveLimit);
});

// ═══════════════════════════════════════════════════════════════════════════════
// assessHealth — severity matrix
// ═══════════════════════════════════════════════════════════════════════════════

test("health · HEALTHY with clean metrics", () => {
  const r = assessHealth(cleanMetrics(), DEFAULT_PLACEMENT_POLICIES);
  assert.equal(r.health, "HEALTHY");
});

test("health · DEGRADED on bounce ≥1.5%", () => {
  const m = cleanMetrics();
  m.bounces7d = 2; // 2%
  const r = assessHealth(m, DEFAULT_PLACEMENT_POLICIES);
  assert.equal(r.health, "DEGRADED");
  assert.ok(r.reasons.some((x) => x.code === "BOUNCE_RATE_DEGRADED"));
});

test("health · CRITICAL on bounce ≥5%", () => {
  const m = cleanMetrics();
  m.bounces7d = 5;
  assert.equal(assessHealth(m, DEFAULT_PLACEMENT_POLICIES).health, "CRITICAL");
});

test("health · DEGRADED on Google spam ≥8%", () => {
  const m = cleanMetrics();
  m.googleSeedSpamLandings7d = 5; // 10%
  const r = assessHealth(m, DEFAULT_PLACEMENT_POLICIES);
  assert.equal(r.health, "DEGRADED");
  assert.ok(r.reasons.some((x) => x.code === "GOOGLE_SPAM_DEGRADED"));
});

test("health · CRITICAL on Google spam ≥16%", () => {
  const m = cleanMetrics();
  m.googleSeedSpamLandings7d = 9; // 18%
  assert.equal(assessHealth(m, DEFAULT_PLACEMENT_POLICIES).health, "CRITICAL");
});

test("health · DEGRADED on complaint ≥0.1%", () => {
  const m = cleanMetrics();
  m.sent7d = 500;
  m.complaints7d = 1; // 0.2%
  assert.equal(assessHealth(m, DEFAULT_PLACEMENT_POLICIES).health, "DEGRADED");
});

test("health · CRITICAL wins over DEGRADED when both present", () => {
  const m = cleanMetrics();
  m.bounces7d = 5;
  m.googleSeedSpamLandings7d = 5;
  assert.equal(assessHealth(m, DEFAULT_PLACEMENT_POLICIES).health, "CRITICAL");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Finding 9: Boundary-exact threshold tests
// ═══════════════════════════════════════════════════════════════════════════════

test("boundary · bounce 1.499% → HEALTHY", () => {
  const m = cleanMetrics();
  // 1.499% of 10000 = 149.9 bounces → use 149/10000
  m.sent7d = 10000;
  m.bounces7d = 149; // 1.49%
  assert.equal(assessHealth(m, DEFAULT_PLACEMENT_POLICIES).health, "HEALTHY");
});

test("boundary · bounce 1.500% → DEGRADED", () => {
  const m = cleanMetrics();
  m.sent7d = 10000;
  m.bounces7d = 150; // exactly 1.5%
  assert.equal(assessHealth(m, DEFAULT_PLACEMENT_POLICIES).health, "DEGRADED");
});

test("boundary · bounce 4.999% → DEGRADED (not CRITICAL)", () => {
  const m = cleanMetrics();
  m.sent7d = 10000;
  m.bounces7d = 499; // 4.99%
  assert.equal(assessHealth(m, DEFAULT_PLACEMENT_POLICIES).health, "DEGRADED");
});

test("boundary · bounce 5.000% → CRITICAL", () => {
  const m = cleanMetrics();
  m.sent7d = 10000;
  m.bounces7d = 500; // exactly 5%
  assert.equal(assessHealth(m, DEFAULT_PLACEMENT_POLICIES).health, "CRITICAL");
});

test("boundary · complaint 0.099% → HEALTHY", () => {
  const m = cleanMetrics();
  m.sent7d = 100000;
  m.complaints7d = 99; // 0.099%
  assert.equal(assessHealth(m, DEFAULT_PLACEMENT_POLICIES).health, "HEALTHY");
});

test("boundary · complaint 0.100% → DEGRADED", () => {
  const m = cleanMetrics();
  m.sent7d = 100000;
  m.complaints7d = 100; // exactly 0.1%
  assert.equal(assessHealth(m, DEFAULT_PLACEMENT_POLICIES).health, "DEGRADED");
});

test("boundary · complaint 0.299% → DEGRADED (not CRITICAL)", () => {
  const m = cleanMetrics();
  m.sent7d = 100000;
  m.complaints7d = 299; // 0.299%
  assert.equal(assessHealth(m, DEFAULT_PLACEMENT_POLICIES).health, "DEGRADED");
});

test("boundary · complaint 0.300% → CRITICAL", () => {
  const m = cleanMetrics();
  m.sent7d = 100000;
  m.complaints7d = 300; // exactly 0.3%
  assert.equal(assessHealth(m, DEFAULT_PLACEMENT_POLICIES).health, "CRITICAL");
});

test("boundary · Google spam below threshold → HEALTHY", () => {
  const m = cleanMetrics();
  m.googleSeedInteractions7d = 1000;
  m.googleSeedSpamLandings7d = 79; // 7.9% < 8%
  assert.equal(assessHealth(m, DEFAULT_PLACEMENT_POLICIES).health, "HEALTHY");
});

test("boundary · Google spam at threshold → DEGRADED", () => {
  const m = cleanMetrics();
  m.googleSeedInteractions7d = 1000;
  m.googleSeedSpamLandings7d = 80; // exactly 8%
  assert.equal(assessHealth(m, DEFAULT_PLACEMENT_POLICIES).health, "DEGRADED");
});

test("boundary · Google spam below 2× threshold → DEGRADED (not CRITICAL)", () => {
  const m = cleanMetrics();
  m.googleSeedInteractions7d = 1000;
  m.googleSeedSpamLandings7d = 159; // 15.9% < 16%
  assert.equal(assessHealth(m, DEFAULT_PLACEMENT_POLICIES).health, "DEGRADED");
});

test("boundary · Google spam at 2× threshold → CRITICAL", () => {
  const m = cleanMetrics();
  m.googleSeedInteractions7d = 1000;
  m.googleSeedSpamLandings7d = 160; // exactly 16%
  assert.equal(assessHealth(m, DEFAULT_PLACEMENT_POLICIES).health, "CRITICAL");
});

// ═══════════════════════════════════════════════════════════════════════════════
// Threshold constants consistency
// ═══════════════════════════════════════════════════════════════════════════════

test("thresholds · constants match expected values", () => {
  assert.equal(BOUNCE_DEGRADED_THRESHOLD, 0.015);
  assert.equal(BOUNCE_CRITICAL_THRESHOLD, 0.05);
  assert.equal(COMPLAINT_DEGRADED_THRESHOLD, 0.001);
  assert.equal(COMPLAINT_CRITICAL_THRESHOLD, 0.003);
  assert.equal(MIN_SAMPLE_SIZE, 10);
});
