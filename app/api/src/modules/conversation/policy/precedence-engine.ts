import { PolicyDecision, PolicyAction } from "./policy-types";
import {
  OPT_OUT_RULES,
  COMPLAINT_RULES,
  SNOOZE_RULES,
  extractSnoozeDate,
} from "./policy-keywords";

/**
 * Normalizes input text for phrase-aware pattern matching.
 * Expands common contractions, lowercases text, and normalizes whitespace.
 */
export function normalizeReplyText(rawText: string): string {
  if (!rawText) return "";

  let text = rawText.toLowerCase().trim();

  // Expand contractions for predictable regex boundaries
  text = text
    .replace(/\bdon'?t\b/g, "do not")
    .replace(/\bcan'?t\b/g, "cannot")
    .replace(/\bwon'?t\b/g, "will not")
    .replace(/\bshouldn'?t\b/g, "should not")
    .replace(/\bwouldn'?t\b/g, "would not")
    .replace(/\bisn'?t\b/g, "is not")
    .replace(/\baren'?t\b/g, "are not")
    .replace(/\bi'?m\b/g, "i am")
    .replace(/\byou'?re\b/g, "you are")
    .replace(/\bplease\b/g, "please");

  // Collapse multiple whitespace
  return text.replace(/\s+/g, " ");
}

/**
 * Deterministic Precedence Engine
 * Evaluates rules strictly in precedence order:
 * OPT_OUT > COMPLAINT > SNOOZE > CONTINUE_TO_CLASSIFIER
 */
export function evaluatePrecedence(rawReplyText: string, referenceDate: Date = new Date()): PolicyDecision {
  const normalized = normalizeReplyText(rawReplyText);

  if (!normalized) {
    return {
      action: "CONTINUE_TO_CLASSIFIER",
      matchedRules: [],
      deterministic: true,
      confidence: 1,
    };
  }

  // 1. OPT_OUT (Highest Precedence)
  const matchedOptOutRules: string[] = [];
  for (const rule of OPT_OUT_RULES) {
    if (rule.pattern.test(normalized)) {
      matchedOptOutRules.push(rule.id);
    }
  }

  if (matchedOptOutRules.length > 0) {
    return {
      action: "OPT_OUT",
      matchedRules: matchedOptOutRules,
      deterministic: true,
      confidence: 1,
    };
  }

  // 2. COMPLAINT (Second Precedence)
  const matchedComplaintRules: string[] = [];
  for (const rule of COMPLAINT_RULES) {
    if (rule.pattern.test(normalized)) {
      matchedComplaintRules.push(rule.id);
    }
  }

  if (matchedComplaintRules.length > 0) {
    return {
      action: "COMPLAINT",
      matchedRules: matchedComplaintRules,
      deterministic: true,
      confidence: 1,
    };
  }

  // 3. SNOOZE (Third Precedence)
  const matchedSnoozeRules: string[] = [];
  for (const rule of SNOOZE_RULES) {
    if (rule.pattern.test(normalized)) {
      matchedSnoozeRules.push(rule.id);
    }
  }

  if (matchedSnoozeRules.length > 0) {
    const snoozeDetails = extractSnoozeDate(normalized, referenceDate);
    return {
      action: "SNOOZE",
      matchedRules: matchedSnoozeRules,
      snoozeUntil: snoozeDetails?.targetDate,
      snoozeReason: snoozeDetails?.reason,
      deterministic: true,
      confidence: 1,
    };
  }

  // 4. CONTINUE_TO_CLASSIFIER (Default if no deterministic policy triggered)
  return {
    action: "CONTINUE_TO_CLASSIFIER",
    matchedRules: [],
    deterministic: true,
    confidence: 1,
  };
}
