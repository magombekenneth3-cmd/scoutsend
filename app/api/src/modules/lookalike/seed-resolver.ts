import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { callGemini, extractJSON, MODELS } from "../gemini/gemini.client";

const MIN_SEEDS = 2;
const MAX_SEEDS = 5;

async function getSeedsFromWins(campaignId: string): Promise<string[]> {
    const wins = await prisma.winRecord.findMany({
        where: { campaignId },
        include: {
            outreachMessage: {
                include: {
                    lead: {
                        select: { website: true, companyName: true },
                    },
                },
            },
        },
        orderBy: { createdAt: "desc" },
        take: 20,
    });

    const urls: string[] = [];
    const seen = new Set<string>();

    for (const win of wins) {
        const website = win.outreachMessage.lead.website;
        if (!website) continue;
        const normalised = website.toLowerCase().replace(/\/$/, "");
        if (seen.has(normalised)) continue;
        seen.add(normalised);
        urls.push(website);
        if (urls.length >= MAX_SEEDS) break;
    }

    return urls;
}

async function getSeedsFromHighScoredLeads(campaignId: string): Promise<string[]> {
    const leads = await prisma.lead.findMany({
        where: {
            campaignId,
            deletedAt: null,
            website: { not: null },
            qualificationScore: { gte: 0.75 },
            replies: {
                some: {
                    intent: { in: ["POSITIVE", "MEETING_REQUEST"] },
                },
            },
        },
        select: { website: true },
        orderBy: { qualificationScore: "desc" },
        take: MAX_SEEDS,
    });

    return leads
        .map((l) => l.website)
        .filter((w): w is string => !!w);
}

async function getSeedsFromICP(
    icpDescription: string,
    targetIndustry: string | null,
    campaignId: string,
): Promise<string[]> {
    const { text } = await callGemini({
        agentName: "lookalike.seed-resolver",
        model: MODELS.RESEARCH,
        systemPrompt: `You are a B2B sales expert. Given an ICP description, return real company websites that are archetypal examples of that ICP. These will be used as seed companies for lookalike prospecting.

Rules:
- Only use well-known, publicly accessible company websites
- Companies must genuinely match the ICP — do not hallucinate obscure companies
- Return ONLY a JSON array of URL strings, no markdown, no preamble
- Max ${MAX_SEEDS} URLs`,
        userPrompt: `ICP: ${icpDescription}
Industry: ${targetIndustry ?? "not specified"}

Return ${MAX_SEEDS} real company website URLs that best represent this ICP as a JSON array.
Example format: ["https://stripe.com", "https://twilio.com"]`,
        temperature: 0.3,
        metadata: { campaignId, source: "icp-fallback" },
    });

    const urls = extractJSON<string[]>(text);
    if (!Array.isArray(urls)) return [];

    const valid = await Promise.all(
        urls.slice(0, MAX_SEEDS).map(async (url) => {
            try {
                const r = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(4000) });
                return r.ok ? url : null;
            } catch {
                return null;
            }
        }),
    );
    return valid.filter((u): u is string => u !== null);
}

export async function resolveLookalikeSeeds(campaignId: string): Promise<{
    urls: string[];
    source: "wins" | "high-scored-leads" | "icp-fallback" | "user-provided" | "insufficient" | "merged";
}> {
    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: {
            icpDescription: true,
            targetIndustry: true,
            enrichmentData: true,
        },
    });

    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    const ed = campaign.enrichmentData as Record<string, unknown> | null;
    const userProvided = Array.isArray(ed?.clientUrls) ? (ed.clientUrls as string[]) : [];

    const winSeeds = await getSeedsFromWins(campaignId);
    const leadSeeds = await getSeedsFromHighScoredLeads(campaignId);

    const mergedUrls: string[] = [];
    const seen = new Set<string>();

    const addUrls = (list: string[]) => {
        for (const url of list) {
            const normalised = url.toLowerCase().replace(/\/$/, "");
            if (!seen.has(normalised)) {
                seen.add(normalised);
                mergedUrls.push(url);
            }
        }
    };

    addUrls(winSeeds);
    addUrls(leadSeeds);
    addUrls(userProvided);

    if (mergedUrls.length >= MIN_SEEDS) {
        let sourceVal: "wins" | "high-scored-leads" | "user-provided" | "merged" = "merged";
        if (mergedUrls.length === winSeeds.length && winSeeds.every((u, i) => u === mergedUrls[i])) {
            sourceVal = "wins";
        } else if (mergedUrls.length === leadSeeds.length && leadSeeds.every((u, i) => u === mergedUrls[i])) {
            sourceVal = "high-scored-leads";
        } else if (mergedUrls.length === userProvided.length && userProvided.every((u, i) => u === mergedUrls[i])) {
            sourceVal = "user-provided";
        }

        logger.info({ campaignId, count: mergedUrls.length, source: sourceVal }, "[seed-resolver] Using merged seeds");
        return { urls: mergedUrls.slice(0, MAX_SEEDS), source: sourceVal };
    }

    const icpSeeds = await getSeedsFromICP(
        campaign.icpDescription,
        campaign.targetIndustry ?? null,
        campaignId,
    );

    if (icpSeeds.length >= MIN_SEEDS) {
        logger.info({ campaignId, count: icpSeeds.length }, "[seed-resolver] Using ICP-derived seeds");
        return { urls: icpSeeds, source: "icp-fallback" };
    }

    logger.warn({ campaignId }, "[seed-resolver] Could not resolve enough seed URLs — skipping lookalike");
    return { urls: [], source: "insufficient" };
}