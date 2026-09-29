/**
 * LLM Gateway Schema — GeneratedMessage
 *
 * Zod schema for the output of generate.agent.ts → generateMessageForLead().
 * This is the single source of truth for what constitutes a valid cold email
 * generation output from the LLM.
 *
 * Key validation choices:
 * - subject: 1–150 chars (outer length guard; heuristic engine enforces 4–12 words separately)
 * - body: min 20 chars (compliance.service.ts enforces word-count floor of 20 words)
 * - agentConfidence: present here only as a schema field; downstream callers must NOT
 *   treat this as the system confidence score.
 * - ctaTier: strict enum — model cannot return arbitrary strings
 */

import { z } from "zod";

export const CtaTierSchema = z.enum(["WEAK", "MODERATE", "STRONG"]);
export type CtaTier = z.infer<typeof CtaTierSchema>;

export const GeneratedMessageSchema = z.object({
  subject: z.string().min(1).max(150),
  subjectVariant: z.string().max(150).optional(),
  body: z.string().min(20),
  /**
   * Model-declared confidence — stored as `agentConfidence` in AgentProposal.
   * Field name kept as `confidence` here to match the ToolDefinition schema
   * the model sees; gateway maps it to `agentConfidence` on the proposal.
   */
  confidence: z.number().min(0).max(1),
  leadingSignal: z.string().optional(),
  ctaTier: CtaTierSchema.optional(),

  // Computed / heuristic refinement fields
  rawLlmConfidence: z.number().min(0).max(1).optional(),
  heuristicScore: z.number().min(0).max(1).optional(),
  bannedPhraseCount: z.number().int().min(0).optional(),
  spamRiskScore: z.number().min(0).max(1).optional(),
});

export type GeneratedMessage = z.infer<typeof GeneratedMessageSchema>;
