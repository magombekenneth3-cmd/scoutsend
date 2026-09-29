/**
 * WarmupPolicyEngine — Pure Deterministic Policy
 *
 * Zero I/O. Zero dependencies on Prisma, Redis, BullMQ, or Gemini.
 * All inputs are plain data; all outputs are immutable (readonly).
 *
 * One canonical algorithm for both mailbox and domain scope (INV-4).
 *
 * Preconditions:
 *   - input.currentState is EvaluatableWarmupState (never NOT_STARTED, never PAUSED)
 *   - input is fully populated plain data
 *
 * Postconditions:
 *   - decision.nextState is never RECOVERY (operator resume only)
 *   - decision is readonly and fully self-describing (INV-13)
 *   - decision.effectiveLimit is NEVER 0 on PAUSE — preserves currentLimit (INV-12)
 *
 * System law:
 *   Engine proposes → Registry validates → Service applies.
 */

import { createHash } from "crypto";

import type {
  EvaluatableWarmupState,
  WarmupState,
  WarmupScope,
  WarmupHealth,
  WarmupAction,
  WarmupReasonCode,
  WarmupReasonDetail,
  HealthAssessment,
  PlacementProvider,
  SenderProviderPolicy,
  PlacementProviderPolicy,
  WarmupMetrics,
  WarmupPolicyInput,
  WarmupDecision,
} from "./warmup-types.js";

import {
  BOUNCE_DEGRADED_THRESHOLD,
  BOUNCE_CRITICAL_THRESHOLD,
  COMPLAINT_DEGRADED_THRESHOLD,
  COMPLAINT_CRITICAL_THRESHOLD,
  BLOCK_EVENTS_CRITICAL_THRESHOLD,
  MIN_SAMPLE_SIZE,
} from "./warmup-types.js";

// Re-export types and constants for backward compatibility
export type {
  EvaluatableWarmupState,
  WarmupState,
  WarmupScope,
  WarmupHealth,
  WarmupAction,
  WarmupReasonCode,
  WarmupReasonDetail,
  HealthAssessment,
  PlacementProvider,
  SenderProviderPolicy,
  PlacementProviderPolicy,
  WarmupMetrics,
  WarmupPolicyInput,
  WarmupDecision,
};

export { MIN_SAMPLE_SIZE };

// ─── Policy Version ──────────────────────────────────────────────────────────

export const WARMUP_POLICY_VERSION = "warmup-v7.0";

// ─── Ramp Curve ──────────────────────────────────────────────────────────────

export const WARMUP_RAMP_CHECKPOINTS: readonly [day: number, pct: number][] = [
  [1, 5],
  [2, 8],
  [3, 12],
  [4, 17],
  [5, 23],
  [6, 30],
  [7, 38],
  [14, 60],
  [21, 80],
  [28, 100],
];

export function computeRampTarget(
  warmupDay: number,
  safeBaseLimit: number,
): number {
  if (safeBaseLimit <= 0) return 1;
  if (warmupDay <= 0)
    return Math.max(1, Math.round(0.05 * safeBaseLimit));
  if (warmupDay >= 28) return safeBaseLimit;

  const checkpoints = WARMUP_RAMP_CHECKPOINTS;
  let lo = checkpoints[0]!;
  let hi = checkpoints[checkpoints.length - 1]!;

  for (let i = 0; i < checkpoints.length - 1; i++) {
    if (warmupDay >= checkpoints[i]![0] && warmupDay <= checkpoints[i + 1]![0]) {
      lo = checkpoints[i]!;
      hi = checkpoints[i + 1]!;
      break;
    }
  }

  const t = (warmupDay - lo[0]) / (hi[0] - lo[0]);
  const pct = lo[1] + t * (hi[1] - lo[1]);
  return Math.max(
    1,
    Math.min(Math.round((pct / 100) * safeBaseLimit), safeBaseLimit),
  );
}

// ─── Critical Safety Check (INV-9: before sample gate) ──────────────────────

interface CriticalCheckResult {
  readonly isCritical: boolean;
  readonly reasons: readonly WarmupReasonDetail[];
}

/**
 * Evaluated BEFORE the sample gate. Uses the same threshold constants
 * as assessHealth() to prevent boundary divergence (Finding 9).
 */
function checkCriticalSafetySignals(
  metrics: WarmupMetrics,
  placementPolicies: Record<PlacementProvider, PlacementProviderPolicy>,
): CriticalCheckResult {
  const reasons: WarmupReasonDetail[] = [];

  if (metrics.blockEvents24h >= BLOCK_EVENTS_CRITICAL_THRESHOLD) {
    reasons.push({
      code: "BLOCK_EVENTS_CRITICAL",
      value: metrics.blockEvents24h,
      threshold: BLOCK_EVENTS_CRITICAL_THRESHOLD,
    });
  }

  if (metrics.sent24h > 0) {
    const bounceRate = metrics.bounces24h / metrics.sent24h;
    if (bounceRate >= BOUNCE_CRITICAL_THRESHOLD) {
      reasons.push({
        code: "BOUNCE_RATE_CRITICAL",
        value: bounceRate,
        threshold: BOUNCE_CRITICAL_THRESHOLD,
      });
    }
  }

  if (metrics.sent24h > 0) {
    const complaintRate = metrics.complaints24h / metrics.sent24h;
    if (complaintRate >= COMPLAINT_CRITICAL_THRESHOLD) {
      reasons.push({
        code: "COMPLAINT_RATE_CRITICAL",
        value: complaintRate,
        threshold: COMPLAINT_CRITICAL_THRESHOLD,
      });
    }
  }

  const googlePolicy = placementPolicies.GOOGLE;
  if (metrics.googleSeedInteractions24h > 0) {
    const googleSpamRate =
      metrics.googleSeedSpamLandings24h / metrics.googleSeedInteractions24h;
    const criticalThreshold = googlePolicy.spamThreshold * 2;
    if (googleSpamRate >= criticalThreshold) {
      reasons.push({
        code: "GOOGLE_SPAM_CRITICAL",
        value: googleSpamRate,
        threshold: criticalThreshold,
      });
    }
  }

  const msPolicy = placementPolicies.MICROSOFT;
  if (metrics.msSeedInteractions24h > 0) {
    const msSpamRate =
      metrics.msSeedSpamLandings24h / metrics.msSeedInteractions24h;
    const criticalThreshold = msPolicy.spamThreshold * 2;
    if (msSpamRate >= criticalThreshold) {
      reasons.push({
        code: "MICROSOFT_SPAM_CRITICAL",
        value: msSpamRate,
        threshold: criticalThreshold,
      });
    }
  }

  return { isCritical: reasons.length > 0, reasons };
}

// ─── Health Assessment ───────────────────────────────────────────────────────

/**
 * Full health assessment. Uses the SAME threshold constants as
 * checkCriticalSafetySignals() (Finding 9).
 */
export function assessHealth(
  metrics: WarmupMetrics,
  placementPolicies: Record<PlacementProvider, PlacementProviderPolicy>,
): HealthAssessment {
  const reasons: WarmupReasonDetail[] = [];
  let health: WarmupHealth = "HEALTHY";

  const bounceRate7d =
    metrics.sent7d > 0 ? metrics.bounces7d / metrics.sent7d : 0;
  const bounceRate24h =
    metrics.sent24h > 0 ? metrics.bounces24h / metrics.sent24h : 0;
  const weightedBounce = Math.max(bounceRate7d, bounceRate24h);

  if (weightedBounce >= BOUNCE_CRITICAL_THRESHOLD) {
    reasons.push({
      code: "BOUNCE_RATE_CRITICAL",
      value: weightedBounce,
      threshold: BOUNCE_CRITICAL_THRESHOLD,
    });
    health = "CRITICAL";
  } else if (weightedBounce >= BOUNCE_DEGRADED_THRESHOLD) {
    reasons.push({
      code: "BOUNCE_RATE_DEGRADED",
      value: weightedBounce,
      threshold: BOUNCE_DEGRADED_THRESHOLD,
    });
    health = "DEGRADED";
  }

  const complaintRate =
    metrics.sent7d > 0 ? metrics.complaints7d / metrics.sent7d : 0;

  if (complaintRate >= COMPLAINT_CRITICAL_THRESHOLD) {
    reasons.push({
      code: "COMPLAINT_RATE_CRITICAL",
      value: complaintRate,
      threshold: COMPLAINT_CRITICAL_THRESHOLD,
    });
    health = "CRITICAL";
  } else if (complaintRate >= COMPLAINT_DEGRADED_THRESHOLD) {
    reasons.push({
      code: "COMPLAINT_RATE_DEGRADED",
      value: complaintRate,
      threshold: COMPLAINT_DEGRADED_THRESHOLD,
    });
    if (health !== "CRITICAL") health = "DEGRADED";
  }

  const googlePolicy = placementPolicies.GOOGLE;
  if (metrics.googleSeedInteractions7d > 0) {
    const googleSpamRate =
      metrics.googleSeedSpamLandings7d / metrics.googleSeedInteractions7d;
    const critThreshold = googlePolicy.spamThreshold * 2;

    if (googleSpamRate >= critThreshold) {
      reasons.push({
        code: "GOOGLE_SPAM_CRITICAL",
        value: googleSpamRate,
        threshold: critThreshold,
      });
      health = "CRITICAL";
    } else if (googleSpamRate >= googlePolicy.spamThreshold) {
      reasons.push({
        code: "GOOGLE_SPAM_DEGRADED",
        value: googleSpamRate,
        threshold: googlePolicy.spamThreshold,
      });
      if (health !== "CRITICAL") health = "DEGRADED";
    }
  }

  const msPolicy = placementPolicies.MICROSOFT;
  if (metrics.msSeedInteractions7d > 0) {
    const msSpamRate =
      metrics.msSeedSpamLandings7d / metrics.msSeedInteractions7d;
    const critThreshold = msPolicy.spamThreshold * 2;

    if (msSpamRate >= critThreshold) {
      reasons.push({
        code: "MICROSOFT_SPAM_CRITICAL",
        value: msSpamRate,
        threshold: critThreshold,
      });
      health = "CRITICAL";
    } else if (msSpamRate >= msPolicy.spamThreshold) {
      reasons.push({
        code: "MICROSOFT_SPAM_DEGRADED",
        value: msSpamRate,
        threshold: msPolicy.spamThreshold,
      });
      if (health !== "CRITICAL") health = "DEGRADED";
    }
  }

  if (metrics.blockEvents24h >= BLOCK_EVENTS_CRITICAL_THRESHOLD) {
    reasons.push({
      code: "BLOCK_EVENTS_CRITICAL",
      value: metrics.blockEvents24h,
      threshold: BLOCK_EVENTS_CRITICAL_THRESHOLD,
    });
    health = "CRITICAL";
  }

  if (reasons.length === 0) {
    reasons.push({ code: "HEALTHY_METRICS", value: 0, threshold: 0 });
  }

  return { health, reasons };
}

// ─── Input Hash ──────────────────────────────────────────────────────────────

function computeInputHash(input: WarmupPolicyInput): string {
  const canonical = JSON.stringify(input, Object.keys(input).sort());
  return createHash("sha256").update(canonical).digest("hex");
}

// ─── Pure Policy Engine ──────────────────────────────────────────────────────

/**
 * computeWarmupDecision — the core deterministic policy function.
 *
 * Action precedence (first match wins):
 *   #1  CRITICAL signal             → PAUSE   (effectiveLimit = currentLimit, INV-12)
 *   #2  Insufficient sample         → HOLD    (counters preserved)
 *   #3  OBSERVATION + gate open     → HOLD
 *   #4  DEGRADED + threshold met    → COOL_DOWN
 *   #5  DEGRADED + threshold unmet  → HOLD    (hysteresis)
 *   #6  COOLDOWN + healthy thresh   → ACCELERATE → RAMPING
 *   #7  RECOVERY + healthy          → ACCELERATE → RAMPING
 *   #8  OBSERVATION + gate done     → ACCELERATE → RAMPING
 *   #9  HEALTHY + target > current  → ACCELERATE
 *   #10 HEALTHY + target == current → HOLD
 *   #11 target >= safeBaseLimit     → HOLD → STABLE
 */
export function computeWarmupDecision(
  input: WarmupPolicyInput,
): WarmupDecision {
  const inputHash = computeInputHash(input);

  // INV-1: Provider safe limit caps the ramp base
  const safeBaseLimit = Math.min(
    input.baseDailyLimit,
    input.senderPolicy.warmupSafeDailyLimit,
  );

  const rampTarget = computeRampTarget(input.warmupDay, safeBaseLimit);

  let consecutiveHealthyEvals = input.consecutiveHealthyEvals;
  let consecutiveDegradedEvals = input.consecutiveDegradedEvals;

  const decide = (
    action: WarmupAction,
    nextState: WarmupState,
    effectiveLimit: number,
    reasons: readonly WarmupReasonDetail[],
    healthAssessment: HealthAssessment,
    insufficientData: boolean,
  ): WarmupDecision => ({
    scope: input.scope,
    action,
    nextState,
    currentLimit: input.currentDailyLimit,
    targetLimit: rampTarget,
    effectiveLimit,
    healthAssessment,
    reasons,
    insufficientData,
    consecutiveHealthyEvals,
    consecutiveDegradedEvals,
    policyVersion: WARMUP_POLICY_VERSION,
    inputHash,
  });

  // ── Rule #1: CRITICAL safety signals (INV-9: before sample gate) ──────
  //    INV-12: effectiveLimit = currentLimit, NOT 0.
  //    The pause is enforced by warmupState=PAUSED + fence, not by dailyLimit=0.

  const criticalCheck = checkCriticalSafetySignals(
    input.metrics,
    input.placementPolicies,
  );

  if (criticalCheck.isCritical) {
    const assessment: HealthAssessment = {
      health: "CRITICAL",
      reasons: criticalCheck.reasons,
    };
    return decide(
      "PAUSE",
      "PAUSED",
      input.currentDailyLimit, // INV-12: preserve limit
      criticalCheck.reasons,
      assessment,
      false,
    );
  }

  // ── Rule #2: Insufficient sample ──────────────────────────────────────

  if (input.metrics.sent24h < MIN_SAMPLE_SIZE) {
    const assessment: HealthAssessment = {
      health: "HEALTHY",
      reasons: [{ code: "INSUFFICIENT_SAMPLE", value: input.metrics.sent24h, threshold: MIN_SAMPLE_SIZE }],
    };
    // Counters preserved (no mutation)
    return decide(
      "HOLD",
      input.currentState,
      input.currentDailyLimit,
      [{ code: "INSUFFICIENT_SAMPLE", value: input.metrics.sent24h, threshold: MIN_SAMPLE_SIZE }],
      assessment,
      true,
    );
  }

  // ── Full health assessment (sample gate passed) ───────────────────────

  const healthAssessment = assessHealth(
    input.metrics,
    input.placementPolicies,
  );

  // If the full assessment finds CRITICAL (e.g., from 7d window), PAUSE
  // INV-12: effectiveLimit = currentLimit
  if (healthAssessment.health === "CRITICAL") {
    return decide(
      "PAUSE",
      "PAUSED",
      input.currentDailyLimit, // INV-12: preserve limit
      healthAssessment.reasons,
      healthAssessment,
      false,
    );
  }

  // ── Update counters based on health ───────────────────────────────────

  if (healthAssessment.health === "HEALTHY") {
    consecutiveHealthyEvals = input.consecutiveHealthyEvals + 1;
    consecutiveDegradedEvals = 0;
  } else if (healthAssessment.health === "DEGRADED") {
    consecutiveDegradedEvals = input.consecutiveDegradedEvals + 1;
    consecutiveHealthyEvals = 0;
  }

  // ── Rule #3: OBSERVATION + gate incomplete ────────────────────────────

  if (
    input.currentState === "OBSERVATION" &&
    input.warmupDay < input.senderPolicy.minObservationPeriodDays
  ) {
    return decide(
      "HOLD",
      "OBSERVATION",
      input.currentDailyLimit,
      [{ code: "OBSERVATION_PERIOD", value: input.warmupDay, threshold: input.senderPolicy.minObservationPeriodDays }],
      healthAssessment,
      false,
    );
  }

  // ── Rule #4: DEGRADED + threshold reached → COOL_DOWN ────────────────

  if (healthAssessment.health === "DEGRADED") {
    const degradedThreshold = Math.min(
      ...Object.values(input.placementPolicies).map(
        (p) => p.degradedThreshold,
      ),
    );

    if (consecutiveDegradedEvals >= degradedThreshold) {
      // INV-8: cooldownTarget = floor(currentLimit × min(activeDegradedMultipliers))
      const degradedProviders = getDegradedProviders(
        input.metrics,
        input.placementPolicies,
      );
      const effectiveMultiplier =
        degradedProviders.length > 0
          ? Math.min(...degradedProviders.map((p) => p.cooldownMultiplier))
          : Math.min(
              ...Object.values(input.placementPolicies).map(
                (p) => p.cooldownMultiplier,
              ),
            );

      const cooldownTarget = Math.max(
        1,
        Math.floor(input.currentDailyLimit * effectiveMultiplier),
      );

      // Rule #4
      return decide(
        "COOL_DOWN",
        "COOLDOWN",
        cooldownTarget,
        healthAssessment.reasons,
        healthAssessment,
        false,
      );
    }

    // Rule #5: DEGRADED + threshold not reached → HOLD (hysteresis)
    return decide(
      "HOLD",
      input.currentState,
      input.currentDailyLimit,
      [
        ...healthAssessment.reasons,
        {
          code: "HYSTERESIS_HOLD",
          value: consecutiveDegradedEvals,
          threshold: degradedThreshold,
        },
      ],
      healthAssessment,
      false,
    );
  }

  // ── From here, health === HEALTHY ─────────────────────────────────────

  // ── Rule #6: COOLDOWN + healthy threshold reached → RAMPING ───────────

  if (input.currentState === "COOLDOWN") {
    const recoveryThreshold = Math.min(
      ...Object.values(input.placementPolicies).map(
        (p) => p.recoveryThreshold,
      ),
    );

    if (consecutiveHealthyEvals >= recoveryThreshold) {
      return decide(
        "ACCELERATE",
        "RAMPING",
        rampTarget,
        [{ code: "COOLDOWN_RECOVERY", value: consecutiveHealthyEvals, threshold: recoveryThreshold }],
        healthAssessment,
        false,
      );
    }

    return decide(
      "HOLD",
      "COOLDOWN",
      input.currentDailyLimit,
      [{ code: "HYSTERESIS_HOLD", value: consecutiveHealthyEvals, threshold: recoveryThreshold }],
      healthAssessment,
      false,
    );
  }

  // ── Rule #7: RECOVERY + healthy → RAMPING ─────────────────────────────

  if (input.currentState === "RECOVERY") {
    return decide(
      "ACCELERATE",
      "RAMPING",
      rampTarget,
      [{ code: "RECOVERY_PROGRESSING", value: consecutiveHealthyEvals, threshold: 1 }],
      healthAssessment,
      false,
    );
  }

  // ── Rule #8: OBSERVATION + gate complete + healthy → RAMPING ──────────

  if (
    input.currentState === "OBSERVATION" &&
    input.warmupDay >= input.senderPolicy.minObservationPeriodDays
  ) {
    return decide(
      "ACCELERATE",
      "RAMPING",
      rampTarget,
      healthAssessment.reasons,
      healthAssessment,
      false,
    );
  }

  // ── Rule #11: Check STABLE (target >= safeBaseLimit, at limit) ────────

  if (rampTarget >= safeBaseLimit && input.currentDailyLimit >= safeBaseLimit) {
    return decide(
      "HOLD",
      "STABLE",
      safeBaseLimit,
      [{ code: "WARMUP_COMPLETE", value: safeBaseLimit, threshold: safeBaseLimit }],
      healthAssessment,
      false,
    );
  }

  // ── Rule #9: HEALTHY + target > current → ACCELERATE ──────────────────

  if (rampTarget > input.currentDailyLimit) {
    return decide(
      "ACCELERATE",
      input.currentState,
      rampTarget,
      [{ code: "RAMP_TARGET_REACHED", value: rampTarget, threshold: input.currentDailyLimit }],
      healthAssessment,
      false,
    );
  }

  // ── Rule #10: HEALTHY + target == current → HOLD ──────────────────────

  return decide(
    "HOLD",
    input.currentState,
    input.currentDailyLimit,
    healthAssessment.reasons,
    healthAssessment,
    false,
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getDegradedProviders(
  metrics: WarmupMetrics,
  policies: Record<PlacementProvider, PlacementProviderPolicy>,
): PlacementProviderPolicy[] {
  const degraded: PlacementProviderPolicy[] = [];

  const googlePolicy = policies.GOOGLE;
  if (metrics.googleSeedInteractions7d > 0) {
    const rate =
      metrics.googleSeedSpamLandings7d / metrics.googleSeedInteractions7d;
    if (rate >= googlePolicy.spamThreshold) {
      degraded.push(googlePolicy);
    }
  }

  const msPolicy = policies.MICROSOFT;
  if (metrics.msSeedInteractions7d > 0) {
    const rate = metrics.msSeedSpamLandings7d / metrics.msSeedInteractions7d;
    if (rate >= msPolicy.spamThreshold) {
      degraded.push(msPolicy);
    }
  }

  return degraded;
}
