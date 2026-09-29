/**
 * Sprint 11 — Outbox Operational Health Thresholds & Evaluator
 *
 * LOCATION: app/api/src/modules/outbox/outbox-health.config.ts
 *
 * PURE FUNCTION INVARIANTS:
 * 1. Health state derivation must be deterministic and pure.
 * 2. Zero-traffic windows (totalAttempts === 0) return null failure rates and do NOT masquerade as 0% failure.
 * 3. Threshold checks evaluate CRITICAL first, then DEGRADED, defaulting to HEALTHY.
 */

export interface WindowMetrics {
  windowMinutes: number;
  totalAttempts: number;
  successfulAttempts: number;
  failedAttempts: number;
  fencingBreaches: number;
  providerSuccessRate: number | null;
  providerFailureRate: number | null;
  averageLatencyMs: number | null;
}

export interface CurrentStateMetrics {
  pendingCount: number;
  processingCount: number;
  failedCount: number;
  deadLetterCount: number;
  oldestPendingAgeSeconds: number | null;
  oldestProcessingAgeSeconds: number | null;
  staleLeaseCount: number;
}

export interface OutboxHealthStatus {
  state: "HEALTHY" | "DEGRADED" | "CRITICAL";
  evaluatedAt: Date;
  organizationId?: string;
  current: CurrentStateMetrics;
  windows: {
    current: WindowMetrics;   // 5m
    shortTerm: WindowMetrics; // 15m
    longTerm: WindowMetrics;  // 1h
  };
}

export const OUTBOX_HEALTH_THRESHOLDS = {
  degraded: {
    oldestPendingAgeSeconds: 60,
    providerFailureRate: 0.05,
    staleLeaseCount: 1,
    fencingBreaches: 1,
  },
  critical: {
    oldestPendingAgeSeconds: 300,
    providerFailureRate: 0.20,
    staleLeaseCount: 5,
    fencingBreaches: 3,
  },
};

export function evaluateOutboxHealth(
  current: CurrentStateMetrics,
  windows: { current: WindowMetrics; shortTerm: WindowMetrics; longTerm: WindowMetrics },
  thresholds = OUTBOX_HEALTH_THRESHOLDS,
): "HEALTHY" | "DEGRADED" | "CRITICAL" {
  // Check CRITICAL conditions
  if (
    (current.oldestPendingAgeSeconds !== null && current.oldestPendingAgeSeconds >= thresholds.critical.oldestPendingAgeSeconds) ||
    current.staleLeaseCount >= thresholds.critical.staleLeaseCount ||
    windows.current.fencingBreaches >= thresholds.critical.fencingBreaches ||
    (windows.current.providerFailureRate !== null && windows.current.providerFailureRate >= thresholds.critical.providerFailureRate)
  ) {
    return "CRITICAL";
  }

  // Check DEGRADED conditions
  if (
    (current.oldestPendingAgeSeconds !== null && current.oldestPendingAgeSeconds >= thresholds.degraded.oldestPendingAgeSeconds) ||
    current.staleLeaseCount >= thresholds.degraded.staleLeaseCount ||
    windows.current.fencingBreaches >= thresholds.degraded.fencingBreaches ||
    (windows.current.providerFailureRate !== null && windows.current.providerFailureRate >= thresholds.degraded.providerFailureRate)
  ) {
    return "DEGRADED";
  }

  return "HEALTHY";
}
