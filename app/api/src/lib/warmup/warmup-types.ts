/**
 * warmup-types.ts — Canonical type definitions for the warmup subsystem.
 *
 * INV-10: WarmupState is defined ONCE. The policy engine and
 *         state-transition registry both import from this file.
 *
 * This file has ZERO runtime dependencies (no Prisma, no Redis, no BullMQ).
 */

// ─── State ───────────────────────────────────────────────────────────────────

export const WARMUP_STATES = [
  "NOT_STARTED",
  "OBSERVATION",
  "RAMPING",
  "STABLE",
  "COOLDOWN",
  "PAUSED",
  "RECOVERY",
] as const;

export type WarmupState = (typeof WARMUP_STATES)[number];

/**
 * INV-11: The policy engine never receives NOT_STARTED or PAUSED.
 *
 * NOT_STARTED is handled by the lifecycle/start service
 * (transitions to OBSERVATION on enable).
 *
 * PAUSED is handled by the agent loop (observation-only logging,
 * no policy evaluation). Resume is operator-only → RECOVERY.
 */
export type EvaluatableWarmupState =
  | "OBSERVATION"
  | "RAMPING"
  | "STABLE"
  | "COOLDOWN"
  | "RECOVERY";

// ─── Scope ───────────────────────────────────────────────────────────────────

export type WarmupScope = "mailbox" | "domain";

// ─── Health ──────────────────────────────────────────────────────────────────

export type WarmupHealth = "HEALTHY" | "DEGRADED" | "CRITICAL";

// ─── Action ──────────────────────────────────────────────────────────────────

export type WarmupAction = "HOLD" | "ACCELERATE" | "COOL_DOWN" | "PAUSE";

// ─── Reason Codes ────────────────────────────────────────────────────────────

export type WarmupReasonCode =
  | "INSUFFICIENT_SAMPLE"
  | "OBSERVATION_PERIOD"
  | "RAMP_TARGET_REACHED"
  | "WARMUP_COMPLETE"
  | "GOOGLE_SPAM_DEGRADED"
  | "GOOGLE_SPAM_CRITICAL"
  | "MICROSOFT_SPAM_DEGRADED"
  | "MICROSOFT_SPAM_CRITICAL"
  | "BOUNCE_RATE_DEGRADED"
  | "BOUNCE_RATE_CRITICAL"
  | "COMPLAINT_RATE_DEGRADED"
  | "COMPLAINT_RATE_CRITICAL"
  | "BLOCK_EVENTS_CRITICAL"
  | "HYSTERESIS_HOLD"
  | "HEALTHY_METRICS"
  | "RECOVERY_PROGRESSING"
  | "COOLDOWN_RECOVERY";

// ─── Structured Reason ───────────────────────────────────────────────────────

export interface WarmupReasonDetail {
  readonly code: WarmupReasonCode;
  readonly value: number;
  readonly threshold: number;
}

// ─── Health Assessment ───────────────────────────────────────────────────────

export interface HealthAssessment {
  readonly health: WarmupHealth;
  readonly reasons: readonly WarmupReasonDetail[];
}

// ─── Provider Policy ─────────────────────────────────────────────────────────

export type PlacementProvider = "GOOGLE" | "MICROSOFT";

export interface SenderProviderPolicy {
  readonly warmupSafeDailyLimit: number;
  readonly minObservationPeriodDays: number;
}

export interface PlacementProviderPolicy {
  readonly spamThreshold: number;
  readonly cooldownMultiplier: number;
  readonly degradedThreshold: number;
  readonly recoveryThreshold: number;
}

// ─── Metrics ─────────────────────────────────────────────────────────────────

export interface WarmupMetrics {
  readonly sent24h: number;
  readonly bounces24h: number;
  readonly complaints24h: number;
  readonly seedInteractions24h: number;
  readonly seedSpamLandings24h: number;
  readonly blockEvents24h: number;
  readonly googleSeedInteractions24h: number;
  readonly googleSeedSpamLandings24h: number;
  readonly msSeedInteractions24h: number;
  readonly msSeedSpamLandings24h: number;

  readonly sent7d: number;
  readonly bounces7d: number;
  readonly complaints7d: number;
  readonly seedInteractions7d: number;
  readonly seedSpamLandings7d: number;
  readonly googleSeedInteractions7d: number;
  readonly googleSeedSpamLandings7d: number;
  readonly msSeedInteractions7d: number;
  readonly msSeedSpamLandings7d: number;

  readonly sentLifetime: number;
  readonly bouncesLifetime: number;
}

// ─── Policy Input ────────────────────────────────────────────────────────────

export interface WarmupPolicyInput {
  readonly scope: WarmupScope;
  readonly warmupDay: number;
  readonly currentState: EvaluatableWarmupState;
  readonly currentDailyLimit: number;
  readonly baseDailyLimit: number;
  readonly consecutiveHealthyEvals: number;
  readonly consecutiveDegradedEvals: number;
  readonly metrics: WarmupMetrics;
  readonly senderPolicy: SenderProviderPolicy;
  readonly placementPolicies: Record<PlacementProvider, PlacementProviderPolicy>;
}

// ─── Policy Decision (INV-13: readonly, created once, never mutated) ─────────

export interface WarmupDecision {
  readonly scope: WarmupScope;
  readonly action: WarmupAction;
  readonly nextState: WarmupState;
  readonly currentLimit: number;
  readonly targetLimit: number;
  readonly effectiveLimit: number;
  readonly healthAssessment: HealthAssessment;
  readonly reasons: readonly WarmupReasonDetail[];
  readonly insufficientData: boolean;
  readonly consecutiveHealthyEvals: number;
  readonly consecutiveDegradedEvals: number;
  readonly policyVersion: string;
  readonly inputHash: string;
}

// ─── Fence State ─────────────────────────────────────────────────────────────

export interface FenceState {
  readonly version: number;
  readonly paused: boolean;
}

// ─── Effective State (for UI / worker queries) ───────────────────────────────

export type EffectiveWarmupState =
  | WarmupState
  | "PAUSED_BY_DOMAIN"
  | "PAUSED_BY_GLOBAL";

// ─── Delivery Status ─────────────────────────────────────────────────────────

export type WarmupDeliveryStatus =
  | "DELIVERED"
  | "SPAM"
  | "BOUNCED"
  | "DEFERRED"
  | "UNKNOWN";

// ─── Threshold Constants ─────────────────────────────────────────────────────
// Both checkCriticalSafetySignals() and assessHealth() MUST use these.

export const BOUNCE_DEGRADED_THRESHOLD = 0.015;
export const BOUNCE_CRITICAL_THRESHOLD = 0.05;
export const COMPLAINT_DEGRADED_THRESHOLD = 0.001;
export const COMPLAINT_CRITICAL_THRESHOLD = 0.003;
export const BLOCK_EVENTS_CRITICAL_THRESHOLD = 1;
export const MIN_SAMPLE_SIZE = 10;
