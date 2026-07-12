import { z } from "zod";

export const createOutreachMessageSchema = z.object({
  leadId: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  spamRiskScore: z.number().min(0).max(100).optional(),
  personalizationScore: z.number().min(0).max(100).optional(),
});

export const editOutreachMessageSchema = z.object({
  subject: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
});

export const getOutreachMessagesQuerySchema = z.object({
  leadId: z.string().optional(),
  campaignId: z.string().optional(),
  approvalStatus: z.enum(["PENDING", "APPROVED", "REJECTED"]).optional(),
  deliveryState: z
    .enum([
      "DRAFT", "QUEUED", "SENT", "DELIVERED", "OPENED",
      "REPLIED", "BOUNCED", "FAILED", "SUPPRESSED", "SENDING", "SPAM",
    ])
    .optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const chartStatsQuerySchema = z.object({
  campaignId: z.string().min(1),
  days: z.coerce.number().int().min(1).max(365).default(7),
});

export const batchApproveSchema = z.object({
  campaignId: z.string().min(1),
  messageIds: z.array(z.string().min(1)).min(1).max(200),
});

export const batchRejectSchema = z.object({
  campaignId: z.string().min(1),
  messageIds: z.array(z.string().min(1)).min(1).max(200),
});