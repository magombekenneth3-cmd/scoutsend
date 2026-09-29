/**
 * LLM Gateway — AgentProposal<T>
 *
 * Universal return type for all LLM gateway calls.
 *
 * Key design decisions:
 *
 * 1. `agentConfidence` — the raw score the model declared for its own output.
 *    This is NOT the system confidence used downstream in scoring or routing.
 *    Sprint 6/7 will compute:
 *      systemConfidence = f(deterministicEvidence, policy, agentConfidence, evidenceQuality)
 *    Keeping them separate now prevents accidental trust in raw model self-assessment.
 *
 * 2. `proposalId` — deterministic SHA-256 hash of
 *    `agentName:leadId:campaignId:requestFingerprint`.
 *    - `requestFingerprint` is caller-supplied and encodes the invocation
 *      identity (prompt hash, regeneration index, retry count, etc.).
 *    - Same (agent, lead, campaign, fingerprint) → same proposalId (idempotency).
 *    - Different fingerprint (different context, regen pass, updated data) → different id.
 *    - Sprint 6 will formalize `requestFingerprint` as the canonical context hash.
 *
 * 3. `tokenUsage.input` / `tokenUsage.output` — split rather than a single
 *    total, because input and output tokens have different pricing and rate-limit
 *    semantics. The gemini.client.ts already tracks both; we surface them here.
 *
 * 4. `payload: T` — always a Zod-validated value. Nothing from the raw model
 *    output can reach `payload` without passing the registered schema.
 */

import { createHash } from "node:crypto";

// ─── Core proposal interface ──────────────────────────────────────────────────

export interface AgentProposal<T> {
  /**
   * Deterministic proposal identity.
   * sha256(`${agentName}:${proposalContext.leadId ?? ""}:${proposalContext.campaignId ?? ""}:${requestFingerprint}`)
   */
  proposalId: string;

  /** Name of the agent that produced this proposal — matches `agentName` in AITrace. */
  agentName: string;

  /**
   * The Zod-validated proposal payload.
   * T is inferred from the `outputSchema` passed to `callGateway<T>()`.
   */
  payload: T;

  /**
   * Raw confidence score declared by the model for its own output (0.0–1.0).
   *
   * IMPORTANT: This is the model's self-assessment, NOT the system confidence.
   * Downstream services must NOT use this value directly as a trust score.
   * Sprint 6/7 computes `systemConfidence` separately.
   */
  agentConfidence?: number;

  /**
   * Optional chain-of-thought or reasoning text the model included.
   * Surfaced for debugging — not used in business logic.
   */
  reasoning?: string;

  /** UTC timestamp of when the proposal was produced. */
  proposedAt: Date;

  /** Token usage breakdown from the model API. */
  tokenUsage: {
    /** Tokens consumed by the prompt (input). Used for cost accounting. */
    input: number;
    /** Tokens produced by the model (output). Used for cost accounting. */
    output: number;
    /** input + output. Convenience total. */
    total: number;
  };

  /** End-to-end wall-clock time for the model call (milliseconds). */
  latencyMs: number;

  /**
   * Reserved field for Sprint 6 canonical context hash.
   * Populated with sha256 of the full canonical context bundle.
   */
  contextHash: string;

  /**
   * Invocation fingerprint — encodes caller-supplied request metadata.
   */
  requestFingerprint: string;

  /**
   * Cryptographic proposal hash derived from canonical payload, agentName, contextHash, and requestFingerprint.
   * Used for tamper detection at execution time.
   */
  proposalHash: string;

  /**
   * Expiration date/time after which this proposal must be rejected (TTL protection).
   */
  expiresAt: Date;
}

// ─── Proposal context ─────────────────────────────────────────────────────────

/**
 * Contextual identifiers used to build the deterministic `proposalId`.
 * All fields are optional — absent fields are encoded as empty strings in the hash.
 */
export interface ProposalContext {
  leadId?: string;
  campaignId?: string;
  contextHash?: string;
  /**
   * Invocation fingerprint — encodes the unique identity of this specific
   * generation request. Must differ between:
   *   - different generation passes (initial vs. regeneration)
   *   - different context snapshots (e.g. after lead data update)
   *   - retry attempts where context changed
   */
  requestFingerprint?: string;
}

// ─── proposalId construction ──────────────────────────────────────────────────

/**
 * Build a deterministic proposal identity.
 * Same (agentName, leadId, campaignId, contextHash, requestFingerprint) → same proposalId.
 * Different fingerprint/contextHash → different proposalId.
 */
export function buildProposalId(
  agentName: string,
  ctx: ProposalContext,
): string {
  const raw = [
    agentName,
    ctx.leadId ?? "",
    ctx.campaignId ?? "",
    ctx.contextHash ?? ctx.requestFingerprint ?? "",
  ].join(":");

  return createHash("sha256").update(raw).digest("hex");
}
