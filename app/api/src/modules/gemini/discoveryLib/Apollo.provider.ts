import { logger } from "../../../lib/logger";
import { ApiKeyVault } from "../../../lib/key-manager";
import { circuitBreakerAllow, circuitBreakerFailure, circuitBreakerSuccess } from "./circuit.breaker";
import {
    APOLLO_SEARCH_PER_PAGE,
    APOLLO_MAX_PAGES,
    APOLLO_PAGE_CONCURRENCY,
    APOLLO_INTERPAGE_DELAY_MS,
    APOLLO_FAILED_PAGE_RETRY_DELAY_MS,
    APOLLO_CONFIDENCE,
    EXTERNAL_FETCH_TIMEOUT_MS,
    RETRY_MAX_ATTEMPTS,
    RETRY_BASE_DELAY_MS,
    SOURCE_WEIGHTS,
} from "./discovery.constants";
import { computeWeightedScore } from "./discovery";
import type { ApolloPersonResult, ApolloPageResult, DiscoveredLead } from "./discovery.types";

const CB = "apollo";
const apolloVault = new ApiKeyVault("apollo", "APOLLO_API_KEYS");

interface ApolloSearchParams {
    titles: string[];
    industry?: string;
    region?: string;
    seniority?: string[];
    employeeRanges?: string[];
    fundingStages?: string[];
    technologies?: string[];
}

async function apolloPageFetch(params: ApolloSearchParams & { page: number }): Promise<ApolloPageResult> {
    let key: string;
    try {
        key = await apolloVault.acquireKey();
    } catch {
        return { ok: true, page: params.page, people: [] };
    }

    if (!(await circuitBreakerAllow(CB))) {
        logger.warn({ page: params.page }, "[discovery/apollo] Circuit breaker open — skipping page fetch");
        return { ok: false, page: params.page, error: new Error("Circuit breaker open for apollo") };
    }

    const body: Record<string, unknown> = {
        person_titles: params.titles,
        page: params.page,
        per_page: APOLLO_SEARCH_PER_PAGE,
    };
    if (params.industry) body.q_keywords = params.industry;
    if (params.region) body.person_locations = [params.region];
    if (params.seniority?.length) body.person_seniorities = params.seniority;
    if (params.employeeRanges?.length) body.organization_num_employees_ranges = params.employeeRanges;
    if (params.fundingStages?.length) body.organization_latest_funding_stage_cd = params.fundingStages;
    if (params.technologies?.length) body.currently_using_any_of_technology_uids = params.technologies;

    let lastRateLimitDelay = 0;

    for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) {
            const backoff = lastRateLimitDelay > 0
                ? lastRateLimitDelay
                : RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
            await new Promise(r => setTimeout(r, backoff));
            lastRateLimitDelay = 0;
        }

        let res: Response;
        try {
            res = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": "no-cache",
                    "X-Api-Key": key,
                },
                body: JSON.stringify(body),
                signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
            });
        } catch (fetchErr) {
            if (attempt < RETRY_MAX_ATTEMPTS - 1) continue;
            await circuitBreakerFailure(CB);
            return { ok: false, page: params.page, error: fetchErr };
        }

        if (res.status === 429 || res.status === 401 || res.status === 402 || res.status === 403) {
            await apolloVault.reportFailure(key, res.status);
            try { key = await apolloVault.acquireKey(); } catch { }
            const retryAfter = res.status === 429 ? Number(res.headers.get("retry-after") ?? 2) * 1_000 : 0;
            lastRateLimitDelay = retryAfter;
            if (attempt < RETRY_MAX_ATTEMPTS - 1) continue;
            await circuitBreakerFailure(CB);
            return {
                ok: false,
                page: params.page,
                error: new Error(`Apollo key exhausted on page ${params.page} after ${RETRY_MAX_ATTEMPTS} attempts`),
            };
        }

        if (res.status >= 500) {
            if (attempt < RETRY_MAX_ATTEMPTS - 1) continue;
            await circuitBreakerFailure(CB);
            return { ok: false, page: params.page, error: new Error(`Apollo ${res.status} on page ${params.page}`) };
        }

        if (!res.ok) {
            logger.warn({ status: res.status, page: params.page }, "[discovery/apollo] Non-OK response");
            return { ok: true, page: params.page, people: [] };
        }

        const data = await res.json() as { people?: ApolloPersonResult[] };
        await circuitBreakerSuccess(CB);
        return { ok: true, page: params.page, people: data.people ?? [] };
    }

    await circuitBreakerFailure(CB);
    return { ok: false, page: params.page, error: new Error(`Apollo page ${params.page} exhausted all retry attempts`) };
}

export async function apolloPeopleSearchMultiPage(
    params: ApolloSearchParams & { maxPages?: number },
): Promise<ApolloPersonResult[]> {
    const maxPages = params.maxPages ?? APOLLO_MAX_PAGES;
    const { maxPages: _dropped, ...searchParams } = { ...params, maxPages };
    const all: ApolloPersonResult[] = [];
    const failedPages: number[] = [];

    for (let pageStart = 1; pageStart <= maxPages; pageStart += APOLLO_PAGE_CONCURRENCY) {
        if (!(await circuitBreakerAllow(CB))) {
            logger.warn({ pageStart }, "[discovery/apollo] Circuit breaker open — aborting pagination");
            break;
        }

        const batchSize = Math.min(APOLLO_PAGE_CONCURRENCY, maxPages - pageStart + 1);
        const pages = Array.from({ length: batchSize }, (_, i) => pageStart + i);

        const batchResults = await Promise.all(
            pages.map(page => apolloPageFetch({ ...searchParams, page })),
        );

        let exhausted = false;
        for (const result of batchResults) {
            if (result.ok) {
                all.push(...result.people);
                if (result.people.length === 0) exhausted = true;
            } else {
                logger.warn({ page: result.page, error: result.error }, "[discovery/apollo] Page fetch failed — queued for retry");
                failedPages.push(result.page);
            }
        }

        if (exhausted) break;
        if (pageStart + batchSize <= maxPages) {
            await new Promise(r => setTimeout(r, APOLLO_INTERPAGE_DELAY_MS));
        }
    }

    if (failedPages.length > 0) {
        logger.info({ failedPages }, "[discovery/apollo] Retrying failed pages individually");
        for (const page of failedPages) {
            if (!(await circuitBreakerAllow(CB))) {
                logger.warn({ page }, "[discovery/apollo] Circuit breaker open — skipping failed page retry");
                break;
            }
            await new Promise(r => setTimeout(r, APOLLO_FAILED_PAGE_RETRY_DELAY_MS));
            const result = await apolloPageFetch({ ...searchParams, page });
            if (result.ok) {
                all.push(...result.people);
                logger.info({ page, count: result.people.length }, "[discovery/apollo] Failed page recovered");
            } else {
                logger.warn({ page, error: result.error }, "[discovery/apollo] Page unrecoverable after dedicated retry");
            }
        }
    }

    return all;
}

export function apolloPersonToDiscoveredLead(person: ApolloPersonResult): DiscoveredLead | null {
    if (!person.organization_name?.trim()) return null;

    const title = person.title ?? undefined;
    const website = person.organization?.website_url ?? undefined;
    const source = "apollo_search";
    const rawConfidence = APOLLO_CONFIDENCE;
    const sw = SOURCE_WEIGHTS[source]!;

    return {
        companyName: person.organization_name,
        website,
        linkedinUrl: person.organization?.linkedin_url ?? person.linkedin_url ?? undefined,
        firstName: person.first_name ?? undefined,
        lastName: person.last_name ?? undefined,
        title,
        email: person.email ?? undefined,
        externalId: person.id,
        signalType: "INTENT_SIGNAL",
        signalValue: title
            ? `${title} at ${person.organization_name}`
            : `Decision-maker at ${person.organization_name}`,
        rawConfidence,
        sourceWeight: sw,
        weightedScore: computeWeightedScore(rawConfidence, source),
        explanation: "Direct contact identified via Apollo people search",
        source,
    };
}