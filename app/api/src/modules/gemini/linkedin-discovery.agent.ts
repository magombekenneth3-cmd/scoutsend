import { prisma } from "../../lib/prisma";
import { createLinkedInProvider } from "../../lib/linkedIn";
import { callGemini, extractJSON, MODELS } from "./gemini.client";
import { logger } from "../../lib/logger";
import { normaliseCompanyName } from "../../lib/company/company.upsert";
import { campaignQueue } from "./campaign.queue";
import { emitCampaignEvent } from "../../lib/campaign-events";
import { LINKEDIN_DISCOVERY_CONFIG } from "../../lib/linkedInAgent/linkedin-discovery.config";
import { persistDiscoveredLeads } from "../../lib/linkedInAgent/linkedDiscovery.persistence";
import type { DiscoveredLinkedInLead } from "../../lib/linkedInAgent/linked-discovery.types";

type LinkedInConnection = NonNullable<Awaited<ReturnType<typeof createLinkedInProvider>>>;

function jitteredDelay(): Promise<void> {
    const ms =
        LINKEDIN_DISCOVERY_CONFIG.MIN_DELAY_MS +
        Math.random() * (LINKEDIN_DISCOVERY_CONFIG.MAX_DELAY_MS - LINKEDIN_DISCOVERY_CONFIG.MIN_DELAY_MS);
    return new Promise(r => setTimeout(r, ms));
}

function buildLinkedInSearchUrl(query: string): string {
    return `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(query)}`;
}

async function generateSearchQueries(icpDescription: string): Promise<string[]> {
    const { text } = await callGemini({
        agentName: "linkedin-discovery.query-inference",
        model: MODELS.RESEARCH,
        systemPrompt: `You are a B2B sales strategist. Given an ICP description, return exactly 3 targeted search queries to find decision makers on LinkedIn. Each query should consist of job titles and industries (e.g. "VP Sales FinTech", "CTO Cybersecurity", "Head of Engineering").
Return ONLY a JSON array of strings. No preamble.`,
        userPrompt: `ICP: ${icpDescription}`,
        temperature: 0.1,
    });

    const queries = extractJSON<string[]>(text);
    return Array.isArray(queries) ? queries.filter((t): t is string => typeof t === "string") : [];
}

async function handleLinkedInSearchError(
    err: unknown,
    campaignId: string,
    query: string,
): Promise<{ rateLimited: boolean }> {
    const status = (err as { statusCode?: number })?.statusCode;
    if (status !== 429) {
        logger.warn({ campaignId, query, err }, "[linkedin-discovery] Search query failed");
        return { rateLimited: false };
    }

    const headers = (err as { headers?: { get?: (k: string) => string | null } })?.headers;
    const retryAfter = headers?.get?.("Retry-After");
    const waitMs = retryAfter
        ? parseInt(retryAfter, 10) * 1_000
        : LINKEDIN_DISCOVERY_CONFIG.DEFAULT_RATE_LIMIT_BACKOFF_MS;

    logger.warn({ campaignId, query, waitMs }, "[linkedin-discovery] Rate limited — backing off");
    await new Promise(r => setTimeout(r, waitMs));
    return { rateLimited: true };
}

async function crawlLinkedInLeads(
    provider: LinkedInConnection["provider"],
    account: LinkedInConnection["account"],
    searchQueries: string[],
    campaignId: string,
): Promise<DiscoveredLinkedInLead[]> {
    const discovered: DiscoveredLinkedInLead[] = [];
    let rateLimited = false;

    for (const query of searchQueries) {
        if (rateLimited) break;

        const searchUrl = buildLinkedInSearchUrl(query);
        logger.info({ campaignId, query, searchUrl }, "[linkedin-discovery] Searching LinkedIn URL");

        let cursor: string | undefined;
        let page = 0;

        do {
            try {
                const result = await provider.searchPeople(account, { queryUrl: searchUrl, cursor });
                for (const item of result.items) {
                    if (item.profileUrl && item.company) {
                        discovered.push({
                            fullName: item.fullName,
                            firstName: item.firstName,
                            lastName: item.lastName,
                            title: item.title,
                            companyName: item.company,
                            profileUrl: item.profileUrl,
                            headline: item.headline,
                            location: item.location,
                        });
                    }
                }
                cursor = result.cursor;
                page++;
            } catch (searchErr: unknown) {
                const outcome = await handleLinkedInSearchError(searchErr, campaignId, query);
                if (outcome.rateLimited) rateLimited = true;
                cursor = undefined;
            } finally {
                await jitteredDelay();
            }
        } while (cursor && page < LINKEDIN_DISCOVERY_CONFIG.MAX_PAGES_PER_QUERY);
    }

    return discovered;
}

function deduplicateDiscoveredLeads(leads: DiscoveredLinkedInLead[]): DiscoveredLinkedInLead[] {
    const seen = new Set<string>();
    return leads.filter(lead => {
        const key = `${normaliseCompanyName(lead.companyName)}::${lead.firstName ?? ""}::${lead.lastName ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

async function enqueueLeadScoring(leadIds: string[], campaignId: string, icpDescription: string): Promise<void> {
    for (let i = 0; i < leadIds.length; i += LINKEDIN_DISCOVERY_CONFIG.SCORE_BATCH_SIZE) {
        const chunk = leadIds.slice(i, i + LINKEDIN_DISCOVERY_CONFIG.SCORE_BATCH_SIZE);
        await campaignQueue.add(
            "score-lead-batch",
            {
                leadIds: chunk,
                campaignId,
                icpDescription,
            },
            {
                jobId: `linkedin-score-batch-${campaignId}-${i}`,
                removeOnComplete: { age: 300 },
                removeOnFail: { age: 3600 },
            },
        );
    }
}

function createProgressReporter(campaignId: string): (completed: number, total: number) => void {
    let lastEmittedPct = -1;
    return (completed: number, total: number) => {
        if (total === 0) return;
        const pct = Math.floor((completed / total) * 100);
        const isFinal = completed === total;
        if (!isFinal && pct - lastEmittedPct < LINKEDIN_DISCOVERY_CONFIG.PROGRESS_EMIT_THRESHOLD_PCT) return;
        lastEmittedPct = pct;
        emitCampaignEvent({
            campaignId,
            type: "progress",
            jobName: "run-linkedin-discovery",
            label: "LinkedIn Discovery Agent",
            progress: pct,
            detail: `Processing leads ${completed}/${total}`,
        });
    };
}

export async function runLinkedInDiscoveryAgent(campaignId: string): Promise<void> {
    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: {
            id: true,
            icpDescription: true,
            targetIndustry: true,
            targetRegion: true,
            linkedInAccountId: true,
        },
    });

    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    if (!campaign.linkedInAccountId) {
        logger.warn({ campaignId }, "[linkedin-discovery] No LinkedIn account configured for campaign — skipping");
        return;
    }

    const linkedin = await createLinkedInProvider(campaignId);
    if (!linkedin) {
        logger.warn({ campaignId }, "[linkedin-discovery] Failed to create LinkedIn provider — skipping");
        return;
    }

    const { provider, account } = linkedin;

    const runRecord = await prisma.discoveryRun.create({
        data: {
            sourceType: "LINKEDIN_SEARCH",
            status: "RUNNING",
            campaignId,
            query: `LinkedIn Search based on ICP`,
            startedAt: new Date(),
        },
    });

    try {
        logger.info({ campaignId }, "[linkedin-discovery] Starting LinkedIn discovery run");

        const searchQueries = await generateSearchQueries(campaign.icpDescription);
        if (searchQueries.length === 0) {
            throw new Error("Failed to infer search queries from ICP description");
        }

        const discovered = await crawlLinkedInLeads(provider, account, searchQueries, campaignId);

        if (discovered.length === 0) {
            logger.info({ campaignId }, "[linkedin-discovery] No leads found from search");
            await prisma.discoveryRun.update({
                where: { id: runRecord.id },
                data: {
                    status: "COMPLETED",
                    companiesFound: 0,
                    leadsFound: 0,
                    signalsFound: 0,
                    completedAt: new Date(),
                },
            });
            return;
        }

        const deduped = deduplicateDiscoveredLeads(discovered);
        logger.info(
            { campaignId, discovered: discovered.length, unique: deduped.length },
            "[linkedin-discovery] Deduplication complete",
        );

        const reportProgress = createProgressReporter(campaignId);
        const persistenceResult = await persistDiscoveredLeads(deduped, campaignId, reportProgress);

        await enqueueLeadScoring(persistenceResult.createdLeadIds, campaignId, campaign.icpDescription);

        await prisma.discoveryRun.update({
            where: { id: runRecord.id },
            data: {
                status: "COMPLETED",
                companiesFound: persistenceResult.processedCompanyIds.size,
                leadsFound: persistenceResult.created,
                signalsFound: persistenceResult.signalsCreated,
                completedAt: new Date(),
                ...(persistenceResult.failed > 0
                    ? { errorMessage: `${persistenceResult.failed} lead(s) failed to insert` }
                    : {}),
            },
        });

        emitCampaignEvent({
            campaignId,
            type: "completed",
            jobName: "run-linkedin-discovery",
            label: "LinkedIn Discovery Agent",
            detail: `${persistenceResult.created} leads created`,
        });
        logger.info(
            {
                campaignId,
                created: persistenceResult.created,
                skipped: persistenceResult.skipped,
                failed: persistenceResult.failed,
            },
            "[linkedin-discovery] Discovery complete",
        );
    } catch (err: any) {
        logger.error({ err, campaignId }, "[linkedin-discovery] Run failed");
        await prisma.discoveryRun.update({
            where: { id: runRecord.id },
            data: {
                status: "FAILED",
                errorMessage: err?.message || String(err),
                completedAt: new Date(),
            },
        });
        throw err;
    }
}