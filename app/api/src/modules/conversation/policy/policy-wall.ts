import { PolicyDecision } from "./policy-types";
import { evaluatePrecedence } from "./precedence-engine";

/**
 * Main Deterministic Policy Wall
 * Evaluates an inbound reply text against strict safety precedence:
 * OPT_OUT > COMPLAINT > SNOOZE > CONTINUE_TO_CLASSIFIER
 *
 * Guaranteed 0 LLM calls, 100% deterministic, PII-safe evaluation.
 */
export function evaluatePolicyWall(replyText: string, referenceDate: Date = new Date()): PolicyDecision {
  return evaluatePrecedence(replyText, referenceDate);
}

export type { PolicyDecision, PolicyAction } from "./policy-types";
