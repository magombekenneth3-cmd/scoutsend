import { Prisma, SignalType } from "@prisma/client";
import pLimit from "p-limit";
import { prisma } from "../../lib/prisma";
import { MODELS } from "./gemini.client";
import {
    callGateway,
    type EnrichmentDiffOutput,
    EnrichmentDiffOutputSchema,
} from "../../lib/llm-gateway";
import { logger } from "../../lib/logger";
import { upsertCompanySignal } from "../../lib/company/company.upsert";
import { runLeadScoringAgent } from "./lead-scoring.agent";
import { ApiKeyVault } from "../../lib/key-manager";
import { emailGenerationQueue } from "./campaign.queue";
import type { MaterialChangeReason } from "./generate.agent";
import { resolveSerperApiKey } from "../../lib/prospect-discovery/shared";

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
const CONTACTED_DELIVERY_STATES = new Set(["SENT", "DELIVERED", "OPENED", "REPLIED"]);
const ACTIVE_REGENERATION_CAMPAIGN_STATES = new Set([
    "GENERATING",
    "SENDING",
    "QUEUED",
    "RESEARCHING",
]);

const VALID_SIGNAL_TYPES = new Set<string>(Object.values(SignalType));

const refreshPlacesVault = new ApiKeyVault(
    "google-places-refresh",
    "GOOGLE_PLACES_API_KEYS",
);

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

export function findRegenerationCandidate<
    T extends { deliveryState: string; approvalStatus: string },
>(messages: T[]): T | null {
    if (messages.some((message) => CONTACTED_DELIVERY_STATES.has(message.deliveryState))) {
        return null;
    }

    return (
        messages.find(
            (message) =>
                message.deliveryState === "DRAFT" &&
                message.approvalStatus === "PENDING",
        ) ?? null
    );
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
            const response = await fn();
            if (response.ok) return response;
            if (response.status >= 400 && response.status < 500) return null;
        } catch {
        }

        if (attempt < FETCH_RETRY_ATTEMPTS - 1) {
            await new Promise((resolve) =>
                setTimeout(
                    resolve,
                    FETCH_RETRY_BASE_DELAY_MS * 2 ** attempt,
                ),
            );
        }
    }

    return null;
}

async function fetchWebSignals(companyName: string): Promise<SerperResult[]> {
    const apiKey = resolveSerperApiKey();
    if (!apiKey) return [];

    const currentYear = new Date().getFullYear();
    const response = await fetchWithRetry(() =>
        fetch("https://google.serper.dev/search", {
            method: "POST",
            headers: {
                "X-API-KEY": apiKey,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                q: `${companyName} funding hiring news ${currentYear}`,
                num: 10,
            }),
            signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
        }),
    );

    if (!response) return [];

    try {
        const data = (await response.json()) as { organic?: SerperResult[] };
        return Array.isArray(data.organic) ? data.organic : [];
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

    const response = await fetchWithRetry(() =>
        fetch(url.toString(), {
            signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
        }),
    );

    if (!response) return null;

    try {
        const data = (await response.json()) as {
            results?: GooglePlaceResult[];
        };
        return Array.isArray(data.results) ? data.results[0] ?? null : null;
    } catch {
        return null;
    }
}

function normalizeEnrichmentDiff(value: unknown): EnrichmentDiff {
    if (!value || typeof value !== "object") {
        return {
            hasSignificantChange: false,
            newSignals: [],
            changeReason: "No significant changes detected",
        };
    }

    const candidate = value as Record<string, unknown>;
    const rawSignals = Array.isArray(candidate.newSignals)
        ? candidate.newSignals
        : [];

    const newSignals = rawSignals.flatMap((item): NewSignal[] => {
        if (!item || typeof item !== "object") return [];

        const signal = item as Record<string, unknown>;
        if (
            typeof signal.type !== "string" ||
            typeof signal.value !== "string" ||
            typeof signal.confidence !== "number" ||
            !Number.isFinite(signal.confidence) ||
            typeof signal.explanation !== "string"
        ) {
            return [];
        }

        return [
            {
                type: signal.type.trim(),
                value: signal.value.trim(),
                confidence: Math.min(1, Math.max(0, signal.confidence)),
                explanation: signal.explanation.trim(),
            },
        ];
    });

    return {
        hasSignificantChange: candidate.hasSignificantChange === true,
        newSignals,
        changeReason:
            typeof candidate.changeReason === "string" &&
                candidate.changeReason.trim().length > 0
                ? candidate.changeReason.trim()
                : "No significant changes detected",
    };
}

async function diffEnrichment(params: {
    leadId: string;
    companyName: string;
    existingSignals: Array<{
        type: string;
        value: string;
        confidence: number;
    }>;
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

    // P0-B: callGemini → callGateway<EnrichmentDiffOutput>.
    // Enrichment diff is advisory CONTENT, not an authoritative state transition,
    // so executeProposalOnce is NOT required (System Law: content may be persisted as content).
    // normalizeEnrichmentDiff() remains the deterministic content normalizer after gateway validation.
    try {
        const proposal = await callGateway<EnrichmentDiffOutput>({
            agentName: "enrichment-refresh.differ",
            model: MODELS.RESEARCH,
            responseMode: "structured",
            outputSchema: EnrichmentDiffOutputSchema,
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
${existingSignals
                .map(
                    (signal) =>
                        `- ${signal.type}: ${signal.value} (confidence: ${signal.confidence})`,
                )
                .join("\n") || "None"
            }

Fresh web signals (top 8):
${freshWebSignals
                .slice(0, 8)
                .map((result, index) => `${index + 1}. ${result.title}: ${result.snippet}`)
                .join("\n") || "None"
            }

Google Places update: ${freshPlaceData
                ? JSON.stringify({
                    rating: freshPlaceData.rating,
                    status: freshPlaceData.business_status,
                })
                : "unavailable"
            }`,
            proposalContext: { leadId, campaignId: undefined },
            metadata: { leadId },
            temperature: 0.2,
        });
        return normalizeEnrichmentDiff(proposal.payload);
    } catch {
        return {
            hasSignificantChange: false,
            newSignals: [],
            changeReason: "No significant changes detected",
        };
    }
}

export interface RefreshLeadResult {
    refreshed: boolean;
    materialChange?: {
        leadId: string;
        changeReason: string;
    };
}

export async function runEnrichmentRefreshForLead(
    leadId: string,
    campaignIcpDescription: string,
    campaignRegion?: string,
): Promise<RefreshLeadResult> {
    const lead = await prisma.lead.findUnique({
        where: { id: leadId },
        include: {
            signals: {
                orderBy: { confidence: "desc" },
                take: 10,
            },
            outreachMessages: {
                orderBy: { createdAt: "desc" },
                take: 5,
            },
            company: {
                include: {
                    signals: {
                        orderBy: { confidence: "desc" },
                        take: 10,
                    },
                },
            },
        },
    });

    if (!lead) return { refreshed: false };

    const allExistingSignals = [
        ...lead.signals.map((signal) => ({
            type: signal.signalType as string,
            value: signal.value,
            confidence: signal.confidence,
        })),
        ...(lead.company?.signals ?? []).map((signal) => ({
            type: signal.signalType as string,
            value: signal.value,
            confidence: signal.confidence,
        })),
    ];

    const [freshWebSignals, freshPlaceData] = await Promise.all([
        fetchWebSignals(lead.companyName),
        fetchGooglePlace(lead.companyName, campaignRegion),
    ]);

    if (freshWebSignals.length === 0 && !freshPlaceData) return { refreshed: false };

    const diff = await diffEnrichment({
        leadId,
        companyName: lead.companyName,
        existingSignals: allExistingSignals,
        freshWebSignals,
        freshPlaceData,
        icpDescription: campaignIcpDescription,
    });

    if (!diff.hasSignificantChange || diff.newSignals.length === 0) return { refreshed: false };

    const strongNewSignals = diff.newSignals.filter(
        (signal) =>
            signal.value.length > 0 &&
            signal.explanation.length > 0 &&
            signal.confidence >= SIGNAL_STRENGTH_THRESHOLD &&
            VALID_SIGNAL_TYPES.has(signal.type),
    );

    if (strongNewSignals.length === 0) return { refreshed: false };

    if (lead.companyId) {
        // Atomic: upsert all company signals + update enrichmentData in a single transaction.
        // upsertCompanySignal accepts an optional tx parameter — pass it through so that
        // a partial failure (e.g. enrichmentData update fails) rolls back the signal writes.
        const existingCompanyData = (lead.company?.enrichmentData ??
            {}) as Record<string, unknown>;

        await prisma.$transaction(async (tx) => {
            await Promise.all(
                strongNewSignals.map((signal) =>
                    upsertCompanySignal(
                        {
                            companyId: lead.companyId!,
                            signalType: signal.type as SignalType,
                            value: signal.value,
                            confidence: signal.confidence,
                            source: "enrichment-refresh",
                            explanation: signal.explanation,
                        },
                        tx,
                    ),
                ),
            );

            await tx.company.update({
                where: { id: lead.companyId! },
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
        });
    } else {
        // Atomic: create lead signals + update enrichmentData in a single transaction.
        // Prevents a race where signals are written but the enrichmentData merge is lost.
        const existingLeadData = (lead.enrichmentData ?? {}) as Record<
            string,
            unknown
        >;

        await prisma.$transaction(async (tx) => {
            await tx.leadSignal.createMany({
                data: strongNewSignals.map((signal) => ({
                    leadId,
                    type: signal.type,
                    signalType: signal.type as SignalType,
                    value: signal.value,
                    confidence: signal.confidence,
                    source: "enrichment-refresh",
                    explanation: signal.explanation,
                })),
                skipDuplicates: true,
            });

            await tx.lead.update({
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

    const candidate = findRegenerationCandidate(lead.outreachMessages);
    let materialChange: { leadId: string; changeReason: string } | undefined;

    if (candidate) {
        const rescored = await prisma.lead.findUnique({
            where: { id: leadId },
            select: { recommendedAction: true },
        });

        if (rescored?.recommendedAction !== "DISQUALIFY") {
            materialChange = {
                leadId,
                changeReason: diff.changeReason,
            };

            logger.info(
                {
                    leadId,
                    outreachMessageId: candidate.id,
                    reason: diff.changeReason,
                },
                "[enrichment-refresh] Flagged draft candidate for regeneration",
            );
        }
    }

    return { refreshed: true, materialChange };
}

export async function runEnrichmentRefreshAgent(
    campaignId: string,
): Promise<void> {
    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: {
            id: true,
            icpDescription: true,
            targetRegion: true,
        },
    });

    if (!campaign) throw new Error("Campaign not found");

    const nullActionCutoff = staleCutoffForAction(null);

    let cursor: string | undefined;
    let checked = 0;
    let refreshed = 0;
    const accumulatedMaterialChanges: Array<{ leadId: string; changeReason: string }> = [];

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
            orderBy: [
                { qualificationScore: "desc" },
                { id: "asc" },
            ],
            take: batchSize,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });

        if (staleLeads.length === 0) break;

        logger.info(
            { campaignId, batch: staleLeads.length, checked },
            "[enrichment-refresh] Checking stale leads",
        );

        const results = await Promise.allSettled(
            staleLeads.map((lead) =>
                limit(() =>
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
            if (result.status === "fulfilled") {
                if (result.value.refreshed) refreshed++;
                if (result.value.materialChange) {
                    accumulatedMaterialChanges.push(result.value.materialChange);
                }
            } else if (result.status === "rejected") {
                logger.error(
                    { err: result.reason },
                    "[enrichment-refresh] Failed for lead",
                );
            }
        }

        cursor = staleLeads[staleLeads.length - 1].id;
        if (staleLeads.length < batchSize) break;
    }

    logger.info(
        { campaignId, checked, refreshed },
        "[enrichment-refresh] Done",
    );

    await enqueueFlaggedRegenerations(campaignId, accumulatedMaterialChanges);
}

async function enqueueFlaggedRegenerations(
    campaignId: string,
    materialChanges: Array<{ leadId: string; changeReason: string }>,
): Promise<void> {
    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { status: true },
    });

    if (
        !campaign ||
        !ACTIVE_REGENERATION_CAMPAIGN_STATES.has(campaign.status)
    ) {
        return;
    }

    if (materialChanges.length === 0) return;

    const materialChangeMap: Record<string, MaterialChangeReason> = {};

    for (const item of materialChanges) {
        materialChangeMap[item.leadId] = {
            leadId: item.leadId,
            changeReason:
                item.changeReason ??
                "New information became available about this lead.",
        };
    }

    if (Object.keys(materialChangeMap).length === 0) return;

    await emailGenerationQueue.add(
        "run-generate",
        { campaignId, materialChangeMap },
        {
            jobId: `run-generate-${campaignId}-material-change`,
            delay: 5_000,
            removeOnComplete: true,
        },
    );

    logger.info(
        { campaignId, leadCount: Object.keys(materialChangeMap).length },
        "[enrichment-refresh] Enqueued regeneration for leads with material context changes",
    );
}