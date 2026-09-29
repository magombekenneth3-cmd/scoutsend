import assert from "node:assert/strict";
import { ReplyIntentSchema } from "./classify-reply.agent";

console.log("Running Classifier Agent Schema Tests...");

// 1. Valid POSITIVE intent schema validation
{
  const validPayload = {
    intent: "POSITIVE",
    intentTier: "HIGH",
    confidence: 0.95,
    evidence: ["Interested in learning more"],
    buyingStage: "CONSIDERATION",
    painPoints: ["Scaling email infrastructure"],
    competitorsMentioned: [],
    budgetSignal: null,
    timelineSignal: "Q3 budget available",
  };

  const parsed = ReplyIntentSchema.safeParse(validPayload);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.intent, "POSITIVE");
    assert.equal(parsed.data.intentTier, "HIGH");
    assert.equal(parsed.data.confidence, 0.95);
  }
}

// 2. Valid QUESTION intent schema validation
{
  const validPayload = {
    intent: "QUESTION",
    intentTier: "MEDIUM",
    confidence: 0.82,
    evidence: ["How much does it cost?"],
    buyingStage: "AWARENESS",
  };

  const parsed = ReplyIntentSchema.safeParse(validPayload);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.intent, "QUESTION");
    assert.equal(parsed.data.intentTier, "MEDIUM");
    assert.deepEqual(parsed.data.painPoints, []);
  }
}

// 3. Invalid enum value rejection
{
  const invalidPayload = {
    intent: "INVALID_INTENT",
    intentTier: "HIGH",
    confidence: 0.9,
    evidence: ["test"],
  };

  const parsed = ReplyIntentSchema.safeParse(invalidPayload);
  assert.equal(parsed.success, false);
}

// 4. Invalid confidence out of range [0, 1]
{
  const invalidConfidence = {
    intent: "POSITIVE",
    intentTier: "HIGH",
    confidence: 1.5,
    evidence: ["test"],
  };

  const parsed = ReplyIntentSchema.safeParse(invalidConfidence);
  assert.equal(parsed.success, false);
}

console.log("✅ All Classifier Agent Schema Tests Passed Cleanly!");
