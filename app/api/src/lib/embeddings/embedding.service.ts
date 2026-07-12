import { prisma } from "../prisma";
import { embedText } from "../../modules/gemini/gemini.client";
import { logger } from "../logger";

function toPgVector(values: number[]): string {
    return `[${values.join(",")}]`;
}

export async function updateLeadEmbedding(leadId: string, text: string): Promise<void> {
    if (!text.trim()) return;
    try {
        const vector = await embedText(text);
        const pgVector = toPgVector(vector);
        await prisma.$executeRaw`UPDATE "Lead" SET embedding = ${pgVector}::vector WHERE id = ${leadId}`;
    } catch (err) {
        logger.error({ err, leadId }, "[embeddings] Failed to update lead embedding");
    }
}

export async function updateCompanyEmbedding(companyId: string, text: string): Promise<void> {
    if (!text.trim()) return;
    try {
        const vector = await embedText(text);
        const pgVector = toPgVector(vector);
        await prisma.$executeRaw`UPDATE "Company" SET embedding = ${pgVector}::vector WHERE id = ${companyId}`;
    } catch (err) {
        logger.error({ err, companyId }, "[embeddings] Failed to update company embedding");
    }
}

export async function updateReplyEmbedding(replyId: string, text: string): Promise<void> {
    if (!text.trim()) return;
    try {
        const vector = await embedText(text);
        const pgVector = toPgVector(vector);
        await prisma.$executeRaw`UPDATE "Reply" SET embedding = ${pgVector}::vector WHERE id = ${replyId}`;
    } catch (err) {
        logger.error({ err, replyId }, "[embeddings] Failed to update reply embedding");
    }
}

export function buildLeadEmbeddingText(lead: {
    companyName: string;
    title?: string | null;
    seniority?: string | null;
    department?: string | null;
    industry?: string | null;
    qualificationReason?: string | null;
    signals?: { signalType: string; value: string }[];
}): string {
    const parts = [
        lead.companyName,
        lead.title,
        lead.seniority,
        lead.department,
        lead.industry,
        lead.qualificationReason,
        ...(lead.signals ?? []).map((s) => `${s.signalType}: ${s.value}`),
    ];
    return parts.filter(Boolean).join(" | ");
}

export function buildCompanyEmbeddingText(company: {
    name: string;
    industry?: string | null;
    country?: string | null;
    revenueBand?: string | null;
    employeeCount?: number | null;
    signals?: { signalType: string; value: string }[];
}): string {
    const parts = [
        company.name,
        company.industry,
        company.country,
        company.revenueBand,
        company.employeeCount != null ? `${company.employeeCount} employees` : null,
        ...(company.signals ?? []).map((s) => `${s.signalType}: ${s.value}`),
    ];
    return parts.filter(Boolean).join(" | ");
}

export function buildReplyEmbeddingText(reply: {
    body: string;
    intent?: string | null;
    objectionCategory?: string | null;
    buyingStage?: string | null;
    painPoints?: unknown;
    budgetSignal?: string | null;
    timelineSignal?: string | null;
}): string {
    const painPointsText = Array.isArray(reply.painPoints)
        ? (reply.painPoints as unknown[])
            .filter((p): p is string => typeof p === "string")
            .join(", ")
        : null;

    const parts = [
        reply.intent,
        reply.objectionCategory,
        reply.buyingStage,
        painPointsText,
        reply.budgetSignal,
        reply.timelineSignal,
        reply.body.slice(0, 2000),
    ];
    return parts.filter(Boolean).join(" | ");
}