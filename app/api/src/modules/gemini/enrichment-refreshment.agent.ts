import { Prisma, SignalType } from "@prisma/client";
import pLimit from "p-limit";
import { prisma } from "../../lib/prisma";
import { callGemini, extractJSON, MODELS } from "./gemini.client";
import { logger } from "../../lib/logger";
import { upsertCompanySignal } from "../../lib/company/company.upsert";
import { runLeadScoringAgent } from "./lead-scoring.agent";
import { ApiKeyVault } from "../../lib/key-manager";

const STALE_AFTER_DAYS: Record<string, number> = {
    HIGH_PRIORITY: 3,
    STANDARD: 7,
    NURTURE: 14,
    MAINTAIN: 30,
};
const SIGNAL_STRENGTH_THRESHOLD = 0.75;
const REFRESH_CONCURRENCY = 5;
const REFRESH_BATCH_SIZE = 50;
const MAX_LEADS_PER_RUN = 500;
const EXTERNAL_FETCH_TIMEOUT_MS = 12_000;
const FETCH_RETRY_ATTEMPTS = 3;
const FETCH_RETRY_BASE_DELAY_MS = 500;

const VALID_SIGNAL_TYPES = new Set<string>(Object.values(SignalType));

const refreshPlacesVault = new ApiKeyVault("google-places-refresh", "GOOGLE_PLACES_API_KEYS");

interface SerperResult {
    title: string;
    link: string;
    snippet: string;
}

interface GooglePlaceResult {
    name: string;
    rating?: number;
    types?: string[];
    business_status?: string;
}

interface NewSignal {
    type: string;
    value: string;
    confidence: number;
    explanation: string;
}

interface EnrichmentDiff {
    hasSignificantChange: boolean;
    newSignals: NewSignal[];
    changeReason: string;
}

function staleCutoffForAction(recommendedAction: string | null): Date {
    const days =
        (recommendedAction ? STALE_AFTER_DAYS[recommendedAction] : undefined) ??
        STALE_AFTER_DAYS.STANDARD;
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function staleClauseForAction(action: string): Prisma.LeadWhereInput {
    const cutoff = staleCutoffForAction(action);
    return {
        recommendedAction: action,
        OR: [
            {
                companyId: null,
                createdAt: { lte: cutoff },
            },
            {
                companyId: { not: null },
                company: {
                    OR: [
                        { lastEnrichedAt: null },
                        { lastEnrichedAt: { lte: cutoff } },
                    ],
                },
            },
        ],
    };
}

async function fetchWithRetry(
    fn: () => Promise<Response>,
): Promise<Response | null> {
    for (let attempt = 0; attempt < FETCH_RETRY_ATTEMPTS; attempt++) {
        try {
            const res = await fn();
            if (res.ok) return res;
            if (res.status >= 400 && res.status < 500) return null;
        } catch {
            // timeout or network error — fall through to retry
        }
        if (attempt < FETCH_RETRY_ATTEMPTS - 1) {
            await new Promise(r =>
                setTimeout(r, FETCH_RETRY_BASE_DELAY_MS * 2 ** attempt),
            );
        }
    }
    return null;
}

async function fetchWebSignals(companyName: string): Promise<SerperResult[]> {
    const currentYear = new Date().getFullYear();
    const res = await fetchWithRetry(() =>
        fetch("https://google.serper.dev/search", {
            method: "POST",
            headers: {
                "X-API-KEY": process.env.SERPER_API_KEY!,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                q: `${companyName} funding hiring news ${currentYear}`,
                num: 10,
            }),
            signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
        }),
    );

    if (!res) return [];
    try {
        const data = (await res.json()) as { organic?: SerperResult[] };
        return data.organic ?? [];
    } catch {
        return [];
    }
}

async function fetchGooglePlace(
    companyName: string,
    region?: string,
): Promise<GooglePlaceResult | null> {
    let key: string;
    try {
        key = await refreshPlacesVault.acquireKey();
    } catch {
        return null;
    }

    const url = new URL(
        "https://maps.googleapis.com/maps/api/place/textsearch/json",
    );
    url.searchParams.set(
        "query",
        `${companyName}${region ? ` ${region}` : ""}`,
    );
    url.searchParams.set("key", key);

    const res = await fetchWithRetry(() =>
        fetch(url.toString(), {
            signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
        }),
    );

    if (!res) return null;
    try {
        const data = (await res.json()) as { results?: GooglePlaceResult[] };
        return data.results?.[0] ?? null;
    } catch {
        return null;
    }
}

async function diffEnrichment(params: {
    leadId: string;
    companyName: string;
    existingSignals: Array<{ type: string; value: string; confidence: number }>;
    freshWebSignals: SerperResult[];
    freshPlaceData: GooglePlaceResult | null;
    icpDescription: string;
}): Promise<EnrichmentDiff> {
    const {
        leadId,
        companyName,
        existingSignals,
        freshWebSignals,
        freshPlaceData,
        icpDescription,
    } = params;

    const { text } = await callGemini({
        agentName: "enrichment-refresh.differ",
        model: MODELS.RESEARCH,
        systemPrompt: `You are a B2B lead intelligence analyst. Compare existing lead signals against fresh web data and identify material changes.

Material changes: new funding rounds, leadership hires or exits, product launches, acquisitions, layoffs, regulatory news, or any trigger that meaningfully changes buying readiness.

Return ONLY JSON:
{
  "hasSignificantChange": boolean,
  "newSignals": [
    {
      "type": one of "HIRING_SIGNAL" | "FUNDING_SIGNAL" | "GROWTH_SIGNAL" | "TECH_SIGNAL" | "INTENT_SIGNAL" | "RISK_SIGNAL",
      "value": string,
      "confidence": number (0.0–1.0),
      "explanation": string
    }
  ],
  "changeReason": string (1 sentence — most important change, or "No significant changes detected")
}

Return empty newSignals if nothing material found.`,
        userPrompt: `ICP: ${icpDescription}
Company: ${companyName}

Existing signals:
${existingSignals.map(s => `- ${s.type}: ${s.value} (confidence: ${s.confidence})`).join("\n") || "None"}

Fresh web signals (top 8):
${freshWebSignals.slice(0, 8).map((r, i) => `${i + 1}. ${r.title}: ${r.snippet}`).join("\n")}

Google Places update: ${freshPlaceData
                ? JSON.stringify({
                    rating: freshPlaceData.rating,
                    status: freshPlaceData.business_status,
                })
                : "unavailable"
            }`,
        metadata: { leadId },
        temperature: 0.2,
    });

    return extractJSON<EnrichmentDiff>(text);
}

export async function runEnrichmentRefreshForLead(
    leadId: string,
    campaignIcpDescription: string,
    campaignRegion?: string,
): Promise<boolean> {
    const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        include: {
            signals: { orderBy: { confidence: "desc" }, take: 10 },
            outreachMessages: {
                where: {
                    deliveryState: {
                        in: ["SENT", "DELIVERED", "OPENED", "REPLIED"],
                    },
                },
                take: 1,
            },
            company: {
                include: {
                    signals: { orderBy: { confidence: "desc" }, take: 10 },
                },
            },
        },
    });

    if (!lead) return false;

    const allExistingSignals = [
        ...lead.signals.map(s => ({
            type: s.signalType as string,
            value: s.value,
            confidence: s.confidence,
        })),
        ...(lead.company?.signals ?? []).map(s => ({
            type: s.signalType as string,
            value: s.value,
            confidence: s.confidence,
        })),
    ];

    const [freshWebSignals, freshPlaceData] = await Promise.all([
        fetchWebSignals(lead.companyName),
        fetchGooglePlace(lead.companyName, campaignRegion),
    ]);

    const diff = await diffEnrichment({
        leadId,
        companyName: lead.companyName,
        existingSignals: allExistingSignals,
        freshWebSignals,
        freshPlaceData,
        icpDescription: campaignIcpDescription,
    });

    if (!diff.hasSignificantChange || diff.newSignals.length === 0) return false;

    const strongNewSignals = diff.newSignals.filter(
        s =>
            s.confidence >= SIGNAL_STRENGTH_THRESHOLD &&
            VALID_SIGNAL_TYPES.has(s.type),
    );

    if (strongNewSignals.length === 0) return false;

    if (lead.companyId) {
        await Promise.all(
            strongNewSignals.map(s =>
                upsertCompanySignal({
                    companyId: lead.companyId!,
                    signalType: s.type,
                    value: s.value,
                    confidence: s.confidence,
                    source: "enrichment-refresh",
                    explanation: s.explanation,
                }),
            ),
        );

        const existingCompanyData = (lead.company?.enrichmentData ??
            {}) as Record<string, unknown>;

        await prisma.company.update({
            where: { id: lead.companyId },
            data: {
                enrichmentData: {
                    ...existingCompanyData,
                    lastRefreshedAt: new Date().toISOString(),
                    refreshChangeReason: diff.changeReason,
                    webSignals: freshWebSignals.slice(0, 5),
                    googlePlaces: freshPlaceData,
                } as unknown as Prisma.InputJsonValue,
                lastEnrichedAt: new Date(),
            },
        });
    } else {
        await prisma.leadSignal.createMany({
            data: strongNewSignals.map(s => ({
                leadId,
                type: s.type,
                signalType: s.type as SignalType,
                value: s.value,
                confidence: s.confidence,
                source: "enrichment-refresh",
                explanation: s.explanation,
            })),
            skipDuplicates: true,
        });

        const existingLeadData = (lead.enrichmentData ?? {}) as Record<
            string,
            unknown
        >;

        await prisma.lead.update({
            where: { id: leadId },
            data: {
                enrichmentData: {
                    ...existingLeadData,
                    lastRefreshedAt: new Date().toISOString(),
                    refreshChangeReason: diff.changeReason,
                    webSignals: freshWebSignals.slice(0, 5),
                    googlePlaces: freshPlaceData,
                } as unknown as Prisma.InputJsonValue,
            },
        });
    }

    logger.info(
        {
            leadId,
            signalCount: strongNewSignals.length,
            reason: diff.changeReason,
        },
        "[enrichment-refresh] New signals saved",
    );

    await runLeadScoringAgent(leadId, campaignIcpDescription, true);

    return true;
}

export async function runEnrichmentRefreshAgent(
    campaignId: string,
): Promise<void> {
    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { id: true, icpDescription: true, targetRegion: true },
    });

    if (!campaign) throw new Error("Campaign not found");

    const nullActionCutoff = staleCutoffForAction(null);

    let cursor: string | undefined;
    let checked = 0;
    let refreshed = 0;

    const limit = pLimit(REFRESH_CONCURRENCY);

    while (checked < MAX_LEADS_PER_RUN) {
        const remaining = MAX_LEADS_PER_RUN - checked;
        const batchSize = Math.min(REFRESH_BATCH_SIZE, remaining);

        const staleLeads = await prisma.lead.findMany({
            where: {
                campaignId,
                deletedAt: null,
                recommendedAction: { not: "DISQUALIFY" },
                OR: [
                    staleClauseForAction("HIGH_PRIORITY"),
                    staleClauseForAction("STANDARD"),
                    staleClauseForAction("NURTURE"),
                    staleClauseForAction("MAINTAIN"),
                    {
                        recommendedAction: null,
                        OR: [
                            {
                                companyId: null,
                                createdAt: { lte: nullActionCutoff },
                            },
                            {
                                companyId: { not: null },
                                company: {
                                    OR: [
                                        { lastEnrichedAt: null },
                                        {
                                            lastEnrichedAt: {
                                                lte: nullActionCutoff,
                                            },
                                        },
                                    ],
                                },
                            },
                        ],
                    },
                ],
            },
            select: { id: true, companyName: true },
            orderBy: { qualificationScore: "desc" },
            take: batchSize,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });

        if (staleLeads.length === 0) break;

        logger.info(
            { campaignId, batch: staleLeads.length, checked },
            "[enrichment-refresh] Checking stale leads",
        );

        const results = await Promise.allSettled(
            staleLeads.map(lead =>
                limit(async () =>
                    runEnrichmentRefreshForLead(
                        lead.id,
                        campaign.icpDescription,
                        campaign.targetRegion ?? undefined,
                    ),
                ),
            ),
        );

        checked += staleLeads.length;

        for (const result of results) {
            if (result.status === "fulfilled" && result.value) refreshed++;
            if (result.status === "rejected") {
                logger.error(
                    { err: result.reason },
                    "[enrichment-refresh] Failed for lead",
                );
            }
        }

        cursor = staleLeads[staleLeads.length - 1].id;
        if (staleLeads.length < batchSize) break;
    }

    logger.info({ campaignId, checked, refreshed }, "[enrichment-refresh] Done");
}