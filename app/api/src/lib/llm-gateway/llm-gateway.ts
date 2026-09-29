/**
 * LLM Gateway
 *
 * The single entry point for all LLM model calls in the system.
 *
 * CONTRACT:
 *   - Every call goes through `callGateway<T>()`.
 *   - The caller supplies a Zod `outputSchema`.
 *   - The gateway validates the raw model output before returning.
 *   - The return type is always `AgentProposal<T>` — never raw/unknown.
 *   - Nothing invalid may escape this gateway.
 *
 * RESPONSE MODES:
 *   "tool"        — use callGeminiWithTools; tools array is required.
 *   "structured"  — use callGemini with responseMimeType="application/json";
 *                   relies on Gemini's native JSON output mode.
 *   "text"        — use callGemini with free-form text, then parse JSON from response.
 *
 * PRISMA RULE:
 *   This file does NOT import prisma. The gateway is a pure transformation
 *   layer between the model API and the typed AgentProposal contract.
 *   DB commits happen in execution services that receive proposals.
 *
 * ERROR TAXONOMY:
 *   GatewayValidationError      — Zod rejected the model output
 *   GatewayTimeoutError         — model call timed out (mapped from GeminiPipelineError)
 *   GatewayProviderError        — provider-level error (rate limit, quota, blocked)
 *   GatewayMalformedResponseError — response could not be parsed before schema validation
 *   GatewayToolExecutionError   — a registered tool handler threw
 */

import { z } from "zod";
import {
  callGemini,
  callGeminiWithTools,
  GeminiPipelineError,
  type GeminiModel,
  type ToolDefinition,
} from "../../modules/gemini/gemini.client";
import { logger } from "../logger";
import {
  buildProposalId,
  type AgentProposal,
  type ProposalContext,
} from "./agent-proposal";
import { createProposalHash, DEFAULT_PROPOSAL_TTL_MS } from "./proposal-integrity";
import {
  GatewayValidationError,
  GatewayTimeoutError,
  GatewayProviderError,
  GatewayMalformedResponseError,
} from "./gateway-errors";

// ─── Response mode ────────────────────────────────────────────────────────────

/**
 * Explicit response mode — prevents the gateway from silently choosing the
 * wrong call path based on whether tools happen to be provided.
 *
 * "tool"        — function-calling mode via callGeminiWithTools.
 * "structured"  — Gemini native JSON output mode (responseMimeType=application/json).
 * "text"        — free-form text response with best-effort JSON extraction.
 */
export type GatewayResponseMode = "tool" | "structured" | "text";

// ─── Gateway call options ─────────────────────────────────────────────────────

export interface GatewayCallOptions<T> {
  agentName: string;
  model: GeminiModel;
  systemPrompt: string;
  userPrompt: string;

  /**
   * Explicit response mode. Required — no implicit defaults.
   * Choose "tool" if you supply tools[], "structured" for native JSON mode,
   * "text" if the model will embed JSON in a free-form response.
   */
  responseMode: GatewayResponseMode;

  /**
   * Zod schema that defines the valid output contract for this agent.
   * The gateway validates raw model output against this schema before returning.
   * If validation fails, GatewayValidationError is thrown — nothing invalid escapes.
   */
  outputSchema: z.ZodType<T>;

  /**
   * Tool definitions for "tool" mode. Required when responseMode="tool".
   * Ignored for "structured" and "text" modes.
   */
  tools?: ToolDefinition[];

  temperature?: number;

  /**
   * Contextual identifiers used to build the deterministic proposalId.
   * See ProposalContext for field semantics.
   */
  proposalContext?: ProposalContext;

  /**
   * Arbitrary metadata forwarded to the AITrace log entry.
   * Do not include PII or prompt content here.
   */
  metadata?: Record<string, unknown>;
}

// ─── Gateway call ─────────────────────────────────────────────────────────────

/**
 * Execute a validated LLM gateway call.
 *
 * @returns AgentProposal<T> — always schema-validated; T is inferred from outputSchema.
 * @throws GatewayValidationError — if model output fails Zod schema.
 * @throws GatewayTimeoutError — if the model call timed out.
 * @throws GatewayProviderError — if the provider returned a rate limit / block error.
 * @throws GatewayMalformedResponseError — if the response cannot be parsed before schema validation.
 */
export async function callGateway<T>(
  opts: GatewayCallOptions<T>,
): Promise<AgentProposal<T>> {
  const {
    agentName,
    model,
    systemPrompt,
    userPrompt,
    responseMode,
    outputSchema,
    tools,
    temperature,
    proposalContext,
    metadata,
  } = opts;

  const ctx = proposalContext ?? {};
  const proposalId = buildProposalId(agentName, ctx);

  // Validate mode/tools consistency
  if (responseMode === "tool" && (!tools || tools.length === 0)) {
    throw new GatewayValidationError(agentName, proposalId, [
      {
        code: "custom",
        message: "responseMode='tool' requires at least one tool definition",
        path: ["tools"],
      },
    ]);
  }

  let rawOutput: unknown;
  let tokenUsage: { input: number; output: number; total: number };
  let latencyMs: number;

  try {
    if (responseMode === "tool") {
      // ── Tool-calling mode ──────────────────────────────────────────────
      const result = await callGeminiWithTools<unknown>({
        agentName,
        model,
        systemPrompt,
        userPrompt,
        tools: tools!,
        temperature,
        metadata,
      });

      rawOutput = result.result;
      const promptTokens = (result as any).usage?.promptTokens ?? 0;
      const completionTokens = (result as any).usage?.completionTokens ?? 0;
      tokenUsage = {
        input: promptTokens,
        output: completionTokens,
        total: result.tokenUsage,
      };
      latencyMs = result.latencyMs;

    } else if (responseMode === "structured") {
      // ── Native JSON mode ───────────────────────────────────────────────
      const result = await callGemini({
        agentName,
        model,
        systemPrompt,
        userPrompt,
        temperature,
        metadata,
        responseMimeType: "application/json",
      });

      rawOutput = parseTextToJson(result.text, agentName, proposalId);
      tokenUsage = {
        input: result.usage?.promptTokens ?? 0,
        output: result.usage?.completionTokens ?? 0,
        total: result.tokenUsage,
      };
      latencyMs = result.latencyMs;

    } else {
      // ── Text mode (best-effort JSON extraction) ────────────────────────
      const result = await callGemini({
        agentName,
        model,
        systemPrompt,
        userPrompt,
        temperature,
        metadata,
      });

      rawOutput = parseTextToJson(result.text, agentName, proposalId);
      tokenUsage = {
        input: result.usage?.promptTokens ?? 0,
        output: result.usage?.completionTokens ?? 0,
        total: result.tokenUsage,
      };
      latencyMs = result.latencyMs;
    }

  } catch (err: unknown) {
    // ── Map gemini client errors → gateway error taxonomy ────────────────
    if (err instanceof GatewayValidationError ||
        err instanceof GatewayTimeoutError ||
        err instanceof GatewayProviderError ||
        err instanceof GatewayMalformedResponseError) {
      throw err; // already typed — re-throw
    }

    if (err instanceof GeminiPipelineError) {
      if (err.blocked) {
        throw new GatewayProviderError(agentName, proposalId, err.reason, { blocked: true });
      }
      if (err.message.includes("timed out")) {
        throw new GatewayTimeoutError(agentName, proposalId, 30_000);
      }
      const statusCode = extractStatusCode(err);
      throw new GatewayProviderError(agentName, proposalId, err.message, { statusCode });
    }

    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("timed out")) {
      throw new GatewayTimeoutError(agentName, proposalId, 30_000);
    }

    const rawStatusCode = extractStatusCode(err);
    throw new GatewayProviderError(agentName, proposalId, msg, {
      statusCode: rawStatusCode,
    });
  }

  // ── Zod schema validation ────────────────────────────────────────────────
  const parsed = outputSchema.safeParse(rawOutput);

  if (!parsed.success) {
    // IMPORTANT: Log only structured issue metadata — never the raw output.
    // Raw output may contain PII, customer email content, or scraped data.
    logger.warn(
      {
        agentName,
        proposalId,
        issues: parsed.error.issues.map((i) => ({
          path: i.path,
          code: i.code,
          message: i.message,
        })),
      },
      "[llm-gateway] Output schema validation failed",
    );
    throw new GatewayValidationError(agentName, proposalId, parsed.error.issues);
  }

  const validated = parsed.data;

  // ── Extract agentConfidence from payload if present ──────────────────────
  // Many schemas include a `confidence` field (model self-assessment).
  // We surface it as `agentConfidence` on the proposal — separated from any
  // downstream system confidence computation.
  let agentConfidence: number | undefined;
  if (
    validated !== null &&
    typeof validated === "object" &&
    "confidence" in (validated as object) &&
    typeof (validated as Record<string, unknown>).confidence === "number"
  ) {
    agentConfidence = (validated as Record<string, unknown>).confidence as number;
  }

  const proposedAt = new Date();
  const expiresAt = new Date(proposedAt.getTime() + DEFAULT_PROPOSAL_TTL_MS);
  const contextHash = ctx.contextHash ?? "";
  const requestFingerprint = ctx.requestFingerprint ?? "";

  const proposalHash = createProposalHash({
    agentName,
    requestFingerprint,
    contextHash,
    payload: validated,
    agentConfidence,
  });

  const proposal: AgentProposal<T> = {
    proposalId,
    agentName,
    payload: validated,
    agentConfidence,
    contextHash,
    proposedAt,
    expiresAt,
    tokenUsage,
    latencyMs,
    requestFingerprint,
    proposalHash,
  };

  logger.debug(
    {
      agentName,
      proposalId,
      agentConfidence,
      tokenUsage,
      latencyMs,
      responseMode,
    },
    "[llm-gateway] Proposal produced",
  );

  return proposal;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function parseTextToJson(text: string, agentName: string, proposalId: string): unknown {
  if (!text) {
    throw new GatewayMalformedResponseError(agentName, proposalId, "empty response text");
  }

  // Strip markdown fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1]! : text).trim();

  // Find first JSON object or array
  const objIdx = raw.indexOf("{");
  const arrIdx = raw.indexOf("[");
  let start = -1;
  if (arrIdx !== -1 && (objIdx === -1 || arrIdx < objIdx)) {
    start = arrIdx;
  } else if (objIdx !== -1) {
    start = objIdx;
  }

  const jsonStr = start !== -1 ? raw.slice(start) : raw;

  try {
    return JSON.parse(jsonStr);
  } catch {
    // Attempt newline fix inside strings
    try {
      const fixed = jsonStr.replace(/(?<=:\s*"[^"]*)\n(?=[^"]*")/g, "\\n");
      return JSON.parse(fixed);
    } catch {
      throw new GatewayMalformedResponseError(
        agentName,
        proposalId,
        `response is not parseable JSON (first 200 chars logged in debug mode)`,
      );
    }
  }
}

function extractStatusCode(err: unknown): number | undefined {
  if (err && typeof err === "object" && "status" in (err as object)) {
    const s = (err as Record<string, unknown>).status;
    return typeof s === "number" ? s : undefined;
  }
  return undefined;
}
