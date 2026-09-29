/**
 * Sprint 7 — Deterministic 60/40 Hybrid Scoring Engine
 *
 * Formula:
 * finalScore = 0.60 * firmographicScore + 0.40 * intentScore
 *
 * Intent Score Mapping:
 * HIGH   = 1.0
 * MEDIUM = 0.6
 * LOW    = 0.2
 *
 * Pure, deterministic function without database, network, or LLM access.
 */

export type IntentTier = "HIGH" | "MEDIUM" | "LOW";

export const INTENT_TIER_SCORES: Readonly<Record<IntentTier, number>> = {
  HIGH: 1.0,
  MEDIUM: 0.6,
  LOW: 0.2,
};

const FIRMOGRAPHIC_WEIGHT = 0.60;
const INTENT_WEIGHT = 0.40;

export interface HybridScoreInput {
  readonly firmographicScore: number;
  readonly intentTier: IntentTier;
}

export function calculateHybridScore(input: HybridScoreInput): number {
  const firmographic = Math.max(0, Math.min(1, input.firmographicScore));
  const intentScore = INTENT_TIER_SCORES[input.intentTier] ?? 0.2;

  const rawScore = FIRMOGRAPHIC_WEIGHT * firmographic + INTENT_WEIGHT * intentScore;
  return Math.max(0, Math.min(1, Math.round(rawScore * 10_000) / 10_000));
}
