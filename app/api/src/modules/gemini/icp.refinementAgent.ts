import { prisma } from "../../lib/prisma";
import { callGemini, extractJSON, MODELS } from "./gemini.client";
import { logger } from "../../lib/logger";
import { leadScoringQueue } from "./campaign.queue";

export interface RefinedICP {
    icpDescription: string;
    targetIndustry: string | null;
    targetRegion: string | null;
    refinementNotes: string;
}

interface CampaignPerformanceStats {
    totalLeads: number;
    contacted: number;
    openRate: number | null;
    replyRate: number | null;
    positiveReplyRate: number | null;
    topSignalTypes: string[];
}

async function getCampaignPerformance(campaignId: string): Promise<CampaignPerformanceStats> {
    const scoredLeadFilter = {
        campaignId,
        deletedAt: null,
        OR: [
            { recommendedAction: null },
            { recommendedAction: { not: "DISQUALIFY" as const } },
        ],
    };

    const [totalLeads, contacted, sent, opened, replied, positiveReplies, topSignals] =
        await Promise.all([
            prisma.lead.count({ where: scoredLeadFilter }),
            prisma.lead.count({
                where: {
                    ...scoredLeadFilter,
                    outreachMessages: {
                        some: {
                            deliveryState: { in: ["SENT", "DELIVERED", "OPENED", "REPLIED"] },
                        },
                    },
                },
            }),
            prisma.outreachMessage.count({
                where: {
                    lead: scoredLeadFilter,
                    deliveryState: { in: ["SENT", "DELIVERED", "OPENED", "REPLIED"] },
                },
            }),
            prisma.outreachMessage.count({
                where: {
                    lead: scoredLeadFilter,
                    deliveryState: { in: ["OPENED", "REPLIED"] },
                },
            }),
            prisma.outreachMessage.count({
                where: { lead: scoredLeadFilter, deliveryState: "REPLIED" },
            }),
            prisma.reply.count({
                where: {
                    lead: scoredLeadFilter,
                    intent: { in: ["POSITIVE", "MEETING_REQUEST"] },
                    deletedAt: null,
                },
            }),
            prisma.leadSignal.groupBy({
                by: ["signalType"],
                where: { lead: scoredLeadFilter },
                _count: { id: true },
                orderBy: { _count: { id: "desc" } },
                take: 5,
            }),
        ]);

    return {
        totalLeads,
        contacted,
        openRate: sent > 0 ? opened / sent : null,
        replyRate: sent > 0 ? replied / sent : null,
        positiveReplyRate: replied > 0 ? positiveReplies / replied : null,
        topSignalTypes: topSignals.map((s) => s.signalType),
    };
}

export async function runIcpRefinementAgent(campaignId: string): Promise<RefinedICP> {
    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: {
            id: true,
            name: true,
            icpDescription: true,
            targetIndustry: true,
            targetRegion: true,
        },
    });

    if (!campaign) throw new Error("Campaign not found");

    const previousIcp = campaign.icpDescription;

    logger.info({ campaignId }, "[icp-refinement.agent] Starting ICP refinement");

    const stats = await getCampaignPerformance(campaignId);

    const hasPerformanceData = stats.contacted > 0;

    const performanceBlock = hasPerformanceData
        ? `Campaign performance so far:
- Total leads: ${stats.totalLeads}
- Contacted: ${stats.contacted}
- Open rate: ${stats.openRate !== null ? (stats.openRate * 100).toFixed(1) + "%" : "N/A"}
- Reply rate: ${stats.replyRate !== null ? (stats.replyRate * 100).toFixed(1) + "%" : "N/A"}
- Positive reply rate: ${stats.positiveReplyRate !== null ? (stats.positiveReplyRate * 100).toFixed(1) + "%" : "N/A"}
- Most common qualifying signal types: ${stats.topSignalTypes.length > 0 ? stats.topSignalTypes.join(", ") : "none yet"}

Use this data to sharpen the ICP using the observed outreach performance and the most common qualifying lead signals. Preserve the original target market while making the ICP more actionable.`
        : `No outreach data yet — sharpen the ICP description linguistically without data-driven narrowing.`;

    const { text } = await callGemini({
        agentName: "icp-refinement.refiner",
        model: MODELS.RESEARCH,
        systemPrompt: `You are a senior B2B go-to-market strategist. Your job is to take a vague ICP description and rewrite it into a sharply defined, actionable targeting brief that will produce better lead qualification and email personalization downstream.

A strong ICP description includes:
- Specific job titles (not just "decision makers")
- Company size range (employees or revenue)
- Industry verticals with enough specificity to filter Apollo
- Key pain points or triggers that make a company ready to buy
- What success looks like for the prospect

Return ONLY a JSON object:
{
  "icpDescription": string,
  "targetIndustry": string | null — single best Apollo industry tag; null means intentionally clear the industry filter,
  "targetRegion": string | null — refined region string; null means leave the existing region unchanged,
  "refinementNotes": string
}`,
        userPrompt: `Campaign: ${campaign.name}

Original ICP description:
${campaign.icpDescription}

Current industry filter: ${campaign.targetIndustry ?? "not set"}
Current region filter: ${campaign.targetRegion ?? "not set"}

${performanceBlock}

Rewrite the ICP to be more specific and actionable. Preserve the user's intent — only sharpen, never change the target market.`,
        metadata: { campaignId },
        temperature: 0.3,
    });

    let refined: RefinedICP;
    try {
        refined = extractJSON<RefinedICP>(text);
    } catch (err) {
        logger.error(
            { campaignId, err, raw: text },
            "[icp-refinement.agent] Failed to parse Gemini response — keeping original",
        );
        return {
            icpDescription: previousIcp ?? "",
            targetIndustry: campaign.targetIndustry ?? null,
            targetRegion: campaign.targetRegion ?? null,
            refinementNotes: "Parse error — original ICP preserved",
        };
    }

    const validDescription =
        typeof refined.icpDescription === "string" && refined.icpDescription.trim().length > 0
            ? refined.icpDescription.trim()
            : null;

    const refinementNotes =
        typeof refined.refinementNotes === "string" && refined.refinementNotes.trim().length > 0
            ? refined.refinementNotes.trim()
            : "ICP refined.";

    if (!validDescription) {
        logger.warn(
            { campaignId, raw: refined.icpDescription },
            "[icp-refinement.agent] Gemini returned invalid icpDescription — keeping original",
        );
        return {
            ...refined,
            refinementNotes,
            icpDescription: previousIcp ?? "",
        };
    }

    const icpChanged = validDescription.trim() !== (previousIcp ?? "").trim();

    await prisma.$transaction(async (tx) => {
        const existingState = await tx.campaignStateStore.findUnique({
            where: { campaignId },
            select: { approvalStatuses: true },
        });

        const existingApprovalStatuses =
            (existingState?.approvalStatuses as Record<string, unknown>) ?? {};

        const nextApprovalStatuses = {
            ...existingApprovalStatuses,
            icpRefinement: {
                previousIcp,
                refinedIcp: validDescription,
                notes: refinementNotes,
                refinedAt: new Date().toISOString(),
            },
        };

        const targetIndustryUpdate =
            typeof refined.targetIndustry === "string" && refined.targetIndustry.trim().length > 0
                ? { targetIndustry: refined.targetIndustry.trim() }
                : refined.targetIndustry === null
                    ? { targetIndustry: null }
                    : {};

        const targetRegionUpdate =
            typeof refined.targetRegion === "string" && refined.targetRegion.trim().length > 0
                ? { targetRegion: refined.targetRegion.trim() }
                : {};

        await tx.campaign.update({
            where: { id: campaignId },
            data: {
                icpDescription: validDescription,
                ...targetIndustryUpdate,
                ...targetRegionUpdate,
            },
        });

        await tx.campaignStateStore.upsert({
            where: { campaignId },
            create: {
                campaignId,
                currentNode: "icp-refined",
                regenAttemptsCount: 0,
                approvalStatuses: nextApprovalStatuses,
            },
            update: {
                approvalStatuses: nextApprovalStatuses,
            },
        });
    });

    if (icpChanged) {
        await leadScoringQueue.add(
            "rescore-after-icp-refinement",
            { campaignId },
            {
                jobId: `rescore-icp-${campaignId}`,
                attempts: 2,
                backoff: { type: "fixed", delay: 30_000 },
                removeOnComplete: { age: 3600 },
                removeOnFail: { age: 3600 },
            },
        );

        logger.info(
            { campaignId, notes: refinementNotes },
            "[icp-refinement.agent] ICP changed — rescore job queued",
        );
    }

    logger.info(
        { campaignId, notes: refinementNotes, hasPerformanceData, icpChanged },
        "[icp-refinement.agent] ICP refined and saved",
    );

    return { ...refined, refinementNotes, icpDescription: validDescription };
}