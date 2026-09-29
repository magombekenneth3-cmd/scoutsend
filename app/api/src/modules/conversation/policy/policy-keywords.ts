/**
 * Sprint 7 — Phrase-Aware Normalized Policy Patterns
 *
 * Rules avoid naive substring matches like text.includes("stop").
 * All patterns operate on normalized text (lowercased, collapsed whitespace,
 * expanded common contractions).
 */

export interface PolicyRule {
  readonly id: string;
  readonly name: string;
  readonly pattern: RegExp;
}

/**
 * Opt-Out Rules — Highest Precedence (OPT_OUT)
 */
export const OPT_OUT_RULES: readonly PolicyRule[] = [
  {
    id: "OPT_OUT_UNSUBSCRIBE_KEYWORD",
    name: "Explicit Unsubscribe Request",
    pattern: /\b(unsubscribe|opt[\s-]?out|remove\s+me|take\s+me\s+off(\s+your)?\s+list|delete\s+me\s+from\s+your\s+list)\b/i,
  },
  {
    id: "OPT_OUT_STOP_CONTACTING",
    name: "Stop Emailing/Contacting Command",
    pattern: /\bstop\s+(emailing|contacting|messaging|sending|reaching\s+out)(\s+to)?\s+me\b/i,
  },
  {
    id: "OPT_OUT_DO_NOT_CONTACT",
    name: "Do Not Contact Instruction",
    pattern: /\b(do\s+not|don'?t)\s+(email|contact|message|reach\s+out\s+to|follow[\s-]?up\s+with)\s+me\b/i,
  },
  {
    id: "OPT_OUT_NO_MORE_EMAILS",
    name: "No More Emails Request",
    pattern: /\bno\s+more\s+(emails?|messages?|contact|reach[\s-]?outs?)\b/i,
  },
  {
    id: "OPT_OUT_PLEASE_REMOVE",
    name: "Polite Removal Request",
    pattern: /\bplease\s+(remove|delete)\s+me\b/i,
  },
  {
    id: "OPT_OUT_NOT_INTERESTED_STOP",
    name: "Not Interested with Stop Command",
    pattern: /\bnot\s+interested[,.]?\s*(please\s+)?(stop|don'?t|remove|unsubscribe|no\s+more)\b/i,
  },
];

/**
 * Complaint Safety Rules — Second Precedence (COMPLAINT)
 */
export const COMPLAINT_RULES: readonly PolicyRule[] = [
  {
    id: "COMPLAINT_SPAM_REPORT",
    name: "Spam Complaint / Flag",
    pattern: /\b(report(ing)?(\s+[\w\s]{1,20})?\s+as\s+spam|this\s+is\s+spam|spam\s+complaint|marking\s+(this\s+as\s+)?spam|stop\s+spamming|report\s+(you|this)|went\s+to\s+spam)\b/i,
  },
  {
    id: "COMPLAINT_ABUSE_HARASSMENT",
    name: "Harassment / Abusive / Fraudulent Complaint",
    pattern: /\b(harassment|abusive|fraudulent|scam|unsolicited\s+spam)\b/i,
  },
  {
    id: "COMPLAINT_LEGAL_ACTION",
    name: "Legal Threat / Counsel Mention",
    pattern: /\b(legal\s+action|lawyer|attorney|cease\s+and\s+desist|suing|lawsuit)\b/i,
  },
  {
    id: "COMPLAINT_REGULATORY_VIOLATION",
    name: "GDPR / CAN-SPAM Regulatory Violation Signal",
    pattern: /\b(gdpr\s+violation|can-spam\s+violation|data\s+protection\s+complaint|illegal\s+email)\b/i,
  },
];

/**
 * Snooze / Delay Signal Patterns — Third Precedence (SNOOZE)
 */
export const SNOOZE_RULES: readonly PolicyRule[] = [
  {
    id: "SNOOZE_EXPLICIT_DELAY",
    name: "Explicit Delay Request",
    pattern: /\b(contact|reach(\s+back)?\s+out|follow\s+up|check\s+back|try\s+again)(\s+to)?\s*(me\s+)?(next|in|later)\b/i,
  },
  {
    id: "SNOOZE_RELATIVE_TIME",
    name: "Relative Time Snooze Signal",
    pattern: /\b(in|after)\s+\d+\s+(day|days|week|weeks|month|months)\b/i,
  },
  {
    id: "SNOOZE_NEXT_PERIOD",
    name: "Next Week / Month / Quarter Request",
    pattern: /\b(next\s+week|next\s+month|next\s+quarter|q[1-4]\s+next\s+year)\b/i,
  },
  {
    id: "SNOOZE_BUSY_TEMPORARY",
    name: "Temporary Business / Vacation Snooze",
    pattern: /\b(too\s+busy\s+right\s+now|bad\s+time|not\s+(interested\s+)?right\s+now|revisit\s+in|check\s+in\s+with\s+me\s+in|try\s+again\s+later)\b/i,
  },
];

/**
 * Helper to parse snooze target dates from temporal expressions.
 */
export function extractSnoozeDate(normalizedText: string, now: Date = new Date()): { targetDate: Date; reason: string } | null {
  const text = normalizedText.toLowerCase();

  // Pattern: "in X days / weeks / months"
  const relMatch = text.match(/\b(in|after)\s+(\d+)\s+(day|days|week|weeks|month|months)\b/i);
  if (relMatch) {
    const num = parseInt(relMatch[2], 10);
    const unit = relMatch[3].toLowerCase();
    const date = new Date(now.getTime());

    if (unit.startsWith("day")) {
      date.setDate(date.getDate() + num);
    } else if (unit.startsWith("week")) {
      date.setDate(date.getDate() + num * 7);
    } else if (unit.startsWith("month")) {
      date.setMonth(date.getMonth() + num);
    }
    return { targetDate: date, reason: relMatch[0] };
  }

  // Pattern: "next month"
  if (text.includes("next month")) {
    const date = new Date(now.getTime());
    date.setMonth(date.getMonth() + 1);
    return { targetDate: date, reason: "next month" };
  }

  // Pattern: "next quarter"
  if (text.includes("next quarter")) {
    const date = new Date(now.getTime());
    date.setMonth(date.getMonth() + 3);
    return { targetDate: date, reason: "next quarter" };
  }

  // Fallback snooze if snooze rule matched without explicit relative date (default 30 days)
  const defaultDate = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
  return { targetDate: defaultDate, reason: "temporary snooze requested" };
}
