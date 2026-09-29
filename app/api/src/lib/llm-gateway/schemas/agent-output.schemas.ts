/**
 * LLM Gateway Schemas — Agent Output Schemas (P0-1)
 *
 * Zod output schemas for agents migrated from direct callGemini()
 * to callGateway<T>() in State 6 / P0-1.
 *
 * Agents covered:
 *  - campaign-health.agent   → HealthAssessmentSchema
 *  - objection-handler.agent → ObjectionAnalysisSchema, DraftReplyOutputSchema
 *  - followup.agent          → FollowUpOutputSchema
 *  - tech-detection.agent    → TechStackResultSchema
 *  - community-intent.agent  → IntentQueriesSchema, CommunityLeadArraySchema
 *  - job-intel.agent         → JobSignalArraySchema
 *
 * NOT covered (P0-1 exception):
 *  - research.agent          → synthesizeOutreachAngle() uses callGeminiStream()
 *                              No streaming mode exists in callGateway. Deferred.
 *
 * Schema design rules:
 *  - Use .strict() only when the prompt explicitly constrains to named fields.
 *  - Use .passthrough() when the LLM may return extra fields that are ignored downstream.
 *  - Nullable/optional fields reflect existing runtime tolerance, not aspirational strictness.
 *  - Do NOT invent fields not present in the existing prompts or consuming code.
 */

import { z } from "zod";

// ─── campaign-health.agent ────────────────────────────────────────────────────

/**
 * Output of campaign-health.agent → assessHealth() LLM call.
 * Consumer reads .summary (string) and .actions (string[]).
 * Uses .passthrough() — LLM may include extra explanatory fields.
 */
export const HealthAssessmentSchema = z.object({
  summary: z.string().min(1),
  actions: z.array(z.string()).default([]),
}).passthrough();

export type HealthAssessmentOutput = z.infer<typeof HealthAssessmentSchema>;

// ─── objection-handler.agent ──────────────────────────────────────────────────

const OBJECTION_CATEGORY_VALUES = [
  "PRICING",
  "TIMING",
  "INCUMBENT_VENDOR",
  "SECURITY_COMPLIANCE",
  "INTEGRATION_TECHNICAL",
  "BRUSH_OFF",
  "NO_NEED",
  "DECISION_MAKER",
  "MORE_INFO",
  "GENERAL_INTEREST",
  "NONE",
] as const;

const SECONDARY_OBJECTION_CATEGORY_VALUES = OBJECTION_CATEGORY_VALUES.filter(
  (v) => v !== "NONE",
) as Exclude<(typeof OBJECTION_CATEGORY_VALUES)[number], "NONE">[];

/**
 * Output of objection-handler.agent → detectObjection() LLM call.
 * Prompt requests exactly these fields — strict schema.
 */
export const ObjectionAnalysisSchema = z.object({
  category: z.enum(OBJECTION_CATEGORY_VALUES),
  secondaryCategory: z
    .enum(SECONDARY_OBJECTION_CATEGORY_VALUES as [string, ...string[]] as [(typeof SECONDARY_OBJECTION_CATEGORY_VALUES)[0], ...(typeof SECONDARY_OBJECTION_CATEGORY_VALUES)[number][]])
    .nullable()
    .optional(),
  extractedObjection: z.string().default(""),
}).strict();

export type ObjectionAnalysisOutput = z.infer<typeof ObjectionAnalysisSchema>;

/**
 * Output of objection-handler.agent → generateDraftWithFramework() LLM call.
 * Prompt requests exactly {subject, body} — strict schema.
 */
export const DraftReplyOutputSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
}).strict();

export type DraftReplyOutput = z.infer<typeof DraftReplyOutputSchema>;

// ─── followup.agent ───────────────────────────────────────────────────────────

const FOLLOW_UP_STRATEGIES = [
  "subject_rework",
  "soft_nudge",
  "signal_led",
  "new_angle",
] as const;

/**
 * Output of followup.agent → generateFollowUp() and generateBreakUpEmail() LLM calls.
 * Prompt requests strategy/reason/subject/subjectVariant/body (+ resourceAsset for break-up).
 * Uses .passthrough() to tolerate any extra fields the model may produce.
 * Note: URL-in-subject/body validation is deterministic post-gateway logic — not Zod's job.
 */
export const FollowUpOutputSchema = z.object({
  subject: z.string().min(1).max(200),
  subjectVariant: z.string().min(1).max(200),
  body: z.string().min(1).max(12000),
  strategy: z.enum(FOLLOW_UP_STRATEGIES).optional(),
  reason: z.string().max(300).optional(),
  resourceAsset: z.string().max(500).optional(),
}).passthrough();

export type FollowUpOutput = z.infer<typeof FollowUpOutputSchema>;

// ─── tech-detection.agent ─────────────────────────────────────────────────────

/**
 * Output of tech-detection.agent → analyzeTechStack() LLM call.
 * Uses .passthrough() — caller merges partialClassification fields on top of the result.
 * confidence < 0.5 gate is applied by the caller after the proposal is returned.
 */
export const TechStackResultSchema = z.object({
  technologies: z.array(z.string()).default([]),
  crmDetected: z.string().nullable().default(null),
  analyticsDetected: z.string().nullable().default(null),
  cloudProvider: z.string().nullable().default(null),
  aiToolsDetected: z.array(z.string()).default([]),
  techSignalValue: z.string().max(80),
  confidence: z.number().min(0).max(1),
  explanation: z.string().max(200),
  buyingSignals: z.array(z.string()).optional().default([]),
  salesMaturity: z.string().optional(),
  migrationLikelihood: z.string().optional(),
  aiAdoptionLevel: z.string().optional(),
}).passthrough();

export type TechStackResultOutput = z.infer<typeof TechStackResultSchema>;

// ─── community-intent.agent ───────────────────────────────────────────────────

/**
 * Output of community-intent.agent → buildIntentQueries() LLM call.
 * Prompt requests exactly { queries: string[] } — strict schema.
 */
export const IntentQueriesSchema = z.object({
  queries: z.array(z.string().min(1)).min(1).max(5),
}).strict();

export type IntentQueriesOutput = z.infer<typeof IntentQueriesSchema>;

/**
 * Shape of one raw community lead as returned by the extractor LLM.
 * Post-gateway, parseCommunityLead() applies additional business validation.
 * Uses .passthrough() — LLM may include extra fields.
 */
export const CommunityLeadRawSchema = z.object({
  companyName: z.string(),
  website: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  intentSignal: z.string(),
  confidence: z.number().min(0).max(1),
  explanation: z.string().optional().default(""),
  postUrl: z.string(),
}).passthrough();

/** Output of community-intent.agent → extractIntentLeads() LLM call. */
export const CommunityLeadArraySchema = z.array(CommunityLeadRawSchema);

export type CommunityLeadRawOutput = z.infer<typeof CommunityLeadRawSchema>;
export type CommunityLeadArrayOutput = z.infer<typeof CommunityLeadArraySchema>;

// ─── job-intel.agent ──────────────────────────────────────────────────────────

/**
 * One signal entry from job-intel.agent → extractJobSignalsWithRetry() LLM call.
 * Uses .passthrough() — consumer's validateJobSignals() already handles extra/missing fields.
 * Unknown fields are dropped by the existing downstream consumer logic.
 */
export const JobSignalItemSchema = z.object({
  department: z.string().optional().default("General"),
  roleCount: z.number().optional().default(1),
  titles: z.array(z.string()).optional().default([]),
  signalType: z.enum(["HIRING_SIGNAL", "INTENT_SIGNAL"]),
  intentCategory: z
    .enum([
      "immediate_purchase",
      "evaluation",
      "future_budget",
      "operational_expansion",
      "tech_migration",
      "revenue_expansion",
    ])
    .optional()
    .default("operational_expansion"),
  direction: z
    .enum(["increasing", "steady", "decreasing", "frozen"])
    .optional()
    .default("steady"),
  signalValue: z.string().min(1),
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
}).passthrough();

/** Output of job-intel.agent → extractJobSignalsWithRetry() LLM call. */
export const JobSignalArraySchema = z.array(JobSignalItemSchema);

export type JobSignalItemOutput = z.infer<typeof JobSignalItemSchema>;
export type JobSignalArrayOutput = z.infer<typeof JobSignalArraySchema>;

// ─── quality.agent ────────────────────────────────────────────────────────────

/**
 * Output of quality.agent → evaluateQuality() LLM call. (P0-A)
 *
 * Prompt requests exactly { spamRiskScore, personalizationScore }.
 * Uses .strict() — the prompt instructs ONLY JSON with these two fields.
 * Downstream clampScore() is still applied by the agent after gateway validation.
 */
export const QualityEvaluatorOutputSchema = z
  .object({
    spamRiskScore: z.number().min(0).max(1),
    personalizationScore: z.number().min(0).max(1),
  })
  .strict();

export type QualityEvaluatorOutput = z.infer<typeof QualityEvaluatorOutputSchema>;

/**
 * Output of quality.agent → rewriteAndScore() LLM call. (P0-A)
 *
 * Prompt requests exactly { subject, body, spamRiskScore, personalizationScore, improvementNotes }.
 * Uses .strict() — prompt explicitly constrains output to these fields.
 * Downstream clampScore() is still applied by the agent after gateway validation.
 */
export const QualityRewriterOutputSchema = z
  .object({
    subject: z.string().min(1),
    body: z.string().min(1),
    spamRiskScore: z.number().min(0).max(1),
    personalizationScore: z.number().min(0).max(1),
    improvementNotes: z.string(),
  })
  .strict();

export type QualityRewriterOutput = z.infer<typeof QualityRewriterOutputSchema>;

// ─── enrichment-refreshment.agent ────────────────────────────────────────────

/**
 * Signal type values that the enrichment diff LLM may return. (P0-B)
 * Must mirror the VALID_SIGNAL_TYPES set in enrichment-refreshment.agent.ts,
 * which is derived from the Prisma SignalType enum.
 * Downstream code applies the VALID_SIGNAL_TYPES deterministic filter after this.
 */
const ENRICHMENT_SIGNAL_TYPES = [
  "HIRING_SIGNAL",
  "FUNDING_SIGNAL",
  "GROWTH_SIGNAL",
  "TECH_SIGNAL",
  "INTENT_SIGNAL",
  "RISK_SIGNAL",
  "WEBSITE_COPY",
  "UNKNOWN",
] as const;

/**
 * Output of enrichment-refreshment.agent → diffEnrichment() LLM call. (P0-B)
 *
 * Prompt requests { hasSignificantChange, newSignals[], changeReason }.
 * Uses .passthrough() — LLM may include reasoning/explanation fields that are ignored.
 * Downstream normalizeEnrichmentDiff() + VALID_SIGNAL_TYPES filter still apply.
 * NOTE: Do NOT add an approval/decision boolean here — enrichment diffs are content.
 */
export const EnrichmentNewSignalSchema = z
  .object({
    type: z.enum(ENRICHMENT_SIGNAL_TYPES),
    value: z.string().min(1),
    confidence: z.number().min(0).max(1),
    explanation: z.string(),
  })
  .passthrough();

export const EnrichmentDiffOutputSchema = z
  .object({
    hasSignificantChange: z.boolean(),
    newSignals: z.array(EnrichmentNewSignalSchema).default([]),
    changeReason: z.string(),
  })
  .passthrough();

export type EnrichmentDiffOutput = z.infer<typeof EnrichmentDiffOutputSchema>;
