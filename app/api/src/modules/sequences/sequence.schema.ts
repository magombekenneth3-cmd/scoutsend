import { z } from "zod";
import { Channel, StepTrigger } from "@prisma/client";

// ── Enums ────────────────────────────────────────────────────────────────────

export const channelEnum = z.nativeEnum(Channel);
export const stepTriggerEnum = z.nativeEnum(StepTrigger);

// ── Static lookup tables ─────────────────────────────────────────────────────

const CHANNEL_ALLOWED_TRIGGERS: Record<Channel, StepTrigger[]> = {
    EMAIL: ["AFTER_DELAY", "ON_NO_REPLY", "ON_OPEN", "ON_NO_ACCEPT"],
    LINKEDIN_VISIT: ["AFTER_DELAY"],
    LINKEDIN_CONNECT: ["AFTER_DELAY"],
    LINKEDIN_MESSAGE: ["AFTER_DELAY", "ON_CONNECT_ACCEPT"],
    LINKEDIN_INMAIL: ["AFTER_DELAY", "ON_NO_REPLY"],
    LINKEDIN_POST_CONNECT: ["AFTER_DELAY", "ON_CONNECT_ACCEPT"],
};

const CHANNELS_REQUIRING_MESSAGE = new Set<Channel>([
    "EMAIL",
    "LINKEDIN_MESSAGE",
    "LINKEDIN_INMAIL",
    "LINKEDIN_POST_CONNECT",
]);

const CHANNELS_REQUIRING_SUBJECT = new Set<Channel>([
    "EMAIL",
]);

// ── Step schema ──────────────────────────────────────────────────────────────

export const sequenceStepSchema = z
    .object({
        stepIndex: z.number().int().min(0),
        channel: channelEnum,
        trigger: stepTriggerEnum.optional().default("AFTER_DELAY"),
        delayDays: z.number().int().min(0).max(365),
        messageTemplate: z.string().trim().max(50_000).nullable().optional(),
        subjectTemplate: z.string().trim().max(2_000).nullable().optional(),
    })
    .superRefine((step, ctx) => {
        const allowedTriggers = CHANNEL_ALLOWED_TRIGGERS[step.channel] ?? [];
        if (!allowedTriggers.includes(step.trigger)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `Trigger "${step.trigger}" is not valid for channel "${step.channel}"`,
                path: ["trigger"],
            });
        }
        if (CHANNELS_REQUIRING_MESSAGE.has(step.channel) && !step.messageTemplate?.trim()) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `${step.channel} steps require a message template`,
                path: ["messageTemplate"],
            });
        }
        if (CHANNELS_REQUIRING_SUBJECT.has(step.channel) && !step.subjectTemplate?.trim()) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Email steps require a subject",
                path: ["subjectTemplate"],
            });
        }
    });

// ── Upsert schema ────────────────────────────────────────────────────────────

export const upsertSequenceSchema = z
    .object({
        steps: z.array(sequenceStepSchema).min(1).max(20),
        expectedUpdatedAt: z.iso.datetime(),
    })
    .superRefine((data, ctx) => {
        const indexes = data.steps.map((s) => s.stepIndex);

        if (new Set(indexes).size !== indexes.length) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Duplicate step indexes are not allowed",
                path: ["steps"],
            });
        }

        let reportedNonSequential = false;
        [...indexes].sort((a, b) => a - b).forEach((value, i) => {
            if (!reportedNonSequential && value !== i) {
                reportedNonSequential = true;
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: "Step indexes must be sequential starting from 0",
                    path: ["steps"],
                });
            }
        });

        const first = data.steps.find((s) => s.stepIndex === 0);

        if (!first) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "Sequence must have a first step with index 0",
                path: ["steps"],
            });
            return;
        }

        if (first.trigger !== "AFTER_DELAY") {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "First step must use AFTER_DELAY trigger",
                path: ["steps", 0, "trigger"],
            });
        }

        if (first.delayDays !== 0) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "First step must have 0 delay days",
                path: ["steps", 0, "delayDays"],
            });
        }
    });

// ── Exported types ───────────────────────────────────────────────────────────

export type UpsertSequenceInput = z.infer<typeof upsertSequenceSchema>;
export type SequenceStepInput = z.infer<typeof sequenceStepSchema>;