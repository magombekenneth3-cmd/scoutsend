import { z } from "zod";

export const connectLinkedInAccountSchema = z.object({
    name: z.string().min(1).max(150),
    accountId: z.string().min(1).max(200),
    avatarUrl: z.string().url().optional(),
    profileUrl: z.string().url().optional(),
});

export const getLinkedInAccountsQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
});
