import { z } from "zod";
import { Channel, StepTrigger } from "@prisma/client";

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
  businessDescription: z.string().max(2000).optional().nullable(),
  valueProposition: z.string().max(1000).optional().nullable(),
  provenStats: z.array(
    z.object({
      metric: z.string().min(1),
      value: z.string().min(1),
      context: z.string().min(1),
    })
  ).max(5).optional().nullable(),
});

export const createCampaignSchema = campaignBase.superRefine(windowRefinement);
export const updateCampaignSchema = campaignBase.partial().superRefine(windowRefinement);

export const createSequenceStepSchema = z.object({
  channel: z.nativeEnum(Channel),
  trigger: z.nativeEnum(StepTrigger).optional().default("AFTER_DELAY"),
  delayDays: z.number().int().min(0).max(365).optional().default(3),
  messageTemplate: z.string().max(50_000).optional().nullable(),
  subjectTemplate: z.string().max(2_000).optional().nullable(),
});

export const updateSequenceStepSchema = z.object({
  stepIndex: z.number().int().min(0).optional(),
  channel: z.nativeEnum(Channel).optional(),
  trigger: z.nativeEnum(StepTrigger).optional(),
  delayDays: z.number().int().min(0).max(365).optional(),
  messageTemplate: z.string().max(50_000).optional().nullable(),
  subjectTemplate: z.string().max(2_000).optional().nullable(),
});