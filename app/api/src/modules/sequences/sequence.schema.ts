import { z } from "zod/v4";

// ── Enums ────────────────────────────────────────────────────────────────────

export const channelEnum = z.enum([
    "EMAIL",
    "LINKEDIN_VISIT",
    "LINKEDIN_CONNECT",
    "LINKEDIN_MESSAGE",
    "LINKEDIN_INMAIL",
]);

export const stepTriggerEnum = z.enum([
    "AFTER_DELAY",
    "ON_NO_REPLY",
    "ON_OPEN",
    "ON_CONNECT_ACCEPT",
]);

type Channel = z.infer<typeof channelEnum>;
type StepTrigger = z.infer<typeof stepTriggerEnum>;

// ── Static lookup tables ─────────────────────────────────────────────────────

const CHANNEL_ALLOWED_TRIGGERS: Record<Channel, StepTrigger[]> = {
    EMAIL: ["AFTER_DELAY", "ON_NO_REPLY", "ON_OPEN"],
    LINKEDIN_VISIT: ["AFTER_DELAY"],
    LINKEDIN_CONNECT: ["AFTER_DELAY"],
    LINKEDIN_MESSAGE: ["AFTER_DELAY", "ON_CONNECT_ACCEPT"],
    LINKEDIN_INMAIL: ["AFTER_DELAY", "ON_NO_REPLY"],
};

const CHANNELS_REQUIRING_MESSAGE = new Set<Channel>([
    "EMAIL",
    "LINKEDIN_MESSAGE",
    "LINKEDIN_INMAIL",
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
        delayDays: z.number().int().min(0).max(90),
        messageTemplate: z.string().trim().min(5).max(2000).nullable().optional(),
        subjectTemplate: z.string().trim().min(1).max(300).nullable().optional(),
    })
    .check((ctx) => {
        const step = ctx.value;

        if (!CHANNEL_ALLOWED_TRIGGERS[step.channel].includes(step.trigger)) {
            ctx.issues.push({
                code: "custom",
                input: step.trigger,
                message: `Trigger "${step.trigger}" is not valid for channel "${step.channel}"`,
                path: ["trigger"],
            });
        }

        if (CHANNELS_REQUIRING_MESSAGE.has(step.channel) && !step.messageTemplate) {
            ctx.issues.push({
                code: "custom",
                input: step.messageTemplate,
                message: `${step.channel} steps require a message template`,
                path: ["messageTemplate"],
            });
        }

        if (CHANNELS_REQUIRING_SUBJECT.has(step.channel) && !step.subjectTemplate) {
            ctx.issues.push({
                code: "custom",
                input: step.subjectTemplate,
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
    .check((ctx) => {
        const data = ctx.value;
        const indexes = data.steps.map((s) => s.stepIndex);

        if (new Set(indexes).size !== indexes.length) {
            ctx.issues.push({
                code: "custom",
                input: indexes,
                message: "Duplicate step indexes are not allowed",
                path: ["steps"],
            });
        }

        let reportedNonSequential = false;
        [...indexes].sort((a, b) => a - b).forEach((value, i) => {
            if (!reportedNonSequential && value !== i) {
                reportedNonSequential = true;
                ctx.issues.push({
                    code: "custom",
                    input: indexes,
                    message: "Step indexes must be sequential starting from 0",
                    path: ["steps"],
                });
            }
        });

        const first = data.steps.find((s) => s.stepIndex === 0);

        if (!first) {
            ctx.issues.push({
                code: "custom",
                input: data.steps,
                message: "Sequence must have a first step with index 0",
                path: ["steps"],
            });
            return;
        }

        if (first.trigger !== "AFTER_DELAY") {
            ctx.issues.push({
                code: "custom",
                input: first.trigger,
                message: "First step must use AFTER_DELAY trigger",
                path: ["steps", 0, "trigger"],
            });
        }

        if (first.delayDays !== 0) {
            ctx.issues.push({
                code: "custom",
                input: first.delayDays,
                message: "First step must have 0 delay days",
                path: ["steps", 0, "delayDays"],
            });
        }
    });

// ── Exported types ───────────────────────────────────────────────────────────

export type UpsertSequenceInput = z.infer<typeof upsertSequenceSchema>;
export type SequenceStepInput = z.infer<typeof sequenceStepSchema>;