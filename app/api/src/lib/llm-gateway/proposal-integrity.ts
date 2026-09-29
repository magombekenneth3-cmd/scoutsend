/**
 * Sprint 8 — LLM Gateway Proposal Integrity & Expiration Engine
 *
 * KEY INVARIANTS:
 * 1. Semantic Hashing — proposalHash is derived from (agentName, requestFingerprint, contextHash, payload, agentConfidence).
 * 2. Volatile Telemetry Exclusion — proposedAt, expiresAt, latencyMs, tokenUsage are excluded from hash.
 * 3. Canonicalization — Reuses Sprint 6 canonicalize() algorithm for deterministic object key sorting.
 * 4. Expiration TTL — Rejects proposals past expiresAt (default 15 minutes).
 */

import { createHash } from "node:crypto";
import { canonicalize } from "./context-hash";
import type { AgentProposal } from "./agent-proposal";

/** Default proposal TTL: 15 minutes (in milliseconds). */
export const DEFAULT_PROPOSAL_TTL_MS = 15 * 60 * 1000;

export interface ProposalIntegrityInput {
  agentName: string;
  requestFingerprint: string;
  contextHash: string;
  payload: unknown;
  agentConfidence?: number;
}

/**
 * Computes a deterministic SHA-256 proposalHash for a proposal's semantic contents.
 */
export function createProposalHash(input: ProposalIntegrityInput): string {
  const semanticBundle = {
    agentName: input.agentName,
    requestFingerprint: input.requestFingerprint,
    contextHash: input.contextHash,
    agentConfidence: input.agentConfidence ?? null,
    payload: input.payload,
  };

  const canonicalString = canonicalize(semanticBundle);
  return createHash("sha256").update(canonicalString).digest("hex");
}

/**
 * Verifies that a proposal's stored proposalHash matches the recomputed hash over its current payload.
 * Detects post-generation payload or metadata tampering.
 */
export function verifyProposalIntegrity(proposal: AgentProposal<unknown>): boolean {
  if (!proposal.proposalHash) return false;

  const expectedHash = createProposalHash({
    agentName: proposal.agentName,
    requestFingerprint: proposal.requestFingerprint,
    contextHash: proposal.contextHash,
    payload: proposal.payload,
    agentConfidence: proposal.agentConfidence,
  });

  return proposal.proposalHash === expectedHash;
}

/**
 * Checks whether a proposal has passed its expiration timestamp.
 */
export function isProposalExpired(
  proposal: Pick<AgentProposal<unknown>, "expiresAt">,
  now: Date = new Date(),
): boolean {
  if (!proposal.expiresAt) return true;
  return now.getTime() >= proposal.expiresAt.getTime();
}
