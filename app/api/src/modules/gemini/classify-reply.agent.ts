/**
 * Sprint 7 — Gemini Reply Intent Classifier Agent
 *
 * ARCHITECTURAL INVARIANT:
 * The LLM proposes. The execution service decides. Prisma persists.
 *
 * This file contains ZERO runtime Prisma imports.
 * It uses callGateway<ReplyIntentProposalPayload>() to return an AgentProposal.
 */

import { z } from "zod";
import { callGateway } from "../../lib/llm-gateway/llm-gateway";
import { AgentProposal } from "../../lib/llm-gateway/agent-proposal";
import { createContextHash } from "../../lib/llm-gateway/context-hash";
import { MODELS } from "./gemini.client";

export const ReplyIntentSchema = z.object({
  intent: z.enum([
    "POSITIVE",
    "NEGATIVE",
    "NOT_INTERESTED",
    "OUT_OF_OFFICE",
    "MEETING_REQUEST",
    "QUESTION",
    "OBJECTION",
    "NEUTRAL",
    "UNKNOWN",
  ]),
  intentTier: z.enum(["HIGH", "MEDIUM", "LOW"]),
  confidence: z.number().min(0).max(1),
  evidence: z.array(z.string().min(1).max(300)).max(3),
  buyingStage: z.string().nullable().optional().transform((v) => v ?? null),
  painPoints: z.array(z.string()).optional().transform((v) => v ?? []),
  competitorsMentioned: z.array(z.string()).optional().transform((v) => v ?? []),
  budgetSignal: z.string().nullable().optional().transform((v) => v ?? null),
  timelineSignal: z.string().nullable().optional().transform((v) => v ?? null),
});

export type ReplyIntentProposalPayload = z.infer<typeof ReplyIntentSchema>;

export interface ClassifyReplyAgentParams {
  readonly replyBody: string;
  readonly originalSubject: string;
  readonly originalBody: string;
  readonly leadFirstName?: string;
  readonly companyName?: string;
  readonly messageId: string;
  readonly tenantId?: string;
  readonly threadHistory?: Array<{ role: "prospect" | "sender"; body: string; sentAt?: string }>;
}

const CLASSIFIER_SYSTEM_PROMPT = `You are a reply-intent classifier.

You are NOT a policy authority.

A deterministic policy layer has already evaluated safety-critical patterns such as opt-out, complaint, and snooze.

You must not override deterministic policy decisions.

Your job is only to classify the semantic intent of the remaining ambiguous reply.

Return only the requested structured output.

Do not invent facts.

Do not infer information that is not present.

If evidence is insufficient, return UNKNOWN.

Do not decide whether a user should be unsubscribed.

Do not decide whether a message should be sent.

Do not calculate the final business score.`;

/**
 * Generates an AgentProposal<ReplyIntentProposalPayload> using callGateway<T>()
 * Pure, stateless proposal generation with zero DB access.
 */
export async function classifyReplyProposal(
  params: ClassifyReplyAgentParams,
): Promise<AgentProposal<ReplyIntentProposalPayload>> {
  const {
    replyBody,
    originalSubject,
    originalBody,
    leadFirstName,
    companyName,
    messageId,
    tenantId,
    threadHistory,
  } = params;

  const threadHistoryBlock =
    threadHistory && threadHistory.length > 0
      ? "\n\nPRIOR THREAD HISTORY:\n" +
        threadHistory.map((t) => `[${t.role.toUpperCase()}]: ${t.body}`).join("\n\n")
      : "";

  const userPrompt = `ORIGINAL EMAIL SUBJECT: ${originalSubject}
ORIGINAL EMAIL BODY:
${originalBody}${threadHistoryBlock}

LEAD: ${leadFirstName ?? "Unknown"} at ${companyName ?? "Unknown company"}

PROSPECT REPLY TO CLASSIFY:
${replyBody}`;

  const contextBundle = {
    messageId,
    replyBody,
    originalSubject,
    originalBody,
    leadFirstName: leadFirstName ?? null,
    companyName: companyName ?? null,
    tenantId: tenantId ?? null,
  };

  const contextHash = createContextHash(contextBundle);

  const proposal = await callGateway<ReplyIntentProposalPayload>({
    agentName: "reply.classifier.agent",
    model: MODELS.RESEARCH,
    systemPrompt: CLASSIFIER_SYSTEM_PROMPT,
    userPrompt,
    responseMode: "structured",
    outputSchema: ReplyIntentSchema,
    temperature: 0.1,
    proposalContext: {
      contextHash,
    },
  });

  return proposal;
}
