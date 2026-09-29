/**
 * Sprint 7 — Deterministic Policy Wall Types
 *
 * Policy Precedence:
 * OPT_OUT > COMPLAINT > SNOOZE > CONTINUE_TO_CLASSIFIER
 */

export type PolicyAction =
  | "OPT_OUT"
  | "COMPLAINT"
  | "SNOOZE"
  | "CONTINUE_TO_CLASSIFIER";

export interface PolicyDecision {
  readonly action: PolicyAction;
  readonly matchedRules: string[];
  readonly snoozeUntil?: Date;
  readonly snoozeReason?: string;
  readonly deterministic: true;
  readonly confidence: 1;
}
