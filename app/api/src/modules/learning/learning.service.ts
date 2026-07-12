import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
    LEARNING_EVENT_TYPES,
    LEARNING_OUTCOMES,
    LearningEventType,
    LearningOutcome,
} from "../../lib/constants";
import {
    getLearningEventsQuerySchema,
    resolveLearningEventSchema,
    dismissLearningEventSchema,
} from "./learning.schema";

interface DiffVector {
    subject?: { from: string; to: string };
    body?: { from: string; to: string };
}

interface LearningEventMetadata {
    spamRiskScore?: number;
    personalizationScore?: number;
    failedThresholds?: {
        spamRisk: boolean;
        personalization: boolean;
    };
    reviewerNote?: string;
    dismissReason?: string;
    icpDescription?: string;
    targetIndustry?: string;
    targetRegion?: string;
    [key: string]: unknown;
}

export interface CreateLearningEventInput {
    eventType: LearningEventType;
    originalOutput: string;
    modifiedOutput?: string;
    diffVector?: DiffVector;
    outcome: LearningOutcome;
    outreachMessageId?: string;
    metadata?: LearningEventMetadata;
}

export async function createLearningEvent(
    data: CreateLearningEventInput
): Promise<void> {
    await prisma.learningEvent.create({
        data: {
            eventType: data.eventType,
            originalOutput: data.originalOutput,
            modifiedOutput: data.modifiedOutput ?? "",
            diffVector: (data.diffVector as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            outcome: data.outcome,
            outreachMessageId: data.outreachMessageId,
            metadata: (data.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        },
    });
}

export async function getLearningEvents(
    query: z.infer<typeof getLearningEventsQuerySchema>
) {
    const {
        eventType,
        outcome,
        outreachMessageId,
        pendingOnly,
        from,
        to,
        page,
        limit,
    } = query;

    const skip = (page - 1) * limit;

    const where: Prisma.LearningEventWhereInput = {
        ...(eventType && { eventType }),
        ...(outreachMessageId && { outreachMessageId }),
        ...(pendingOnly
            ? { outcome: LEARNING_OUTCOMES.PENDING_REVIEW }
            : outcome
                ? { outcome }
                : {}),
        ...((from || to) && {
            createdAt: {
                ...(from && { gte: from }),
                ...(to && { lte: to }),
            },
        }),
    };

    const [events, total] = await prisma.$transaction([
        prisma.learningEvent.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
            select: {
                id: true,
                eventType: true,
                outcome: true,
                outreachMessageId: true,
                metadata: true,
                diffVector: true,
                createdAt: true,
                outreachMessage: outreachMessageId
                    ? false
                    : {
                        select: {
                            id: true,
                            subject: true,
                            spamRiskScore: true,
                            personalizationScore: true,
                            approvalStatus: true,
                            lead: {
                                select: {
                                    firstName: true,
                                    lastName: true,
                                    companyName: true,
                                    email: true,
                                },
                            },
                        },
                    },
            },
        }),
        prisma.learningEvent.count({ where }),
    ]);

    return {
        data: events,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
}

export async function getLearningEventById(id: string) {
    return prisma.learningEvent.findUnique({
        where: { id },
        include: {
            outreachMessage: {
                select: {
                    id: true,
                    subject: true,
                    body: true,
                    originalSubject: true,
                    originalBody: true,
                    spamRiskScore: true,
                    personalizationScore: true,
                    approvalStatus: true,
                    deliveryState: true,
                    lead: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                            companyName: true,
                            email: true,
                            title: true,
                            qualificationScore: true,
                        },
                    },
                },
            },
        },
    });
}

export async function resolveLearningEvent(
    id: string,
    data: z.infer<typeof resolveLearningEventSchema>,
    reviewerId: string
) {
    const event = await prisma.learningEvent.findUnique({
        where: { id },
        select: {
            id: true,
            outcome: true,
            outreachMessageId: true,
            originalOutput: true,
        },
    });

    if (!event) throw new Error("Learning event not found");

    if (event.outcome !== LEARNING_OUTCOMES.PENDING_REVIEW) {
        throw new Error(
            `Learning event is already resolved (outcome: ${event.outcome})`
        );
    }

    if (!event.outreachMessageId) {
        throw new Error(
            "This learning event has no linked outreach message to resolve"
        );
    }

    const message = await prisma.outreachMessage.findUnique({
        where: { id: event.outreachMessageId },
        select: {
            id: true,
            subject: true,
            body: true,
            approvalStatus: true,
            lead: {
                select: {
                    campaign: {
                        select: {
                            icpDescription: true,
                            targetIndustry: true,
                            targetRegion: true,
                        },
                    },
                },
            },
        },
    });

    if (!message) throw new Error("Linked outreach message not found");

    if (message.approvalStatus !== "PENDING") {
        throw new Error(
            `Message is already ${message.approvalStatus.toLowerCase()} — cannot resolve`
        );
    }

    const diff: DiffVector = {};
    if (data.subject && data.subject !== message.subject) {
        diff.subject = { from: message.subject, to: data.subject };
    }
    if (data.body && data.body !== message.body) {
        diff.body = { from: message.body, to: data.body };
    }

    const wasEdited = Object.keys(diff).length > 0;
    const finalOutcome = wasEdited
        ? LEARNING_OUTCOMES.EDITED_AND_APPROVED
        : LEARNING_OUTCOMES.APPROVED;

    const modifiedOutput = JSON.stringify({
        subject: data.subject ?? message.subject,
        body: data.body ?? message.body,
    });

    const campaignContext = message.lead?.campaign;

    const [updatedMessage, updatedEvent] = await prisma.$transaction([
        prisma.outreachMessage.update({
            where: { id: message.id },
            data: {
                ...(data.subject && { subject: data.subject }),
                ...(data.body && { body: data.body }),
                ...(wasEdited && {
                    originalSubject: message.subject,
                    originalBody: message.body,
                    diffVector: diff as Prisma.InputJsonValue,
                }),
                approvalStatus: "APPROVED",
                approvedById: reviewerId,
                deliveryState: "QUEUED",
            },
            include: {
                lead: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        companyName: true,
                        email: true,
                    },
                },
                approvedBy: { select: { id: true, firstName: true, lastName: true } },
            },
        }),
        prisma.learningEvent.update({
            where: { id },
            data: {
                modifiedOutput,
                diffVector: diff as Prisma.InputJsonValue,
                outcome: finalOutcome,
                metadata: {
                    ...(data.reviewerNote && { reviewerNote: data.reviewerNote }),
                    resolvedAt: new Date().toISOString(),
                    resolvedBy: reviewerId,
                    wasEdited,
                    icpDescription: campaignContext?.icpDescription,
                    targetIndustry: campaignContext?.targetIndustry,
                    targetRegion: campaignContext?.targetRegion,
                },
            },
        }),
    ]);

    return { message: updatedMessage, learningEvent: updatedEvent };
}

export async function dismissLearningEvent(
    id: string,
    data: z.infer<typeof dismissLearningEventSchema>,
    reviewerId: string
) {
    const event = await prisma.learningEvent.findUnique({
        where: { id },
        select: {
            id: true,
            outcome: true,
            outreachMessageId: true,
        },
    });

    if (!event) throw new Error("Learning event not found");

    if (event.outcome !== LEARNING_OUTCOMES.PENDING_REVIEW) {
        throw new Error(
            `Learning event is already resolved (outcome: ${event.outcome})`
        );
    }

    const updatedEvent = await prisma.$transaction(async (tx) => {
        if (event.outreachMessageId) {
            await tx.outreachMessage.update({
                where: { id: event.outreachMessageId },
                data: {
                    approvalStatus: "REJECTED",
                    approvedById: reviewerId,
                },
            });
        }

        return tx.learningEvent.update({
            where: { id },
            data: {
                outcome: LEARNING_OUTCOMES.DISMISSED,
                metadata: {
                    dismissReason: data.reason,
                    dismissedAt: new Date().toISOString(),
                    dismissedBy: reviewerId,
                },
            },
        });
    });

    return {
        message: event.outreachMessageId ? { id: event.outreachMessageId } : null,
        learningEvent: updatedEvent,
    };
}

export async function getLearningEventStats() {
    const [totals, byEventType, byOutcome, pendingCount, recentResolved] =
        await Promise.all([
            prisma.learningEvent.aggregate({
                _count: { id: true },
            }),
            prisma.learningEvent.groupBy({
                by: ["eventType"],
                _count: { id: true },
                orderBy: { _count: { id: "desc" } },
            }),
            prisma.learningEvent.groupBy({
                by: ["outcome"],
                _count: { id: true },
                orderBy: { _count: { id: "desc" } },
            }),
            prisma.learningEvent.count({
                where: { outcome: LEARNING_OUTCOMES.PENDING_REVIEW },
            }),
            prisma.learningEvent.findMany({
                where: {
                    outcome: {
                        in: [
                            LEARNING_OUTCOMES.APPROVED,
                            LEARNING_OUTCOMES.EDITED_AND_APPROVED,
                            LEARNING_OUTCOMES.REJECTED,
                            LEARNING_OUTCOMES.DISMISSED,
                        ],
                    },
                },
                orderBy: { createdAt: "desc" },
                take: 5,
                select: {
                    id: true,
                    eventType: true,
                    outcome: true,
                    outreachMessageId: true,
                    createdAt: true,
                },
            }),
        ]);

    const editedCount = byOutcome.find(
        (o) => o.outcome === LEARNING_OUTCOMES.EDITED_AND_APPROVED
    )?._count.id ?? 0;

    const resolvedCount = byOutcome
        .filter((o) => o.outcome !== LEARNING_OUTCOMES.PENDING_REVIEW)
        .reduce((acc, o) => acc + o._count.id, 0);

    const editRate =
        resolvedCount > 0
            ? parseFloat(((editedCount / resolvedCount) * 100).toFixed(1))
            : 0;

    return {
        totals: {
            total: totals._count.id,
            pending: pendingCount,
            resolved: resolvedCount,
            editRate: `${editRate}%`,
        },
        byEventType,
        byOutcome,
        recentResolved,
    };
}

export interface FewShotExample {
    original: { subject: string; body: string };
    improved: { subject: string; body: string };
    improvementReason: string;
    diffSummary?: string;
    relevanceScore?: number;
}

interface FewShotOptions {
    limit?: number;
    icpDescription?: string;
    targetIndustry?: string;
    targetRegion?: string;
}

function cosineSimilarity(a: string, b: string): number {
    const tokenise = (s: string) =>
        s.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);

    const tokensA = tokenise(a);
    const tokensB = tokenise(b);

    const vocab = new Set([...tokensA, ...tokensB]);
    const freq = (tokens: string[], word: string) =>
        tokens.filter((t) => t === word).length;

    let dot = 0, magA = 0, magB = 0;
    for (const word of vocab) {
        const fa = freq(tokensA, word);
        const fb = freq(tokensB, word);
        dot += fa * fb;
        magA += fa * fa;
        magB += fb * fb;
    }

    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function summariseDiff(diff: DiffVector): string {
    const parts: string[] = [];
    if (diff.subject) {
        parts.push(`subject rewritten`);
    }
    if (diff.body) {
        const fromLen = diff.body.from.split(/\s+/).length;
        const toLen = diff.body.to.split(/\s+/).length;
        const delta = toLen - fromLen;
        parts.push(`body ${delta > 0 ? "expanded" : delta < 0 ? "shortened" : "reworded"} (${delta > 0 ? "+" : ""}${delta} words)`);
    }
    return parts.join(", ") || "minor edits";
}

export async function getFewShotExamples(
    limitOrOptions: number | FewShotOptions = 5
): Promise<FewShotExample[]> {
    const opts: FewShotOptions =
        typeof limitOrOptions === "number"
            ? { limit: limitOrOptions }
            : limitOrOptions;

    const { limit = 5, icpDescription, targetIndustry, targetRegion } = opts;

    const CANDIDATE_POOL = limit * 8;

    const events = await prisma.learningEvent.findMany({
        where: {
            eventType: {
                in: [
                    LEARNING_EVENT_TYPES.HUMAN_EDITED,
                    LEARNING_EVENT_TYPES.AUTO_APPROVED,
                ],
            },
            outcome: {
                in: [
                    LEARNING_OUTCOMES.EDITED_AND_APPROVED,
                    LEARNING_OUTCOMES.APPROVED,
                ],
            },
            NOT: { modifiedOutput: "" },
        },
        orderBy: { createdAt: "desc" },
        take: CANDIDATE_POOL,
        select: {
            id: true,
            originalOutput: true,
            modifiedOutput: true,
            diffVector: true,
            metadata: true,
        },
    });

    const queryContext = [
        icpDescription ?? "",
        targetIndustry ?? "",
        targetRegion ?? "",
    ].join(" ").trim();

    interface ScoredCandidate {
        example: FewShotExample;
        relevanceScore: number;
        dedupeKey: string;
    }

    const candidates: ScoredCandidate[] = [];
    const seenSubjectBodies = new Set<string>();

    for (const event of events) {
        try {
            const original = JSON.parse(event.originalOutput) as {
                subject: string;
                body: string;
            };
            const improved = JSON.parse(event.modifiedOutput) as {
                subject: string;
                body: string;
                improvementNotes?: string;
            };

            if (!original.subject || !original.body) continue;
            if (!improved.subject || !improved.body) continue;

            const wasActuallyEdited =
                original.subject !== improved.subject ||
                original.body !== improved.body;

            const isHumanEdited =
                (event.metadata as LearningEventMetadata)?.wasEdited === true;

            if (!wasActuallyEdited && !isHumanEdited) continue;

            const dedupeKey = `${improved.subject.slice(0, 60)}|${improved.body.slice(0, 120)}`;
            if (seenSubjectBodies.has(dedupeKey)) continue;
            seenSubjectBodies.add(dedupeKey);

            const meta = event.metadata as LearningEventMetadata | null;
            const eventContext = [
                meta?.icpDescription ?? "",
                meta?.targetIndustry ?? "",
                meta?.targetRegion ?? "",
            ].join(" ").trim();

            let relevanceScore = 0.5;

            if (queryContext && eventContext) {
                const similarity = cosineSimilarity(queryContext, eventContext);
                relevanceScore = similarity;

                if (
                    targetIndustry &&
                    meta?.targetIndustry &&
                    meta.targetIndustry.toLowerCase() !== targetIndustry.toLowerCase()
                ) {
                    relevanceScore *= 0.3;
                }

                if (
                    targetRegion &&
                    meta?.targetRegion &&
                    meta.targetRegion.toLowerCase() !== targetRegion.toLowerCase()
                ) {
                    relevanceScore *= 0.7;
                }
            }

            if (isHumanEdited) {
                relevanceScore *= 1.5;
            }

            const diff = event.diffVector as DiffVector | null;
            const diffSummary = diff ? summariseDiff(diff) : undefined;

            candidates.push({
                example: {
                    original: { subject: original.subject, body: original.body },
                    improved: { subject: improved.subject, body: improved.body },
                    improvementReason:
                        improved.improvementNotes ?? "Improved for quality",
                    diffSummary,
                    relevanceScore,
                },
                relevanceScore,
                dedupeKey,
            });
        } catch {
            continue;
        }
    }

    return candidates
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, limit)
        .map((c) => c.example);
}