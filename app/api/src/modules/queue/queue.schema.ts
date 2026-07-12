import { z } from "zod";

export const getQueueJobsQuerySchema = z.object({
    campaignId: z.string().optional(),
    queueName: z.string().optional(),
    jobType: z.string().optional(),
    status: z.enum(["WAITING", "ACTIVE", "COMPLETED", "FAILED", "DELAYED"]).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
});