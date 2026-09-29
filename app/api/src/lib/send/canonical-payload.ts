import { createHash } from "crypto";

export interface CanonicalOutboundPayload {
  recipientEmail: string;
  fromAddress: string;
  replyTo?: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  unsubscribeFooter: string;
  provider: string;
  mailboxId: string;
  inReplyTo?: string;
  references?: string;
  headers?: Record<string, string>;
}

function sortObjectKeys(obj: Record<string, unknown>): Record<string, unknown> {
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj).sort()) {
    const val = obj[key];
    if (val !== null && val !== undefined && typeof val === "object" && !Array.isArray(val)) {
      sorted[key] = sortObjectKeys(val as Record<string, unknown>);
    } else {
      sorted[key] = val;
    }
  }
  return sorted;
}

export function canonicalizePayload(payload: CanonicalOutboundPayload): string {
  const normalized: Record<string, unknown> = {
    recipientEmail: payload.recipientEmail.trim().toLowerCase(),
    fromAddress: payload.fromAddress.trim(),
    subject: payload.subject.trim(),
    textBody: payload.textBody.trim(),
    htmlBody: payload.htmlBody.trim(),
    unsubscribeFooter: payload.unsubscribeFooter.trim(),
    provider: payload.provider.trim().toUpperCase(),
    mailboxId: payload.mailboxId.trim(),
  };

  if (payload.replyTo) normalized.replyTo = payload.replyTo.trim();
  if (payload.inReplyTo) normalized.inReplyTo = payload.inReplyTo.trim();
  if (payload.references) normalized.references = payload.references.trim();
  if (payload.headers && Object.keys(payload.headers).length > 0) {
    normalized.headers = sortObjectKeys(payload.headers);
  }

  return JSON.stringify(sortObjectKeys(normalized));
}

export function hashPayload(payload: CanonicalOutboundPayload): string {
  const canonical = canonicalizePayload(payload);
  return createHash("sha256").update(canonical).digest("hex");
}

export function freezePayload(
  payload: CanonicalOutboundPayload,
): { frozen: Readonly<CanonicalOutboundPayload>; hash: string } {
  const hash = hashPayload(payload);
  const frozen = Object.freeze({ ...payload });
  return { frozen, hash };
}
