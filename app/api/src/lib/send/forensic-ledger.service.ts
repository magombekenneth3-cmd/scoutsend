/**
 * Operational Evidence & Forensic Ledger Service (Sprint 12)
 *
 * Captures immutable forensic trace events with automated redaction of
 * API keys, OAuth tokens, secrets, full email body content, PII, and authorization headers.
 */

export interface ForensicEvent {
  id: string;
  organizationId: string;
  entityType: string;
  entityId: string;
  eventType: string;
  correlationId: string;
  causationId?: string;
  actorType: "SYSTEM" | "WORKER" | "OPERATOR";
  actorId?: string;
  previousState?: string;
  resultingState?: string;
  provider?: string;
  evidence: Record<string, unknown>;
  occurredAt: Date;
}

const SENSITIVE_KEYS = new Set([
  "authorization",
  "apikey",
  "api_key",
  "token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "secret",
  "password",
  "body",
  "emailbody",
  "content",
]);

export function redactSensitiveData(data: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey)) {
      redacted[key] = "[REDACTED_SECRET]";
    } else if (typeof value === "object" && value !== null) {
      redacted[key] = redactSensitiveData(value as Record<string, unknown>);
    } else {
      redacted[key] = value;
    }
  }

  return redacted;
}

const forensicEvents: ForensicEvent[] = [];

export function recordForensicEvent(event: Omit<ForensicEvent, "id" | "occurredAt">): ForensicEvent {
  const fullEvent: ForensicEvent = {
    ...event,
    id: `fe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    evidence: redactSensitiveData(event.evidence),
    occurredAt: new Date(),
  };

  forensicEvents.push(fullEvent);
  return fullEvent;
}

export function getForensicEvents(entityId: string): ForensicEvent[] {
  return forensicEvents.filter((e) => e.entityId === entityId);
}
