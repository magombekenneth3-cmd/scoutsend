/**
 * LLM Gateway — Error Taxonomy
 *
 * Provides a typed error hierarchy for all gateway failure modes.
 * Downstream code (workers, sweepers, circuit breakers) must never
 * catch raw Gemini exceptions — only these typed errors.
 *
 * Error hierarchy:
 *   GatewayError (base)
 *   ├── GatewayValidationError   — Zod schema rejected model output
 *   ├── GatewayTimeoutError      — model call exceeded timeout budget
 *   ├── GatewayProviderError     — provider-level 4xx/5xx (rate limit, quota, block)
 *   ├── GatewayMalformedResponseError — model returned unparseable output
 *   └── GatewayToolExecutionError    — a registered tool handler threw
 */

import type { ZodIssue } from "zod";

// ─── Base ─────────────────────────────────────────────────────────────────────

export class GatewayError extends Error {
  public readonly agentName: string;
  public readonly proposalId: string;
  public readonly statusCode: number;

  constructor(message: string, agentName: string, proposalId: string, statusCode = 500) {
    super(message);
    this.name = "GatewayError";
    this.agentName = agentName;
    this.proposalId = proposalId;
    this.statusCode = statusCode;
    // Maintain proper prototype chain in compiled JS
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Thrown when the model's output fails the Zod schema that was registered
 * for this call. The `issues` array contains structured Zod issue objects
 * (path + code + message) — NOT the raw model payload.
 *
 * IMPORTANT: Never log the raw model output here. It may contain PII,
 * scraped customer data, or injected prompt content. Log only structured
 * Zod issue paths.
 */
export class GatewayValidationError extends GatewayError {
  /** Structured Zod issue descriptors. Safe to log — no raw payload values. */
  public readonly issues: ReadonlyArray<SafeZodIssue>;

  constructor(
    agentName: string,
    proposalId: string,
    issues: ZodIssue[],
  ) {
    const summary = issues.map((i) => `[${i.path.join(".")}] ${i.message}`).join("; ");
    super(`LLM output schema validation failed: ${summary}`, agentName, proposalId, 422);
    this.name = "GatewayValidationError";
    this.issues = issues.map(toSafeIssue);
  }
}

/**
 * A redacted Zod issue — contains only structural metadata (path, code, message)
 * and never the received value. Safe to log to any observability backend.
 */
export interface SafeZodIssue {
  /** JSON path segments: e.g. ["payload", "subject"] */
  path: (string | number)[];
  /** Zod error code: e.g. "too_small", "invalid_type" */
  code: string;
  /** Human-readable message */
  message: string;
}

function toSafeIssue(issue: ZodIssue): SafeZodIssue {
  return {
    path: issue.path as (string | number)[],
    code: issue.code,
    message: issue.message,
  };
}

// ─── Timeout ─────────────────────────────────────────────────────────────────

/**
 * Thrown when a model call exceeds the gateway's timeout budget.
 * Callers should apply retry-with-backoff for this error class.
 */
export class GatewayTimeoutError extends GatewayError {
  public readonly timeoutMs: number;

  constructor(agentName: string, proposalId: string, timeoutMs: number) {
    super(
      `LLM gateway timeout: ${agentName} exceeded ${timeoutMs}ms budget`,
      agentName,
      proposalId,
      504,
    );
    this.name = "GatewayTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

// ─── Provider ────────────────────────────────────────────────────────────────

/**
 * Thrown for provider-level errors from the Gemini API:
 * rate limits (429), quota exceeded, content blocked, authentication failures.
 *
 * The `blocked` flag indicates that the provider actively refused the request
 * (content policy) rather than a transient infrastructure failure.
 */
export class GatewayProviderError extends GatewayError {
  public readonly blocked: boolean;

  constructor(
    agentName: string,
    proposalId: string,
    message: string,
    opts: { statusCode?: number; blocked?: boolean } = {},
  ) {
    super(`LLM provider error: ${message}`, agentName, proposalId, opts.statusCode ?? 503);
    this.name = "GatewayProviderError";
    this.blocked = opts.blocked ?? false;
  }
}

// ─── Malformed Response ──────────────────────────────────────────────────────

/**
 * Thrown when the model returns a non-empty response that cannot be parsed
 * as JSON or does not match any expected structure — before Zod validation.
 *
 * Distinguished from GatewayValidationError (which has a valid JSON object
 * that fails schema constraints) in that the raw text is un-parseable.
 */
export class GatewayMalformedResponseError extends GatewayError {
  constructor(agentName: string, proposalId: string, detail: string) {
    super(
      `LLM gateway received malformed response: ${detail}`,
      agentName,
      proposalId,
    );
    this.name = "GatewayMalformedResponseError";
  }
}

// ─── Tool Execution ──────────────────────────────────────────────────────────

/**
 * Thrown when a registered tool handler (ToolDefinition.handler) throws
 * during a tool-calling turn. The gateway wraps the original error and
 * surfaces it here so the caller can distinguish tool failures from model
 * failures.
 */
export class GatewayToolExecutionError extends GatewayError {
  public readonly toolName: string;
  public readonly cause: unknown;

  constructor(
    agentName: string,
    proposalId: string,
    toolName: string,
    cause: unknown,
  ) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `LLM tool execution failed in ${agentName}::${toolName}: ${detail}`,
      agentName,
      proposalId,
    );
    this.name = "GatewayToolExecutionError";
    this.toolName = toolName;
    this.cause = cause;
  }
}

// ─── Context Mismatch ────────────────────────────────────────────────────────

/**
 * Thrown when a proposal's context hash does not match the recomputed context
 * hash at execution time (TOCTOU protection).
 *
 * SECURITY INVARIANT:
 * Does NOT expose raw PII, lead contents, campaign contents, or prompt content.
 * Surfaces only expectedHash, actualHash, agentName, and proposalId.
 */
export class GatewayContextMismatchError extends GatewayError {
  public readonly expectedHash: string;
  public readonly actualHash: string;

  constructor(
    agentName: string,
    proposalId: string,
    expectedHash: string,
    actualHash: string,
  ) {
    super(
      `LLM proposal context mismatch for ${agentName} (${proposalId}): expected ${expectedHash.slice(0, 8)}, got ${actualHash.slice(0, 8)}`,
      agentName,
      proposalId,
    );
    this.name = "GatewayContextMismatchError";
    this.expectedHash = expectedHash;
    this.actualHash = actualHash;
  }
}

// ─── Integrity Mismatch ──────────────────────────────────────────────────────

/**
 * Thrown when a proposal's proposalHash does not match the recomputed hash
 * over its semantic payload and context (payload tampering detection).
 */
export class GatewayIntegrityError extends GatewayError {
  constructor(agentName: string, proposalId: string) {
    super(
      `LLM proposal integrity check failed for ${agentName} (${proposalId}) — payload or metadata tampering detected`,
      agentName,
      proposalId,
    );
    this.name = "GatewayIntegrityError";
  }
}

// ─── Proposal Expired ────────────────────────────────────────────────────────

/**
 * Thrown when an execution attempt occurs past the proposal's expiresAt TTL.
 */
export class GatewayExpiredProposalError extends GatewayError {
  public readonly expiresAt: Date;

  constructor(agentName: string, proposalId: string, expiresAt: Date) {
    super(
      `LLM proposal expired for ${agentName} (${proposalId}) — expired at ${expiresAt.toISOString()}`,
      agentName,
      proposalId,
    );
    this.name = "GatewayExpiredProposalError";
    this.expiresAt = expiresAt;
  }
}

// ─── Proposal Already Executed ────────────────────────────────────────────────

/**
 * Thrown when attempting to execute a proposal that has already completed execution.
 */
export class GatewayAlreadyExecutedError extends GatewayError {
  constructor(agentName: string, proposalId: string) {
    super(
      `LLM proposal ${proposalId} has already completed execution — duplicate execution rejected`,
      agentName,
      proposalId,
    );
    this.name = "GatewayAlreadyExecutedError";
  }
}

// ─── Execution Conflict (Concurrency Race) ───────────────────────────────────

/**
 * Thrown when a concurrent execution attempt loses the database race.
 */
export class GatewayExecutionConflictError extends GatewayError {
  constructor(agentName: string, proposalId: string) {
    super(
      `LLM proposal execution conflict for ${agentName} (${proposalId}) — another worker is currently executing this proposal`,
      agentName,
      proposalId,
    );
    this.name = "GatewayExecutionConflictError";
  }
}


