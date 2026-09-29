/**
 * LLM Gateway Schema — FollowupMessage
 *
 * Zod schema for the output of followup.agent.ts.
 * Mirrors the GeneratedMessage shape but with a mandatory `followUpStep`
 * and without `subjectVariant` (follow-up subjects track the original thread).
 */

import { z } from "zod";

export const FollowupMessageSchema = z.object({
  subject: z.string().min(1).max(150),
  body: z.string().min(20),
  /** Model-declared confidence — mapped to agentConfidence on AgentProposal. */
  confidence: z.number().min(0).max(1),
  /**
   * The 1-indexed follow-up step number (1 = first follow-up, 2 = second, etc.).
   * Must be a positive integer.
   */
  followUpStep: z.number().int().min(1),
  /** Signal type that anchored the follow-up angle. Optional. */
  leadingSignal: z.string().optional(),
  ctaTier: z.enum(["WEAK", "MODERATE", "STRONG"]).optional(),
});

export type FollowupMessage = z.infer<typeof FollowupMessageSchema>;
