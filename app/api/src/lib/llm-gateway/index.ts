/**
 * LLM Gateway — Public API
 *
 * Import everything related to the gateway from this barrel.
 * Never import from individual gateway files directly.
 */

// ─── Gateway call ─────────────────────────────────────────────────────────────
export { callGateway } from "./llm-gateway";
export type { GatewayCallOptions, GatewayResponseMode } from "./llm-gateway";

// ─── AgentProposal ────────────────────────────────────────────────────────────
export type { AgentProposal, ProposalContext } from "./agent-proposal";
export { buildProposalId } from "./agent-proposal";

// ─── Context Hashing & Proposal Integrity ─────────────────────────────────────
export {
  createContextHash,
  canonicalize,
  buildMessageGenerationContextBundle,
} from "./context-hash";
export type { GenerationContextInput, ContextHashOptions } from "./context-hash";
export {
  createProposalHash,
  verifyProposalIntegrity,
  isProposalExpired,
  DEFAULT_PROPOSAL_TTL_MS,
} from "./proposal-integrity";
export type { ProposalIntegrityInput } from "./proposal-integrity";

// ─── Error taxonomy ───────────────────────────────────────────────────────────
export {
  GatewayError,
  GatewayValidationError,
  GatewayTimeoutError,
  GatewayProviderError,
  GatewayMalformedResponseError,
  GatewayToolExecutionError,
  GatewayContextMismatchError,
  GatewayIntegrityError,
  GatewayExpiredProposalError,
  GatewayAlreadyExecutedError,
  GatewayExecutionConflictError,
} from "./gateway-errors";
export type { SafeZodIssue } from "./gateway-errors";

// ─── Schemas ──────────────────────────────────────────────────────────────────
export {
  GeneratedMessageSchema,
  CtaTierSchema,
  StructuredFactsSchema,
  FollowupMessageSchema,
  // Agent output schemas — P0-1 migration
  HealthAssessmentSchema,
  ObjectionAnalysisSchema,
  DraftReplyOutputSchema,
  FollowUpOutputSchema,
  TechStackResultSchema,
  IntentQueriesSchema,
  CommunityLeadRawSchema,
  CommunityLeadArraySchema,
  JobSignalItemSchema,
  JobSignalArraySchema,
  // Agent output schemas — P0-A/P0-B (State 6)
  QualityEvaluatorOutputSchema,
  QualityRewriterOutputSchema,
  EnrichmentNewSignalSchema,
  EnrichmentDiffOutputSchema,
} from "./schemas";
export type {
  GeneratedMessage,
  CtaTier,
  StructuredFacts,
  FollowupMessage,
  // Agent output types — P0-1 migration
  HealthAssessmentOutput,
  ObjectionAnalysisOutput,
  DraftReplyOutput,
  FollowUpOutput,
  TechStackResultOutput,
  IntentQueriesOutput,
  CommunityLeadRawOutput,
  CommunityLeadArrayOutput,
  JobSignalItemOutput,
  JobSignalArrayOutput,
  // Agent output types — P0-A/P0-B (State 6)
  QualityEvaluatorOutput,
  QualityRewriterOutput,
  EnrichmentDiffOutput,
} from "./schemas";
