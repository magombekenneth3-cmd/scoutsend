import { z } from "zod";

export const createReplySchema = z.object({
  body: z.string().min(1),
  outreachMessageId: z.string().min(1),
  leadId: z.string().min(1),
  intent: z.enum(["POSITIVE", "NEGATIVE", "NOT_INTERESTED", "OUT_OF_OFFICE", "MEETING_REQUEST", "QUESTION", "UNKNOWN"]).optional(),
  sentimentScore: z.number().min(-1).max(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  requiresHumanReview: z.boolean().optional(),
  providerMessageId: z.string().optional(),
  normalizedBody: z.string().optional(),
});

export const updateReplySchema = z.object({
  requiresHumanReview: z.boolean().optional(),
});

export const getRepliesQuerySchema = z.object({
  leadId: z.string().optional(),
  outreachMessageId: z.string().optional(),
  intent: z.enum(["POSITIVE", "NEGATIVE", "NOT_INTERESTED", "OUT_OF_OFFICE", "MEETING_REQUEST", "QUESTION", "UNKNOWN"]).optional(),
  requiresHumanReview: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const sendDraftSchema = z.object({}).strict();

export const markMeetingBookedSchema = z.object({
  notes: z.string().optional(),
});

export const pipelineStatsQuerySchema = z.object({
  campaignId: z.string().optional(),
});