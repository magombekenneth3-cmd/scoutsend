import { Channel, SequenceStep, StepTrigger } from "@prisma/client";
import { prisma } from "../../lib/prisma";

export interface SequenceStepInput {
    stepIndex: number;
    channel: Channel;
    trigger?: StepTrigger;
    delayDays: number;
    messageTemplate?: string | null;
    subjectTemplate?: string | null;
}

export interface SequenceLeadStatusesParams {
    campaignId: string;
    page: number;
    pageSize: number;
    leadId?: string;
}

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

const CHANNELS_REQUIRING_SUBJECT = new Set<Channel>(["EMAIL"]);

const UNCLOSED_MERGE_TAG_RE = /\{\{[^}]*$/;

export function validateSequenceSteps(steps: SequenceStepInput[]): string | null {
    if (steps.length === 0) return "Sequence must have at least one step";

    const indexes = steps.map((s) => s.stepIndex);
    if (new Set(indexes).size !== indexes.length) {
        return "Duplicate stepIndex values detected";
    }

    const sorted = [...steps].sort((a, b) => a.stepIndex - b.stepIndex);

    for (let i = 0; i < sorted.length; i++) {
        const step = sorted[i];
        const trigger = step.trigger ?? "AFTER_DELAY";

        if (step.stepIndex !== i) {
            return `stepIndex must be contiguous starting at 0 — gap found at position ${i}`;
        }

        if (step.delayDays < 0) {
            return `Step ${i}: delayDays must be >= 0`;
        }

        const allowed = CHANNEL_ALLOWED_TRIGGERS[step.channel] ?? [];
        if (!allowed.includes(trigger)) {
            return `Step ${i}: trigger "${trigger}" is not valid for channel "${step.channel}"`;
        }

        if (CHANNELS_REQUIRING_MESSAGE.has(step.channel) && !step.messageTemplate?.trim()) {
            return `Step ${i}: ${step.channel} requires a messageTemplate`;
        }

        if (CHANNELS_REQUIRING_SUBJECT.has(step.channel) && !step.subjectTemplate?.trim()) {
            return `Step ${i}: ${step.channel} requires a subjectTemplate`;
        }

        if ((step.messageTemplate?.length ?? 0) > 2000) {
            return `Step ${i}: messageTemplate exceeds 2000 characters`;
        }

        if ((step.subjectTemplate?.length ?? 0) > 300) {
            return `Step ${i}: subjectTemplate exceeds 300 characters`;
        }

        if (step.messageTemplate && UNCLOSED_MERGE_TAG_RE.test(step.messageTemplate)) {
            return `Step ${i}: messageTemplate contains an unclosed merge tag`;
        }

        if (step.subjectTemplate && UNCLOSED_MERGE_TAG_RE.test(step.subjectTemplate)) {
            return `Step ${i}: subjectTemplate contains an unclosed merge tag`;
        }
        if (trigger === "ON_NO_ACCEPT" && step.delayDays < 1) {
            return `Step ${i}: ON_NO_ACCEPT fallback must have delayDays >= 1`;
        }
    }

    if (sorted[0].trigger && sorted[0].trigger !== "AFTER_DELAY") {
        return "First step must use AFTER_DELAY trigger";
    }

    if (sorted[0].delayDays !== 0) {
        return "First step must have 0 delay days";
    }


    const fallbackCount = sorted.filter((s) => s.trigger === "ON_NO_ACCEPT").length;
    if (fallbackCount > 1) {
        return "Sequence may not contain more than one ON_NO_ACCEPT fallback step";
    }


    if (fallbackCount === 1) {
        const hasConnect = sorted.some((s) => s.channel === "LINKEDIN_CONNECT");
        if (!hasConnect) {
            return "ON_NO_ACCEPT fallback requires a LINKEDIN_CONNECT step in the same sequence";
        }
    }

    return null;
}

export async function upsertCampaignSequence(
    campaignId: string,
    steps: SequenceStepInput[],
    expectedUpdatedAt: Date,
): Promise<SequenceStep[]> {
    return prisma.$transaction(async (tx) => {
        const campaign = await tx.campaign.findUnique({
            where: { id: campaignId },
            select: { status: true, updatedAt: true },
        });

        if (!campaign) {
            throw new Error("Campaign not found");
        }

        if (campaign.status !== "DRAFT") {
            throw new Error("Cannot modify sequence: campaign is not in DRAFT status");
        }

        if (campaign.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
            throw new Error("Campaign was modified by another request — reload and retry");
        }

        const activeCount = await tx.leadStepStatus.count({
            where: { step: { campaignId } },
        });

        if (activeCount > 0) {
            throw new Error("Cannot modify sequence: execution history exists");
        }

        await tx.sequenceStep.deleteMany({ where: { campaignId } });

        await tx.sequenceStep.createMany({
            data: steps.map((s) => ({
                campaignId,
                stepIndex: s.stepIndex,
                channel: s.channel,
                trigger: s.trigger ?? "AFTER_DELAY",
                delayDays: s.delayDays,
                messageTemplate: s.messageTemplate?.trim() || null,
                subjectTemplate: s.subjectTemplate?.trim() || null,
            })),
        });

        return tx.sequenceStep.findMany({
            where: { campaignId },
            orderBy: { stepIndex: "asc" },
        });
    });
}

export async function getCampaignSequence(campaignId: string) {
    return prisma.sequenceStep.findMany({
        where: { campaignId },
        orderBy: { stepIndex: "asc" },
    });
}

export async function deleteCampaignSequence(campaignId: string): Promise<void> {
    await prisma.sequenceStep.deleteMany({ where: { campaignId } });
}

export async function getSequenceLeadStatuses({
    campaignId,
    page,
    pageSize,
    leadId,
}: SequenceLeadStatusesParams) {
    const where = {
        step: { campaignId },
        ...(leadId ? { leadId } : {}),
    };

    const [rows, total] = await Promise.all([
        prisma.leadStepStatus.findMany({
            where,
            select: {
                id: true,
                status: true,
                scheduledAt: true,
                executedAt: true,
                errorMsg: true,
                step: { select: { stepIndex: true, channel: true } },
                lead: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        companyName: true,
                        linkedinUrl: true,
                    },
                },
                linkedInActivity: {
                    select: { id: true, status: true, sentAt: true, providerRef: true },
                },
            },
            orderBy: [
                { lead: { companyName: "asc" } },
                { step: { stepIndex: "asc" } },
            ],
            skip: (page - 1) * pageSize,
            take: pageSize,
        }),
        prisma.leadStepStatus.count({ where }),
    ]);

    return {
        data: rows,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
    };
}

export async function getSequenceSummary(campaignId: string) {
    const [steps, counts, uniqueLeads] = await Promise.all([
        getCampaignSequence(campaignId),
        prisma.leadStepStatus.groupBy({
            by: ["status"],
            where: { step: { campaignId } },
            _count: { _all: true },
        }),
        prisma.leadStepStatus.findMany({
            where: { step: { campaignId } },
            select: { leadId: true },
            distinct: ["leadId"],
        }),
    ]);

    const countMap = Object.fromEntries(
        counts.map((r) => [r.status, r._count._all]),
    );

    const total = Object.values(countMap).reduce((s, n) => s + n, 0);

    const execution = {
        pending: countMap.PENDING ?? 0,
        scheduled: countMap.SCHEDULED ?? 0,
        sent: countMap.SENT ?? 0,
        failed: countMap.FAILED ?? 0,
        replied: countMap.REPLIED ?? 0,
        completed: countMap.COMPLETED ?? 0,
        done: countMap.DONE ?? 0,
    };

    return {
        totalSteps: steps.length,
        totalLeads: uniqueLeads.length,
        steps: steps.map((s) => ({
            stepIndex: s.stepIndex,
            channel: s.channel,
            trigger: s.trigger,
            delayDays: s.delayDays,
        })),
        execution,
        rates: {
            sent: total > 0 ? execution.sent / total : 0,
            failed: total > 0 ? execution.failed / total : 0,
            replied: total > 0 ? execution.replied / total : 0,
            completed: total > 0 ? execution.completed / total : 0,
        },
    };
}