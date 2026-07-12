import { prisma } from "../../lib/prisma";
import { callGemini, extractJSON, MODELS, embedText } from "../gemini/gemini.client";
import { logger } from "../../lib/logger";

export interface WinContext {
    outreachMessageId: string;
    replyId: string;
    campaignId: string;
    icpVertical?: string;
    targetIndustry?: string;
    targetRegion?: string;
    subject: string;
    body: string;
    signalType: string;
    signalValue: string;
    replyIntent: "POSITIVE" | "MEETING_REQUEST";
    replyBody: string;
    sentimentScore?: number;
    leadId?: string;
    companyId?: string;
    qualificationScoreAtCapture?: number | null;
    pipelineStageAtCapture?: string | null;
}

export interface LossContext {
    outreachMessageId: string;
    replyId: string;
    campaignId: string;
    icpVertical?: string;
    targetIndustry?: string;
    targetRegion?: string;
    subject: string;
    body: string;
    signalUsed?: string;
    replyIntent: "NEGATIVE" | "NOT_INTERESTED";
    replyBody: string;
    sentimentScore?: number;
    leadId?: string;
    qualificationScoreAtCapture?: number | null;
    pipelineStageAtCapture?: string | null;
}

export interface WinPattern {
    signalType: string;
    signalValue: string;
    subjectPattern: string;
    bodyOpeningPattern: string;
    tone: string | null;
    replyIntent: string;
    frequency: number;
    recencyScore: number;
}

export interface LossPattern {
    inferredObjection: string;
    bodyPattern: string | null;
    tone: string | null;
    frequency: number;
    recencyScore: number;
}

interface ExtractedWinPattern {
    subjectPattern: string;
    bodyOpeningPattern: string;
    tone: string;
    icpVertical: string;
}

interface ExtractedLossPattern {
    inferredObjection: string;
    bodyPattern: string;
    tone: string;
    icpVertical: string;
}

async function extractWinPatterns(params: {
    subject: string;
    body: string;
    replyBody: string;
    replyIntent: string;
    campaignId: string;
}): Promise<ExtractedWinPattern> {
    const { subject, body, replyBody, replyIntent, campaignId } = params;

    const { text } = await callGemini({
        agentName: "memory.win-extractor",
        model: MODELS.REVIEW,
        systemPrompt: `You analyse B2B cold emails that received a positive reply and extract reusable patterns.
Return ONLY a JSON object:
{
  "subjectPattern": string — generalised subject line structure, replace specific names/companies with {company}, {signal}, {person}. Max 12 words.
  "bodyOpeningPattern": string — the first sentence structure, generalised the same way. Max 20 words.
  "tone": string — one of: "peer-to-peer" | "challenger" | "curious" | "direct" | "warm"
  "icpVertical": string — infer the likely B2B vertical from the message context (e.g. "B2B SaaS", "FinTech", "eCommerce", "Healthcare IT"). Max 3 words.
}`,
        userPrompt: `EMAIL SUBJECT: ${subject}

EMAIL BODY:
${body}

REPLY (${replyIntent}):
${replyBody}`,
        metadata: { campaignId },
        temperature: 0.2,
    });

    return extractJSON<ExtractedWinPattern>(text);
}

async function extractLossPatterns(params: {
    subject: string;
    body: string;
    replyBody: string;
    replyIntent: string;
    campaignId: string;
}): Promise<ExtractedLossPattern> {
    const { subject, body, replyBody, replyIntent, campaignId } = params;

    const { text } = await callGemini({
        agentName: "memory.loss-extractor",
        model: MODELS.REVIEW,
        systemPrompt: `You analyse B2B cold emails that received a negative or not-interested reply and extract the likely reason for failure.
Return ONLY a JSON object:
{
  "inferredObjection": string — the most likely reason the prospect declined, inferred from both the email and their reply. Be specific: "product not relevant to their stack", "emailed the wrong stakeholder", "too generic, no personalisation", "wrong timing". Max 15 words.
  "bodyPattern": string — the first sentence of the body that likely failed, generalised with {company}, {signal}, {person}. Max 20 words.
  "tone": string — one of: "peer-to-peer" | "challenger" | "curious" | "direct" | "warm" | "salesy" | "generic"
  "icpVertical": string — infer the likely B2B vertical. Max 3 words.
}`,
        userPrompt: `EMAIL SUBJECT: ${subject}

EMAIL BODY:
${body}

REPLY (${replyIntent}):
${replyBody}`,
        metadata: { campaignId },
        temperature: 0.2,
    });

    return extractJSON<ExtractedLossPattern>(text);
}

export async function recordWin(ctx: WinContext): Promise<void> {
    try {
        const patterns = await extractWinPatterns({
            subject: ctx.subject,
            body: ctx.body,
            replyBody: ctx.replyBody,
            replyIntent: ctx.replyIntent,
            campaignId: ctx.campaignId,
        });

        const embeddingText = [
            patterns.icpVertical || ctx.icpVertical,
            ctx.targetIndustry,
            ctx.targetRegion,
            patterns.subjectPattern,
            patterns.bodyOpeningPattern,
        ].filter(Boolean).join(" | ");
        const vector = await embedText(embeddingText);
        const pgVector = `[${vector.join(",")}]`;

        const signalTypeEnum = toSignalTypeEnum(ctx.signalType);

        await prisma.$executeRaw`
            INSERT INTO "WinRecord" (
                id, "icpVertical", "targetIndustry", "targetRegion",
                "signalType", "signalValue", "subjectPattern", "bodyOpeningPattern",
                tone, "replyIntent", "sentimentScore",
                "outreachMessageId", "replyId", "campaignId",
                embedding, "createdAt"
            ) VALUES (
                gen_random_uuid()::text,
                ${(patterns.icpVertical || ctx.icpVertical) ?? null},
                ${ctx.targetIndustry ?? null},
                ${ctx.targetRegion ?? null},
                ${signalTypeEnum}::"SignalType",
                ${ctx.signalValue},
                ${patterns.subjectPattern},
                ${patterns.bodyOpeningPattern},
                ${patterns.tone ?? null},
                ${ctx.replyIntent},
                ${ctx.sentimentScore ?? null},
                ${ctx.outreachMessageId},
                ${ctx.replyId},
                ${ctx.campaignId},
                ${pgVector}::vector,
                NOW()
            )
        `;

        logger.info(
            { campaignId: ctx.campaignId, replyIntent: ctx.replyIntent, signalType: ctx.signalType },
            "[memory] Win record created"
        );
    } catch (err) {
        logger.error({ err, outreachMessageId: ctx.outreachMessageId }, "[memory] Failed to record win");
    }
}

export async function recordLoss(ctx: LossContext): Promise<void> {
    try {
        const patterns = await extractLossPatterns({
            subject: ctx.subject,
            body: ctx.body,
            replyBody: ctx.replyBody,
            replyIntent: ctx.replyIntent,
            campaignId: ctx.campaignId,
        });

        const embeddingText = [
            patterns.icpVertical || ctx.icpVertical,
            ctx.targetIndustry,
            ctx.targetRegion,
            patterns.inferredObjection,
            patterns.bodyPattern,
        ].filter(Boolean).join(" | ");
        const vector = await embedText(embeddingText);
        const pgVector = `[${vector.join(",")}]`;

        await prisma.$executeRaw`
            INSERT INTO "LossRecord" (
                id, "icpVertical", "targetIndustry", "targetRegion",
                "signalUsed", "inferredObjection", "bodyPattern",
                tone, "replyIntent", "sentimentScore",
                "outreachMessageId", "replyId", "campaignId",
                embedding, "createdAt"
            ) VALUES (
                gen_random_uuid()::text,
                ${(patterns.icpVertical || ctx.icpVertical) ?? null},
                ${ctx.targetIndustry ?? null},
                ${ctx.targetRegion ?? null},
                ${ctx.signalUsed ?? null},
                ${patterns.inferredObjection},
                ${patterns.bodyPattern ?? null},
                ${patterns.tone ?? null},
                ${ctx.replyIntent},
                ${ctx.sentimentScore ?? null},
                ${ctx.outreachMessageId},
                ${ctx.replyId},
                ${ctx.campaignId},
                ${pgVector}::vector,
                NOW()
            )
        `;

        logger.info(
            { campaignId: ctx.campaignId, replyIntent: ctx.replyIntent },
            "[memory] Loss record created"
        );
    } catch (err) {
        logger.error({ err, outreachMessageId: ctx.outreachMessageId }, "[memory] Failed to record loss");
    }
}

export async function getWinPatterns(params: {
    icpVertical?: string;
    targetIndustry?: string;
    targetRegion?: string;
    limit?: number;
}): Promise<WinPattern[]> {
    const { icpVertical, targetIndustry, targetRegion, limit = 6 } = params;

    const queryText = [icpVertical, targetIndustry, targetRegion]
        .filter(Boolean)
        .join(" | ");

    const ttlDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    if (!queryText) {
        const recent = await prisma.winRecord.findMany({
            where: { createdAt: { gte: ttlDate } },
            orderBy: { createdAt: "desc" },
            take: limit,
        });
        return recent.map((r) => ({
            signalType: r.signalType,
            signalValue: r.signalValue,
            subjectPattern: r.subjectPattern,
            bodyOpeningPattern: r.bodyOpeningPattern,
            tone: r.tone,
            replyIntent: r.replyIntent,
            frequency: 1,
            recencyScore: 0,
        }));
    }

    const queryVector = await embedText(queryText);
    const pgVector = `[${queryVector.join(",")}]`;
    const CANDIDATE_POOL = limit * 6;

    type RawWin = {
        id: string;
        signalType: string;
        signalValue: string;
        subjectPattern: string;
        bodyOpeningPattern: string;
        tone: string | null;
        replyIntent: string;
        createdAt: Date;
        similarity: number;
    };

    const candidates = await prisma.$queryRaw<RawWin[]>`
        SELECT
            id,
            "signalType",
            "signalValue",
            "subjectPattern",
            "bodyOpeningPattern",
            tone,
            "replyIntent",
            "createdAt",
            1 - (embedding <=> ${pgVector}::vector) AS similarity
        FROM "WinRecord"
        WHERE embedding IS NOT NULL AND "createdAt" >= ${ttlDate}
        ORDER BY embedding <=> ${pgVector}::vector
        LIMIT ${CANDIDATE_POOL}
    `;

    if (candidates.length === 0) return [];

    const now = Date.now();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    const frequencyMap = new Map<string, number>();
    for (const r of candidates) {
        const key = r.subjectPattern.slice(0, 40).toLowerCase();
        frequencyMap.set(key, (frequencyMap.get(key) ?? 0) + 1);
    }

    const seen = new Set<string>();
    const deduped: RawWin[] = [];
    for (const r of candidates) {
        const key = r.subjectPattern.slice(0, 40).toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            deduped.push(r);
        }
        if (deduped.length >= limit) break;
    }

    return deduped.map((r) => {
        const ageMs = now - new Date(r.createdAt).getTime();
        const recencyScore = Math.max(0, 1 - ageMs / THIRTY_DAYS_MS);
        const blended = parseFloat((r.similarity * 0.7 + recencyScore * 0.3).toFixed(3));
        return {
            signalType: r.signalType,
            signalValue: r.signalValue,
            subjectPattern: r.subjectPattern,
            bodyOpeningPattern: r.bodyOpeningPattern,
            tone: r.tone,
            replyIntent: r.replyIntent,
            frequency: frequencyMap.get(r.subjectPattern.slice(0, 40).toLowerCase()) ?? 1,
            recencyScore: blended,
        };
    });
}

export async function getLossPatterns(params: {
    icpVertical?: string;
    targetIndustry?: string;
    targetRegion?: string;
    limit?: number;
}): Promise<LossPattern[]> {
    const { icpVertical, targetIndustry, targetRegion, limit = 4 } = params;

    const queryText = [icpVertical, targetIndustry, targetRegion]
        .filter(Boolean)
        .join(" | ");

    const ttlDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    if (!queryText) {
        const recent = await prisma.lossRecord.findMany({
            where: { createdAt: { gte: ttlDate } },
            orderBy: { createdAt: "desc" },
            take: limit,
        });
        return recent.map((r) => ({
            inferredObjection: r.inferredObjection,
            bodyPattern: r.bodyPattern,
            tone: r.tone,
            frequency: 1,
            recencyScore: 0,
        }));
    }

    const queryVector = await embedText(queryText);
    const pgVector = `[${queryVector.join(",")}]`;
    const CANDIDATE_POOL = limit * 6;

    type RawLoss = {
        id: string;
        inferredObjection: string;
        bodyPattern: string | null;
        tone: string | null;
        createdAt: Date;
        similarity: number;
    };

    const candidates = await prisma.$queryRaw<RawLoss[]>`
        SELECT
            id,
            "inferredObjection",
            "bodyPattern",
            tone,
            "createdAt",
            1 - (embedding <=> ${pgVector}::vector) AS similarity
        FROM "LossRecord"
        WHERE embedding IS NOT NULL AND "createdAt" >= ${ttlDate}
        ORDER BY embedding <=> ${pgVector}::vector
        LIMIT ${CANDIDATE_POOL}
    `;

    if (candidates.length === 0) return [];

    const now = Date.now();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

    const frequencyMap = new Map<string, number>();
    for (const r of candidates) {
        const key = r.inferredObjection.slice(0, 40).toLowerCase();
        frequencyMap.set(key, (frequencyMap.get(key) ?? 0) + 1);
    }

    const seen = new Set<string>();
    const deduped: RawLoss[] = [];
    for (const r of candidates) {
        const key = r.inferredObjection.slice(0, 40).toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            deduped.push(r);
        }
        if (deduped.length >= limit) break;
    }

    return deduped.map((r) => {
        const ageMs = now - new Date(r.createdAt).getTime();
        const recencyScore = Math.max(0, 1 - ageMs / THIRTY_DAYS_MS);
        const blended = parseFloat((r.similarity * 0.7 + recencyScore * 0.3).toFixed(3));
        return {
            inferredObjection: r.inferredObjection,
            bodyPattern: r.bodyPattern,
            tone: r.tone,
            frequency: frequencyMap.get(r.inferredObjection.slice(0, 40).toLowerCase()) ?? 1,
            recencyScore: blended,
        };
    });
}

export async function getMemoryStats() {
    const [winCount, lossCount, recentWins, topSignals] = await Promise.all([
        prisma.winRecord.count(),
        prisma.lossRecord.count(),
        prisma.winRecord.findMany({
            orderBy: { createdAt: "desc" },
            take: 5,
            select: { signalType: true, subjectPattern: true, replyIntent: true, createdAt: true },
        }),
        prisma.winRecord.groupBy({
            by: ["signalType"],
            _count: { id: true },
            orderBy: { _count: { id: "desc" } },
            take: 5,
        }),
    ]);

    return {
        winCount,
        lossCount,
        winToLossRatio: lossCount > 0 ? parseFloat((winCount / lossCount).toFixed(2)) : null,
        recentWins,
        topSignals: topSignals.map((s: { signalType: string; _count: { id: number } }) => ({
            signalType: s.signalType,
            count: s._count.id,
        })),
    };
}

function toSignalTypeEnum(raw: string): "HIRING_SIGNAL" | "FUNDING_SIGNAL" | "GROWTH_SIGNAL" | "TECH_SIGNAL" | "INTENT_SIGNAL" | "RISK_SIGNAL" | "WEBSITE_COPY" | "UNKNOWN" {
    const valid = ["HIRING_SIGNAL", "FUNDING_SIGNAL", "GROWTH_SIGNAL", "TECH_SIGNAL", "INTENT_SIGNAL", "RISK_SIGNAL", "WEBSITE_COPY"] as const;
    const upper = raw.toUpperCase() as typeof valid[number];
    return valid.includes(upper) ? upper : "UNKNOWN";
}