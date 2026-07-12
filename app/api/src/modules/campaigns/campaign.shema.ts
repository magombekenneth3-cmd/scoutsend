import { z } from "zod";

const sendHour = z.number().int().min(0).max(23, {
  message: "Hour must be between 0 and 23",
});

const windowRefinement = (
  data: { sendWindowStart?: number | undefined; sendWindowEnd?: number | undefined },
  ctx: z.RefinementCtx
): void => {
  if (data.sendWindowStart !== undefined && data.sendWindowEnd !== undefined) {
    if (data.sendWindowEnd <= data.sendWindowStart) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "sendWindowEnd must be greater than sendWindowStart",
        path: ["sendWindowEnd"],
      });
    }
  }
};

const campaignBase = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  icpDescription: z.string().min(1),
  targetIndustry: z.string().optional().nullable(),
  targetRegion: z.string().optional().nullable(),
  dailySendLimit: z.number().int().positive().optional(),
  qualificationThreshold: z.number().min(0).max(1).optional(),
  senderDomainId: z.string().optional().nullable(),
  senderMailboxId: z.string().optional().nullable(),
  linkedInAccountId: z.string().optional().nullable(),
  enrichmentData: z.any().optional().nullable(),
  followUpDelayDays: z.number().int().min(1).max(30).optional(),
  followUpMaxSteps: z.number().int().min(0).max(10).optional(),
  sendWindowStart: sendHour.optional(),
  sendWindowEnd: sendHour.optional(),
  sendWindowDays: z.array(z.number().int().min(1).max(7)).optional(),
  autoSendRepliesEnabled: z.boolean().optional(),
  timezone: z.string().optional().refine(
    (tz) => {
      if (!tz) return true;
      try {
        Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    },
    { message: "Invalid IANA timezone identifier" }
  ),
});

export const createCampaignSchema = campaignBase.superRefine(windowRefinement);
export const updateCampaignSchema = campaignBase.partial().superRefine(windowRefinement);