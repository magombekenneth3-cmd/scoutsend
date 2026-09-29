/**
 * Sprint 7 — Temporal Signal Decay Engine
 *
 * Implements exponential decay formula:
 * S(t) = S0 * e^(-lambda * t)
 *
 * Pure, deterministic function without database, network, or LLM access.
 */

const DEFAULT_LAMBDA = 0.05; // Default half-life ~14 days

export function decaySignal(
  initialScore: number,
  ageDays: number,
  lambda: number = DEFAULT_LAMBDA,
): number {
  if (isNaN(initialScore) || isNaN(ageDays) || isNaN(lambda)) {
    throw new Error("[temporal-decay] Invalid numeric input: inputs cannot be NaN");
  }

  const clampedInitial = Math.max(0, Math.min(1, initialScore));
  const safeAgeDays = Math.max(0, ageDays);
  const safeLambda = Math.max(0, lambda);

  if (safeAgeDays === 0) {
    return clampedInitial;
  }

  const decayed = clampedInitial * Math.exp(-safeLambda * safeAgeDays);
  return Math.max(0, Math.min(1, decayed));
}
