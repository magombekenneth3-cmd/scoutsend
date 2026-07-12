import { createHash } from "crypto";
import pLimit from "p-limit";
import { prisma } from "@/app/api/src/lib/prisma";
import { logger } from "@/app/api/src/lib/logger";
import { emitCampaignEvent } from "@/app/api/src/lib/campaign-events";
import { scrapeCompanyText } from "./scrape";
import {
    extractSignals,
    synthesiseICP,
    enrichCompanyViaApollo,
    extractSignalsViaParametricKnowledge,
    CompanySignals,
    ICPProfile,
} from "./extract-signals";
import { queryApolloOrgs, ApolloOrg } from "./apolloCompanies";
import { rerankBySimilarity, RankedOrg } from "./rerank";

export interface LookalikeInput {
    clientUrls: string[];
    campaignId: string;
    userId: string;
    competitorTechUids?: string[];
}

export interface LookalikeResult {
    icpKeywords: string[];
    totalCandidates: number;
    skippedAlreadyEnriched: number;
    competitorLeadsFound: number;
    leads: Array<{
        apolloId: string;
        name: string;
        website?: string;
        industry?: string;
        employees?: number;
        description?: string;
        similarityScore: number;
        competitorSignal?: boolean;
        competitorTech?: string[];
    }>;
}

const SCRAPE_CONCURRENCY = 3;
const PERSIST_CONCURRENCY = 10;
const TOP_N = 50;

function urlHash(url: string): string {
    return createHash("sha256").update(url).digest("hex").slice(0, 16);
}

function normaliseDomain(raw: string | undefined): string | null {
    if (!raw) return null;
    try {
        const u = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
        return u.hostname.replace(/^www\./, "").toLowerCase();
    } catch {
        return raw.replace(/^www\./, "").toLowerCase();
    }
}

async function loadEnrichedDeduplicationSets(campaignId: string): Promise<{
    enrichedExternalIds: Set<string>;
    enrichedDomains: Set<string>;
    enrichedWebsites: Set<string>;
}> {
    const existing = await prisma.lead.findMany({
        where: {
            campaignId,
            deletedAt: null,
        },
        select: {
            externalId: true,
            website: true,
            enrichmentData: true,
        },
    });

    const enrichedExternalIds = new Set<string>();
    const enrichedDomains = new Set<string>();
    const enrichedWebsites = new Set<string>();

    for (const lead of existing) {
        if (lead.externalId) enrichedExternalIds.add(lead.externalId);

        const domain = normaliseDomain(lead.website ?? undefined);
        if (domain) enrichedDomains.add(domain);

        if (lead.website) enrichedWebsites.add(lead.website.toLowerCase());

        const ed = lead.enrichmentData as Record<string, unknown> | null;
        if (ed?.domain && typeof ed.domain === "string") {
            const edDomain = normaliseDomain(ed.domain);
            if (edDomain) enrichedDomains.add(edDomain);
        }
    }

    return { enrichedExternalIds, enrichedDomains, enrichedWebsites };
}

function isAlreadyEnriched(
    org: ApolloOrg,
    sets: {
        enrichedExternalIds: Set<string>;
        enrichedDomains: Set<string>;
        enrichedWebsites: Set<string>;
    }
): { skip: boolean; reason: string } {
    if (sets.enrichedExternalIds.has(org.id)) {
        return { skip: true, reason: "externalId already in campaign" };
    }

    const websiteDomain = normaliseDomain(org.website_url);
    if (websiteDomain && sets.enrichedDomains.has(websiteDomain)) {
        return { skip: true, reason: `domain ${websiteDomain} already in campaign` };
    }

    const primaryDomain = normaliseDomain(org.primary_domain);
    if (primaryDomain && sets.enrichedDomains.has(primaryDomain)) {
        return { skip: true, reason: `primary_domain ${primaryDomain} already in campaign` };
    }

    if (org.website_url && sets.enrichedWebsites.has(org.website_url.toLowerCase())) {
        return { skip: true, reason: "website_url already in campaign" };
    }

    const emailDomain = org.email ? normaliseDomain(org.email.split("@")[1]) : null;
    if (emailDomain && sets.enrichedDomains.has(emailDomain)) {
        return { skip: true, reason: `email domain ${emailDomain} already in campaign` };
    }

    return { skip: false, reason: "" };
}

async function loadCachedSignals(
    campaignId: string
): Promise<Record<string, CompanySignals>> {
    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { enrichmentData: true },
    });
    const ed = campaign?.enrichmentData as Record<string, unknown> | null;
    return (ed?.clientSignals as Record<string, CompanySignals>) ?? {};
}

async function persistEnrichmentData(
    campaignId: string,
    icpProfile: ICPProfile,
    icpVec: number[],
    updatedSignalCache: Record<string, CompanySignals>
): Promise<void> {
    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { enrichmentData: true },
    });
    const existing = (campaign?.enrichmentData as Record<string, unknown>) ?? {};

    await prisma.campaign.update({
        where: { id: campaignId },
        data: {
            enrichmentData: {
                ...existing,
                lookalikeICP: icpProfile as any,
                lookalikeIcpVec: icpVec,
                clientSignals: updatedSignalCache as any,
                lookalikeRunAt: new Date().toISOString(),
            } as any,
        },
    });
}

async function loadCachedIcpVec(campaignId: string): Promise<number[] | undefined> {
    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { enrichmentData: true },
    });
    const ed = campaign?.enrichmentData as Record<string, unknown> | null;
    const vec = ed?.lookalikeIcpVec;
    return Array.isArray(vec) ? (vec as number[]) : undefined;
}

type CompetitorMap = Map<string, string[]>;

export async function runLookalikeAgent(input: LookalikeInput): Promise<LookalikeResult> {
    const { clientUrls, campaignId, userId, competitorTechUids } = input;

    emitCampaignEvent({
        campaignId,
        type: "progress",
        jobName: "lookalike",
        label: "Lookalike Search",
        progress: 5,
        detail: "Analysing client websites…",
    });

    const cachedSignals = await loadCachedSignals(campaignId);
    const updatedSignalCache: Record<string, CompanySignals> = { ...cachedSignals };

    const scrapeLimit = pLimit(SCRAPE_CONCURRENCY);
    const signalResults = await Promise.allSettled(
        clientUrls.map((url) =>
            scrapeLimit(async () => {
                const hash = urlHash(url);
                if (cachedSignals[hash]) {
                    logger.info({ url }, "[lookalike] Using cached signals for URL");
                    return cachedSignals[hash];
                }

                const text = await scrapeCompanyText(url);
                if (text.trim().length >= 100) {
                    const signals = await extractSignals(url, text);
                    updatedSignalCache[hash] = signals;
                    logger.info({ url }, "[lookalike] Signals extracted via scrape");
                    return signals;
                }

                logger.warn(
                    { url, textLength: text.trim().length },
                    "[lookalike] Scrape returned insufficient text — falling back to Apollo enrichment"
                );

                let domain: string | null = null;
                try {
                    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
                    domain = u.hostname.replace(/^www\./, "").toLowerCase();
                } catch {
                    domain = url.replace(/^www\./, "").toLowerCase();
                }

                if (domain) {
                    const apolloSignals = await enrichCompanyViaApollo(domain, {
                        campaignId,
                        url,
                    });
                    if (apolloSignals) {
                        updatedSignalCache[hash] = apolloSignals;
                        logger.info({ url, domain }, "[lookalike] Signals extracted via Apollo enrichment");
                        return apolloSignals;
                    }
                }

                logger.warn(
                    { url, domain },
                    "[lookalike] Apollo enrichment failed — falling back to parametric knowledge"
                );

                const parametricSignals = await extractSignalsViaParametricKnowledge(url, {
                    campaignId,
                });
                if (parametricSignals) {
                    updatedSignalCache[hash] = parametricSignals;
                    logger.info({ url }, "[lookalike] Signals extracted via parametric knowledge");
                    return parametricSignals;
                }

                throw new Error(
                    `[lookalike] All signal-extraction tiers failed for ${url}. Scrape blocked, no Apollo record, and Gemini does not recognise the company.`
                );
            })
        )
    );

    const clientSignals: CompanySignals[] = signalResults
        .filter((r): r is PromiseFulfilledResult<CompanySignals> => r.status === "fulfilled")
        .map((r) => r.value);

    if (clientSignals.length < 1) {
        throw new Error(
            `Could only extract signals from ${clientSignals.length}/${clientUrls.length} URLs. Ensure the URLs are publicly accessible and try again.`
        );
    }

    logger.info(
        { campaignId, extracted: clientSignals.length },
        "[lookalike] Signals extracted"
    );

    emitCampaignEvent({
        campaignId,
        type: "progress",
        jobName: "lookalike",
        label: "Lookalike Search",
        progress: 25,
        detail: "Building ICP profile…",
    });

    const icpProfile = await synthesiseICP(clientSignals);

    logger.info(
        { campaignId, queryVariants: icpProfile.queryVariants },
        "[lookalike] ICP profile synthesised"
    );

    const cachedIcpVec = await loadCachedIcpVec(campaignId);

    emitCampaignEvent({
        campaignId,
        type: "progress",
        jobName: "lookalike",
        label: "Lookalike Search",
        progress: 40,
        detail: "Querying Apollo for lookalike companies…",
    });

    const [apolloCandidates, competitorCandidates] = await Promise.all([
        queryApolloOrgs({
            keywords: icpProfile.keywords,
            industries: icpProfile.apolloIndustries,
            employeeRanges: icpProfile.employeeRanges,
            queryVariants: icpProfile.queryVariants.slice(0, 3),
            excludeKeywords: icpProfile.excludeKeywords,
            perVariant: 20,
        }),
        competitorTechUids && competitorTechUids.length > 0
            ? queryApolloOrgs({
                keywords: icpProfile.keywords,
                industries: icpProfile.apolloIndustries,
                employeeRanges: icpProfile.employeeRanges,
                queryVariants: icpProfile.queryVariants.slice(0, 2),
                excludeKeywords: icpProfile.excludeKeywords,
                perVariant: 25,
                technologyUids: competitorTechUids,
            }).catch((err) => {
                logger.warn({ err }, "[lookalike] Competitor-tech lane failed — continuing without it");
                return [] as ApolloOrg[];
            })
            : Promise.resolve([] as ApolloOrg[]),
    ]);

    const competitorOrgIds: CompetitorMap = new Map();
    for (const org of competitorCandidates) {
        if (!competitorOrgIds.has(org.id)) {
            competitorOrgIds.set(org.id, competitorTechUids ?? []);
        }
    }

    const seen = new Set<string>(apolloCandidates.map((o) => o.id));
    const mergedCandidates: ApolloOrg[] = [...apolloCandidates];
    for (const org of competitorCandidates) {
        if (!seen.has(org.id)) {
            seen.add(org.id);
            mergedCandidates.push(org);
        }
    }

    logger.info(
        {
            campaignId,
            icpCandidates: apolloCandidates.length,
            competitorCandidates: competitorCandidates.length,
            merged: mergedCandidates.length,
        },
        "[lookalike] Apollo candidates retrieved (both lanes)"
    );

    const apolloCandidatesAll = mergedCandidates;

    if (apolloCandidatesAll.length === 0) {
        throw new Error(
            "Apollo returned no companies for the synthesised ICP. Try adding more client URLs or broadening the target industry."
        );
    }

    const dedupSets = await loadEnrichedDeduplicationSets(campaignId);

    let skippedAlreadyEnriched = 0;
    const candidatesToRank: ApolloOrg[] = [];

    for (const org of apolloCandidatesAll) {
        const { skip, reason } = isAlreadyEnriched(org, dedupSets);
        if (skip) {
            skippedAlreadyEnriched++;
            logger.debug(
                { orgId: org.id, name: org.name, reason },
                "[lookalike] Candidate skipped — already in campaign"
            );
            continue;
        }
        candidatesToRank.push(org);
    }

    logger.info(
        {
            campaignId,
            total: apolloCandidates.length,
            toRank: candidatesToRank.length,
            skipped: skippedAlreadyEnriched,
        },
        "[lookalike] Dedup against existing leads complete"
    );

    emitCampaignEvent({
        campaignId,
        type: "progress",
        jobName: "lookalike",
        label: "Lookalike Search",
        progress: 60,
        detail: `Ranking ${candidatesToRank.length} new candidates…`,
    });

    const { ranked, icpVec } = await rerankBySimilarity(
        clientSignals,
        candidatesToRank,
        cachedIcpVec
    );

    await persistEnrichmentData(campaignId, icpProfile, icpVec, updatedSignalCache);

    emitCampaignEvent({
        campaignId,
        type: "progress",
        jobName: "lookalike",
        label: "Lookalike Search",
        progress: 85,
        detail: "Persisting leads…",
    });

    const top = ranked.slice(0, TOP_N);

    const persistLimit = pLimit(PERSIST_CONCURRENCY);
    await Promise.allSettled(
        top.map((org) =>
            persistLimit(() => {
                const isCompetitorLead = competitorOrgIds.has(org.id);
                const competitorTechArr = isCompetitorLead
                    ? (competitorOrgIds.get(org.id) ?? [])
                    : [];

                return prisma.lead.upsert({
                    where: {
                        campaignId_externalId: { campaignId, externalId: org.id },
                    },
                    update: {
                        ...(isCompetitorLead && {
                            competitorSignal: true,
                            competitorTech: competitorTechArr,
                        }),
                        enrichmentData: {
                            apolloId: org.id,
                            similarityScore: org.similarityScore,
                            source: "lookalike",
                            domain: org.primary_domain,
                            industry: org.industry,
                            description: org.short_description,
                        },
                    },
                    create: {
                        campaignId,
                        companyName: org.name,
                        website: org.website_url,
                        source: "lookalike",
                        externalId: org.id,
                        competitorSignal: isCompetitorLead,
                        competitorTech: competitorTechArr,
                        enrichmentData: {
                            apolloId: org.id,
                            domain: org.primary_domain,
                            similarityScore: org.similarityScore,
                            source: "lookalike",
                            industry: org.industry,
                            description: org.short_description,
                        },
                    },
                });
            })
        )
    );

    const competitorLeadsFound = top.filter((org) => competitorOrgIds.has(org.id)).length;

    emitCampaignEvent({
        campaignId,
        type: "completed",
        jobName: "lookalike",
        label: "Lookalike Search",
        detail: `${top.length} companies found (${competitorLeadsFound} competitor users), ${skippedAlreadyEnriched} already in campaign`,
    });

    logger.info(
        { campaignId, leads: top.length, competitorLeads: competitorLeadsFound, skipped: skippedAlreadyEnriched, userId },
        "[lookalike] Agent complete"
    );

    return {
        icpKeywords: icpProfile.keywords,
        totalCandidates: apolloCandidatesAll.length,
        skippedAlreadyEnriched,
        competitorLeadsFound,
        leads: top.map((org) => ({
            apolloId: org.id,
            name: org.name,
            website: org.website_url,
            industry: org.industry,
            employees: org.estimated_num_employees,
            description: org.short_description,
            similarityScore: org.similarityScore,
            competitorSignal: competitorOrgIds.has(org.id),
            competitorTech: competitorOrgIds.get(org.id),
        })),
    };
}