import { randomUUID } from "crypto";
import { z } from "zod";

const envelope = <T extends z.ZodRawShape>(shape: T) =>
  z.object({
    version: z.literal(1),
    correlationId: z.string(),
    ...shape,
  });

export const ResearchLeadJob = envelope({
  campaignId: z.string(),
  leadIds: z.array(z.string()).optional(),
});

export const ScoreLeadJob = envelope({
  campaignId: z.string(),
  leadId: z.string().optional(),
  leadIds: z.array(z.string()).optional(),
  icpDescription: z.string().nullable().optional(),
});

export const GenerateEmailJob = envelope({
  campaignId: z.string(),
  feedbackMap: z.record(z.string(), z.unknown()).optional(),
});

export const SendBatchJob = envelope({
  campaignId: z.string(),
});

export const LinkedInStepJob = envelope({
  campaignId: z.string(),
});

export type ResearchLeadJob = z.infer<typeof ResearchLeadJob>;
export type ScoreLeadJob = z.infer<typeof ScoreLeadJob>;
export type GenerateEmailJob = z.infer<typeof GenerateEmailJob>;
export type SendBatchJob = z.infer<typeof SendBatchJob>;
export type LinkedInStepJob = z.infer<typeof LinkedInStepJob>;

export function withEnvelope<T extends Record<string, unknown>>(
  data: T,
  correlationId = randomUUID(),
): T & { version: 1; correlationId: string } {
  return { version: 1, correlationId, ...data };
}
