/**
 * LLM Gateway — Canonical Context Hashing Engine
 *
 * Provides deterministic canonical serialization and SHA-256 context hashing
 * to prevent TOCTOU (Time-of-Check to Time-of-Use) vulnerabilities and ensure
 * LLM proposals are bound to an immutable context snapshot.
 *
 * KEY INVARIANTS:
 * 1. Recursive key sorting — Object property insertion order does NOT change the resulting hash.
 * 2. Array order preservation — Array element order IS semantic and preserved.
 * 3. Volatile field exclusion — Transient fields (createdAt, updatedAt, lastSeenAt) are omitted.
 * 4. Versioning — Every context hash includes a explicit structure version ("v1").
 */

import { createHash } from "node:crypto";

export const DEFAULT_CONTEXT_HASH_VERSION = "v1";

/** Volatile keys that must be stripped from canonical hash computation. */
const VOLATILE_KEYS = new Set([
  "createdAt",
  "updatedAt",
  "lastSeenAt",
  "deletedAt",
  "fetchedAt",
]);

/**
 * Deterministically stringifies any JavaScript value into a canonical representation.
 * - Object properties are sorted alphabetically by key.
 * - Undefined object values and volatile timestamp fields are omitted.
 * - Array element ordering is strictly preserved.
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) {
    return "null";
  }

  if (typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }

  if (typeof value === "string") {
    return JSON.stringify(value);
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item));
    return `[${items.join(",")}]`;
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sortedKeys = Object.keys(obj)
      .filter((key) => !VOLATILE_KEYS.has(key) && obj[key] !== undefined)
      .sort();

    const entries = sortedKeys.map(
      (key) => `${JSON.stringify(key)}:${canonicalize(obj[key])}`,
    );

    return `{${entries.join(",")}`;
  }

  return JSON.stringify(String(value));
}

export interface ContextHashOptions {
  version?: string;
}

/**
 * Generates a deterministic SHA-256 hash for a given context bundle.
 */
export function createContextHash(
  contextBundle: Record<string, unknown>,
  options?: ContextHashOptions,
): string {
  const version = options?.version ?? DEFAULT_CONTEXT_HASH_VERSION;
  const bundleWithVersion = {
    version,
    ...contextBundle,
  };

  const canonicalString = canonicalize(bundleWithVersion);
  return createHash("sha256").update(canonicalString).digest("hex");
}

/**
 * Input fields for building a message generation context bundle.
 */
export interface GenerationContextInput {
  lead: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    title?: string | null;
    companyName?: string | null;
    website?: string | null;
    qualificationScore?: number | null;
    qualificationReason?: string | null;
    signals?: Array<{ signalType: string; value: string; confidence: number }>;
  };
  campaign: {
    id: string;
    name: string;
    icpDescription: string;
    targetIndustry?: string | null;
    targetRegion?: string | null;
    businessDescription?: string | null;
    valueProposition?: string | null;
  };
  senderDomain?: string;
  tone?: string;
  feedbackContext?: string;
}

/**
 * Builds a clean, canonical context bundle specifically for cold email message generation.
 * Strips non-semantic volatile data so database timestamps do not invalidate valid proposals.
 */
export function buildMessageGenerationContextBundle(
  input: GenerationContextInput,
): Record<string, unknown> {
  // NOTE: tone and feedbackContext are intentionally excluded from the hash.
  // They are request-time caller preferences, not authoritative data. The
  // TOCTOU guard protects against lead/campaign data mutations between
  // proposal generation and execution — including preferences would cause
  // every toned request to produce a false context mismatch.
  return {
    agentName: "generate.message-writer",
    promptVersion: "v1",
    lead: {
      id: input.lead.id,
      firstName: input.lead.firstName ?? "",
      lastName: input.lead.lastName ?? "",
      email: input.lead.email ?? "",
      title: input.lead.title ?? "",
      companyName: input.lead.companyName ?? "",
      website: input.lead.website ?? "",
      qualificationScore: input.lead.qualificationScore ?? null,
      qualificationReason: input.lead.qualificationReason ?? "",
      signals: (input.lead.signals ?? []).map((s) => ({
        signalType: s.signalType,
        value: s.value,
        confidence: s.confidence,
      })),
    },
    campaign: {
      id: input.campaign.id,
      name: input.campaign.name,
      icpDescription: input.campaign.icpDescription,
      targetIndustry: input.campaign.targetIndustry ?? "",
      targetRegion: input.campaign.targetRegion ?? "",
      businessDescription: input.campaign.businessDescription ?? "",
      valueProposition: input.campaign.valueProposition ?? "",
    },
    senderDomain: input.senderDomain ?? "",
  };
}
