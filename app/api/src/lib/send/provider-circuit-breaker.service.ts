/**
 * Provider Circuit Breaker Service (Sprint 12)
 *
 * Implements gating-only circuit breakers for outbound providers.
 * Manages CLOSED -> OPEN -> HALF_OPEN state transitions with fenced
 * single-probe leases.
 *
 * INVARIANT: The circuit breaker NEVER mutates historical SendIntent state.
 * It only gates future dispatch authorization.
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitMetrics {
  providerName: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  lastStateChangeAt: Date;
  probeLeaseOwner?: string | null;
  probeLeaseExpiresAt?: Date | null;
}

const circuitStore = new Map<string, CircuitMetrics>();
const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 30_000;
const PROBE_TTL_MS = 10_000;

export function getCircuitState(providerName: string): CircuitState {
  const metrics = circuitStore.get(providerName);
  if (!metrics) return "CLOSED";

  const now = new Date();
  if (metrics.state === "OPEN") {
    if (now.getTime() - metrics.lastStateChangeAt.getTime() > COOLDOWN_MS) {
      metrics.state = "HALF_OPEN";
      metrics.lastStateChangeAt = now;
    }
  }

  return metrics.state;
}

export function claimHalfOpenProbe(params: {
  providerName: string;
  workerId: string;
}): { granted: boolean } {
  const { providerName, workerId } = params;
  const state = getCircuitState(providerName);
  if (state !== "HALF_OPEN") return { granted: false };

  const metrics = circuitStore.get(providerName)!;
  const now = new Date();

  if (metrics.probeLeaseOwner && metrics.probeLeaseExpiresAt && metrics.probeLeaseExpiresAt > now) {
    return { granted: false };
  }

  metrics.probeLeaseOwner = workerId;
  metrics.probeLeaseExpiresAt = new Date(now.getTime() + PROBE_TTL_MS);
  return { granted: true };
}

export function recordDispatchResult(params: {
  providerName: string;
  success: boolean;
  workerId?: string;
}): void {
  const { providerName, success, workerId } = params;
  const now = new Date();

  let metrics = circuitStore.get(providerName);
  if (!metrics) {
    metrics = {
      providerName,
      state: "CLOSED",
      failureCount: 0,
      successCount: 0,
      lastStateChangeAt: now,
    };
    circuitStore.set(providerName, metrics);
  }

  if (success) {
    if (metrics.state === "HALF_OPEN" && metrics.probeLeaseOwner === workerId) {
      metrics.state = "CLOSED";
      metrics.failureCount = 0;
      metrics.successCount = 0;
      metrics.probeLeaseOwner = null;
      metrics.probeLeaseExpiresAt = null;
      metrics.lastStateChangeAt = now;
    } else if (metrics.state === "CLOSED") {
      metrics.successCount++;
    }
  } else {
    metrics.failureCount++;
    if (metrics.state === "HALF_OPEN") {
      metrics.state = "OPEN";
      metrics.probeLeaseOwner = null;
      metrics.probeLeaseExpiresAt = null;
      metrics.lastStateChangeAt = now;
    } else if (metrics.failureCount >= FAILURE_THRESHOLD) {
      metrics.state = "OPEN";
      metrics.lastStateChangeAt = now;
    }
  }
}
