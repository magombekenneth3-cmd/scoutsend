import { z } from "zod";

export const ReplyIntentSchema = z.enum([
    "POSITIVE",
    "NEGATIVE",
    "NOT_INTERESTED",
    "OUT_OF_OFFICE",
    "MEETING_REQUEST",
    "QUESTION",
    "UNKNOWN",
]);

export const ClassificationSchema = z.object({
    intent: ReplyIntentSchema,
    sentimentScore: z.number().min(-1).max(1),
    confidence: z.number().min(0).max(1),
    summary: z.string().min(1),
    buyingStage: z.string().nullable().optional().transform(v => v ?? null),
    painPoints: z.array(z.string()).optional().transform(v => v ?? []),
    competitorsMentioned: z.array(z.string()).optional().transform(v => v ?? []),
    budgetSignal: z.string().nullable().optional().transform(v => v ?? null),
    timelineSignal: z.string().nullable().optional().transform(v => v ?? null),
});

export const DraftSchema = z.object({
    subject: z.string().min(1),
    body: z.string().min(10),
});

export const OOODateSchema = z.object({
    returnDate: z.string().nullable(),
});

export type ClassificationRaw = z.infer<typeof ClassificationSchema>;
export type DraftRaw = z.infer<typeof DraftSchema>;