import assert from "node:assert/strict";
import { decaySignal } from "./temporal-decay";
import { calculateHybridScore } from "./hybrid-scoring";

console.log("Running Scoring Engine Tests...");

// 1. Temporal Decay — Age 0 returns original score
{
  const initial = 0.8;
  const decayed = decaySignal(initial, 0);
  assert.equal(decayed, 0.8);
}

// 2. Temporal Decay — Increasing age decreases score monotonically
{
  const day0 = decaySignal(0.9, 0);
  const day10 = decaySignal(0.9, 10);
  const day30 = decaySignal(0.9, 30);

  assert.ok(day10 < day0, "Day 10 should be less than Day 0");
  assert.ok(day30 < day10, "Day 30 should be less than Day 10");
  assert.ok(day30 >= 0, "Decayed score must remain non-negative");
}

// 3. Hybrid Scoring — Formula 0.6 * Firmo + 0.4 * Intent
{
  // Firmo = 0.8, Intent = HIGH (1.0) -> 0.6 * 0.8 + 0.4 * 1.0 = 0.48 + 0.40 = 0.88
  const score1 = calculateHybridScore({ firmographicScore: 0.8, intentTier: "HIGH" });
  assert.equal(score1, 0.88);

  // Firmo = 0.5, Intent = MEDIUM (0.6) -> 0.6 * 0.5 + 0.4 * 0.6 = 0.30 + 0.24 = 0.54
  const score2 = calculateHybridScore({ firmographicScore: 0.5, intentTier: "MEDIUM" });
  assert.equal(score2, 0.54);

  // Firmo = 0.0, Intent = LOW (0.2) -> 0.6 * 0 + 0.4 * 0.2 = 0.08
  const score3 = calculateHybridScore({ firmographicScore: 0.0, intentTier: "LOW" });
  assert.equal(score3, 0.08);
}

// 4. Hybrid Scoring — Bounds checking [0, 1]
{
  const maxScore = calculateHybridScore({ firmographicScore: 1.0, intentTier: "HIGH" });
  assert.equal(maxScore, 1.0);

  const minScore = calculateHybridScore({ firmographicScore: 0.0, intentTier: "LOW" });
  assert.ok(minScore >= 0 && minScore <= 1);
}

console.log("✅ All Scoring Engine Tests Passed Cleanly!");
