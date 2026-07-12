import { z } from "zod";

export const createSenderDomainSchema = z.object({
    domain: z
        .string()
        .min(1)
        .regex(/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/, "Invalid domain format"),
    dailyLimit: z.number().int().positive().max(10000).optional(),
    warmupEnabled: z.boolean().optional(),
});

export const updateSenderDomainSchema = z
    .object({
        dailyLimit: z.number().int().positive().max(10000),
        warmupEnabled: z.boolean(),
        health: z.enum(["HEALTHY", "WARNING", "DEGRADED", "BLOCKED"]),
        reputationScore: z.number().min(0).max(100),
        bounceRate: z.number().min(0).max(1),
        complaintRate: z.number().min(0).max(1),
    })
    .partial()
    .refine((d) => Object.keys(d).length > 0, { message: "At least one field required" });

export const getSenderDomainsQuerySchema = z.object({
    health: z.enum(["HEALTHY", "WARNING", "DEGRADED", "BLOCKED"]).optional(),
    warmupEnabled: z.coerce.boolean().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
});