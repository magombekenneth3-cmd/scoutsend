import { z } from "zod";

export const createCampaignSchema = z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    icpDescription: z.string().min(1),
    targetIndustry: z.string().optional(),
    targetRegion: z.string().optional(),
    dailySendLimit: z.number().int().positive().optional(),
    senderDomainId: z.string().optional(),
});

export const updateCampaignSchema = createCampaignSchema.partial();