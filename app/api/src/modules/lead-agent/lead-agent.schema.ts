import { z } from "zod";

export const createColumnSchema = z.object({
    name: z.string().min(1).max(120),
    fieldKey: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z][a-z0-9_]*$/, "fieldKey must be lowercase snake_case starting with a letter"),
    prompt: z.string().min(10).max(2000),
    outputType: z.enum(["TEXT", "BOOLEAN", "NUMBER"]).default("TEXT"),
});

export const triggerRunSchema = z.object({
    columnId: z.string().min(1),
});

export const triggerBatchSchema = z.object({
    columnId: z.string().min(1),
});