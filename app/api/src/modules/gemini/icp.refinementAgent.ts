import { prisma } from "../../lib/prisma";
import { z } from "zod";
import { callGateway } from "../../lib/llm-gateway";
import { MODELS } from "./gemini.client";
import { logger } from "../../lib/logger";
import { leadScoringQueue } from "./campaign.queue";

const APOLLO_INDUSTRY_TAXONOMY = new Set([
    "Accounting", "Airlines/Aviation", "Alternative Dispute Resolution",
    "Alternative Medicine", "Animation", "Apparel & Fashion",
    "Architecture & Planning", "Arts and Crafts", "Automotive",
    "Aviation & Aerospace", "Banking", "Biotechnology",
    "Broadcast Media", "Building Materials", "Business Supplies and Equipment",
    "Capital Markets", "Chemicals", "Civic & Social Organization",
    "Civil Engineering", "Commercial Real Estate", "Computer & Network Security",
    "Computer Games", "Computer Hardware", "Computer Networking",
    "Computer Software", "Construction", "Consumer Electronics",
    "Consumer Goods", "Consumer Services", "Cosmetics",
    "Dairy", "Defense & Space", "Design",
    "E-Learning", "Education Management", "Electrical/Electronic Manufacturing",
    "Entertainment", "Environmental Services", "Events Services",
    "Executive Office", "Facilities Services", "Farming",
    "Financial Services", "Fine Art", "Fishery",
    "Food & Beverages", "Food Production", "Fund-Raising",
    "Furniture", "Gambling & Casinos", "Glass, Ceramics & Concrete",
    "Government Administration", "Government Relations", "Graphic Design",
    "Health, Wellness and Fitness", "Higher Education", "Hospital & Health Care",
    "Hospitality", "Human Resources", "Import and Export",
    "Individual & Family Services", "Industrial Automation", "Information Services",
    "Information Technology and Services", "Insurance", "International Affairs",
    "International Trade and Development", "Internet", "Investment Banking",
    "Investment Management", "Judiciary", "Law Enforcement",
    "Law Practice", "Legal Services", "Legislative Office",
    "Leisure, Travel & Tourism", "Libraries", "Logistics and Supply Chain",
    "Luxury Goods & Jewelry", "Machinery", "Management Consulting",
    "Maritime", "Market Research", "Marketing and Advertising",
    "Mechanical or Industrial Engineering", "Media Production", "Medical Devices",
    "Medical Practice", "Mental Health Care", "Military",
    "Mining & Metals", "Motion Pictures and Film", "Museums and Institutions",
    "Music", "Nanotechnology", "Newspapers",
    "Non-profit Organization Management", "Oil & Energy", "Online Media",
    "Outsourcing/Offshoring", "Package/Freight Delivery", "Packaging and Containers",
    "Paper & Forest Products", "Performing Arts", "Pharmaceuticals",
    "Philanthropy", "Photography", "Plastics",
    "Political Organization", "Primary/Secondary Education", "Printing",
    "Professional Training & Coaching", "Program Development", "Public Policy",
    "Public Relations and Communications", "Public Safety", "Publishing",
    "Railroad Manufacture", "Ranching", "Real Estate",
    "Recreational Facilities and Services", "Religious Institutions", "Renewables & Environment",
    "Research", "Restaurants", "Retail",
    "Security and Investigations", "Semiconductors", "Shipbuilding",
    "Sporting Goods", "Sports", "Staffing and Recruiting",
    "Supermarkets", "Telecommunications", "Textiles",
    "Think Tanks", "Tobacco", "Translation and Localization",
    "Transportation/Trucking/Railroad", "Utilities", "Venture Capital & Private Equity",
    "Veterinary", "Warehousing", "Wholesale",
    "Wine and Spirits", "Wireless", "Writing and Editing",
]);

const AUTO_REFINE_COOLDOWN_HOURS = 168;

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

    const proposal = await callGateway<{
        icpDescription: string;
        targetIndustry: string | null;
        targetRegion: string | null;
        refinementNotes: string;
    }>({
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
        responseMode: "structured",
        outputSchema: z.object({
            icpDescription: z.string(),
            targetIndustry: z.string().nullable(),
            targetRegion: z.string().nullable(),
            refinementNotes: z.string(),
        }),
        metadata: { campaignId },
        temperature: 0.3,
    });

    const refined: RefinedICP = proposal.payload;

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

    const existingState = await prisma.campaignStateStore.findUnique({
        where: { campaignId },
        select: { approvalStatuses: true },
    }).catch(() => null);

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

    const rawIndustry =
        typeof refined.targetIndustry === "string" ? refined.targetIndustry.trim() : null;

    const resolvedIndustry = rawIndustry
        ? APOLLO_INDUSTRY_TAXONOMY.has(rawIndustry)
            ? rawIndustry
            : (Array.from(APOLLO_INDUSTRY_TAXONOMY).find(
                  (tag) => tag.toLowerCase() === rawIndustry.toLowerCase()
              ) ?? null)
        : refined.targetIndustry === null
        ? null
        : undefined;

    if (rawIndustry && resolvedIndustry === null) {
        logger.warn(
            { campaignId, rawIndustry },
            "[icp-refinement.agent] LLM returned unrecognised industry tag — preserving existing value"
        );
    }

    const targetIndustryUpdate =
        resolvedIndustry !== undefined
            ? { targetIndustry: resolvedIndustry }
            : {};

    const targetRegionUpdate =
        typeof refined.targetRegion === "string" && refined.targetRegion.trim().length > 0
            ? { targetRegion: refined.targetRegion.trim() }
            : {};

    await prisma.campaign.update({
        where: { id: campaignId },
        data: {
            icpDescription: validDescription,
            ...targetIndustryUpdate,
            ...targetRegionUpdate,
        },
    });

    let attempts = 0;
    while (attempts < 5) {
        try {
            await prisma.campaignStateStore.upsert({
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
            break;
        } catch {
            attempts++;
            const delay = Math.floor(Math.random() * 200) + attempts * 100;
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }

    if (icpChanged) {
        await leadScoringQueue.add(
            "rescore-after-icp-refinement",
            { campaignId, pipelineStageFilter: "PROSPECT" },
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
            "[icp-refinement.agent] ICP changed — PROSPECT rescore job queued",
        );
    }

    logger.info(
        { campaignId, notes: refinementNotes, hasPerformanceData, icpChanged },
        "[icp-refinement.agent] ICP refined and saved",
    );

    return { ...refined, refinementNotes, icpDescription: validDescription };
}

const AUTO_REFINE_MIN_SENDS = 100;
const AUTO_REFINE_POSITIVE_REPLY_THRESHOLD = 0.03;

export async function shouldAutoRefineIcp(campaignId: string): Promise<boolean> {
    const stats = await getCampaignPerformance(campaignId);
    if (stats.contacted < AUTO_REFINE_MIN_SENDS) return false;
    if (stats.positiveReplyRate === null) return false;
    return stats.positiveReplyRate < AUTO_REFINE_POSITIVE_REPLY_THRESHOLD;
}

export async function triggerAutoIcpRefinement(campaignId: string): Promise<RefinedICP | null> {
    const needsRefinement = await shouldAutoRefineIcp(campaignId);
    if (!needsRefinement) return null;

    const stateStore = await prisma.campaignStateStore.findUnique({
        where: { campaignId },
        select: { approvalStatuses: true },
    });
    const approvals = (stateStore?.approvalStatuses as Record<string, unknown>) ?? {};
    const lastRefinement = approvals.icpRefinement as { refinedAt?: string } | undefined;
    if (lastRefinement?.refinedAt) {
        const lastRefinedAt = new Date(lastRefinement.refinedAt);
        const hoursSinceLastRefinement = (Date.now() - lastRefinedAt.getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastRefinement < AUTO_REFINE_COOLDOWN_HOURS) return null;
    }

    logger.info({ campaignId }, "[icp-refinement.agent] Auto-triggering ICP refinement — positive reply rate below 3%");
    return runIcpRefinementAgent(campaignId);
}