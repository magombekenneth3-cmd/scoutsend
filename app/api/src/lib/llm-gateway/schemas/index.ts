export { GeneratedMessageSchema, CtaTierSchema } from "./generated-message.schema";
export type { GeneratedMessage, CtaTier } from "./generated-message.schema";

export { StructuredFactsSchema } from "./structured-facts.schema";
export type { StructuredFacts } from "./structured-facts.schema";

export { FollowupMessageSchema } from "./followup-message.schema";
export type { FollowupMessage } from "./followup-message.schema";

// Agent output schemas — P0-1 migration
export {
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
  // P0-A quality agent schemas
  QualityEvaluatorOutputSchema,
  QualityRewriterOutputSchema,
  // P0-B enrichment diff schema
  EnrichmentNewSignalSchema,
  EnrichmentDiffOutputSchema,
} from "./agent-output.schemas";
export type {
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
  // P0-A quality agent types
  QualityEvaluatorOutput,
  QualityRewriterOutput,
  // P0-B enrichment diff type
  EnrichmentDiffOutput,
} from "./agent-output.schemas";
