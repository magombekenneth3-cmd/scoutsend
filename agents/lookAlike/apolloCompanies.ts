import pLimit from "p-limit";
import { logger } from "@/app/api/src/lib/logger";

const APOLLO_TIMEOUT_MS = 10_000;
const APOLLO_MAX_RETRIES = 3;
const APOLLO_RETRY_BASE = 2_000;
const APOLLO_RETRY_JITTER_MS = 500;
const APOLLO_MIN_CALL_INTERVAL_MS = 600;
const DEFAULT_PER_PAGE = 25;
const DEFAULT_MAX_PAGES = 4;
const DEFAULT_VARIANT_CONCURRENCY = 2;

const COMPANY_SUFFIX_PATTERN = /\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|group|holdings|plc|gmbh)\b\.?/g;

export interface ApolloOrg {
    id: string;
    name: string;
    website_url?: string;
    industry?: string;
    estimated_num_employees?: number;
    short_description?: string;
    keywords?: string[];
    primary_domain?: string;
    email?: string;
}

interface ApolloOrgsResponse {
    organizations?: ApolloOrg[];
}

interface FetchMetrics {
    retryCount: number;
    rateLimitCount: number;
}

class ApolloRateLimiter {
    private queue: Promise<void> = Promise.resolve();

    constructor(private readonly minIntervalMs: number) { }

    schedule<T>(fn: () => Promise<T>): Promise<T> {
        const run = this.queue.then(() => fn());
        this.queue = run
            .catch(() => undefined)
            .then(() => new Promise<void>((resolve) => setTimeout(resolve, this.minIntervalMs)));
        return run;
    }
}

class SearchBudget {
    private remaining: number;

    constructor(max?: number) {
        this.remaining = max ?? Infinity;
    }

    get exhausted(): boolean {
        return this.remaining <= 0;
    }

    reserve(count: number): number {
        if (this.remaining <= 0) return 0;
        const granted = Math.min(count, this.remaining);
        this.remaining -= granted;
        return granted;
    }
}

const apolloLimiter = new ApolloRateLimiter(APOLLO_MIN_CALL_INTERVAL_MS);

function isValidOrg(value: unknown): value is ApolloOrg {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Record<string, unknown>;

    if (typeof candidate.id !== "string" || candidate.id.length === 0) return false;
    if (typeof candidate.name !== "string" || candidate.name.length === 0) return false;

    if (candidate.website_url !== undefined && typeof candidate.website_url !== "string") return false;
    if (candidate.primary_domain !== undefined && typeof candidate.primary_domain !== "string") return false;
    if (candidate.industry !== undefined && typeof candidate.industry !== "string") return false;
    if (candidate.short_description !== undefined && typeof candidate.short_description !== "string") return false;
    if (candidate.email !== undefined && typeof candidate.email !== "string") return false;
    if (
        candidate.estimated_num_employees !== undefined &&
        typeof candidate.estimated_num_employees !== "number"
    )
        return false;
    if (
        candidate.keywords !== undefined &&
        (!Array.isArray(candidate.keywords) || candidate.keywords.some((k) => typeof k !== "string"))
    )
        return false;

    return true;
}

function normalizeDomain(org: ApolloOrg): string | null {
    const raw = org.primary_domain || org.website_url;
    if (!raw) return null;

    try {
        const withProtocol = raw.startsWith("http") ? raw : `https://${raw}`;
        const host = new URL(withProtocol).hostname.toLowerCase();
        return host.startsWith("www.") ? host.slice(4) : host;
    } catch {
        return raw.toLowerCase().replace(/^www\./, "");
    }
}

function normalizeCompanyName(name: string): string {
    return name
        .toLowerCase()
        .replace(COMPANY_SUFFIX_PATTERN, "")
        .replace(/[^a-z0-9]/g, "")
        .trim();
}

function matchesExcludeKeyword(orgText: string, keyword: string): boolean {
    const escaped = keyword.trim().toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!escaped) return false;
    return new RegExp(`\\b${escaped}\\b`, "i").test(orgText);
}

async function fetchOrgsPage(
    body: Record<string, unknown>,
    metrics: FetchMetrics,
): Promise<ApolloOrgsResponse> {
    let lastErr: Error | null = null;

    for (let attempt = 1; attempt <= APOLLO_MAX_RETRIES; attempt++) {
        let res: Response;
        try {
            res = await apolloLimiter.schedule(() =>
                fetch("https://api.apollo.io/api/v1/mixed_companies/search", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Cache-Control": "no-cache",
                        "X-Api-Key": process.env.APOLLO_API_KEY ?? "",
                    },
                    body: JSON.stringify(body),
                    signal: AbortSignal.timeout(APOLLO_TIMEOUT_MS),
                }),
            );
        } catch (err) {
            lastErr = err instanceof Error ? err : new Error(String(err));
            if (attempt < APOLLO_MAX_RETRIES) {
                metrics.retryCount += 1;
                const delay = APOLLO_RETRY_BASE * 2 ** (attempt - 1) + Math.random() * APOLLO_RETRY_JITTER_MS;
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            throw new Error(`Apollo companies network error: ${lastErr.message}`);
        }

        if (res.ok) {
            const json = (await res.json()) as ApolloOrgsResponse;
            if (json.organizations !== undefined && !Array.isArray(json.organizations)) {
                throw new Error("Apollo companies response malformed — organizations is not an array");
            }
            return {
                organizations: (json.organizations ?? []).filter(isValidOrg),
            };
        }

        if (res.status === 429 || res.status >= 500) {
            if (res.status === 429) metrics.rateLimitCount += 1;
            if (attempt < APOLLO_MAX_RETRIES) {
                metrics.retryCount += 1;
                logger.warn(
                    { status: res.status, attempt },
                    "[lookalike.apollo] Transient error — retrying",
                );
                const delay = APOLLO_RETRY_BASE * 2 ** (attempt - 1) + Math.random() * APOLLO_RETRY_JITTER_MS;
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            throw new Error(
                `Apollo companies HTTP ${res.status} after ${APOLLO_MAX_RETRIES} attempts`,
            );
        }

        if (res.status === 401)
            throw new Error("Apollo API key rejected (401) — verify APOLLO_API_KEY");
        if (res.status === 403)
            throw new Error(
                "Apollo API access denied (403) — key must be type master",
            );

        throw new Error(`Apollo companies unexpected HTTP ${res.status}`);
    }

    throw lastErr ?? new Error("Apollo companies fetch failed");
}

function buildApolloQuery(params: {
    variant: string;
    industries: string[];
    keywords: string[];
    employeeRanges: string[];
    technologyUids?: string[];
    page: number;
    perPage: number;
}): Record<string, unknown> {
    const { variant, industries, keywords, employeeRanges, technologyUids, page, perPage } = params;

    return {
        q_keywords: variant,
        ...(industries.length && { organization_industries: industries }),
        ...(keywords.length && { q_organization_keyword_tags: keywords }),
        ...(employeeRanges.length && {
            organization_num_employees_ranges: employeeRanges,
        }),
        ...(technologyUids?.length && {
            currently_using_any_of_technology_uids: technologyUids,
        }),
        page,
        per_page: perPage,
    };
}

interface VariantSearchResult {
    variant: string;
    organizations: ApolloOrg[];
    pagesFetched: number;
    accepted: number;
    excluded: number;
    retryCount: number;
    rateLimitCount: number;
    stoppedEarlyByBudget: boolean;
    durationMs: number;
}

interface SearchVariantParams {
    variant: string;
    industries: string[];
    keywords: string[];
    employeeRanges: string[];
    excludeKeywords: string[];
    technologyUids?: string[];
    perPage: number;
    maxPages: number;
    budget: SearchBudget;
}

async function searchVariant(params: SearchVariantParams): Promise<VariantSearchResult> {
    const {
        variant,
        industries,
        keywords,
        employeeRanges,
        excludeKeywords,
        technologyUids,
        perPage,
        maxPages,
        budget,
    } = params;

    const collected: ApolloOrg[] = [];
    const startedAt = Date.now();
    const metrics: FetchMetrics = { retryCount: 0, rateLimitCount: 0 };
    let pagesFetched = 0;
    let excludedCount = 0;
    let stoppedEarlyByBudget = false;

    for (let page = 1; page <= maxPages; page++) {
        if (budget.exhausted) {
            stoppedEarlyByBudget = true;
            break;
        }

        let data: ApolloOrgsResponse;
        try {
            data = await fetchOrgsPage(
                buildApolloQuery({ variant, industries, keywords, employeeRanges, technologyUids, page, perPage }),
                metrics,
            );
        } catch (err) {
            logger.warn(
                { variant, page, err },
                "[lookalike.apollo] Variant page failed — stopping pagination for this variant",
            );
            break;
        }

        pagesFetched += 1;
        const orgs = data.organizations ?? [];
        if (orgs.length === 0) break;

        const accepted: ApolloOrg[] = [];
        for (const org of orgs) {
            const orgText = [
                org.name,
                org.short_description,
                org.industry,
                ...(org.keywords ?? []),
            ]
                .join(" ")
                .toLowerCase();

            if (excludeKeywords.some((kw) => matchesExcludeKeyword(orgText, kw))) {
                excludedCount += 1;
                continue;
            }

            accepted.push(org);
        }

        const granted = budget.reserve(accepted.length);
        collected.push(...accepted.slice(0, granted));
        if (granted < accepted.length) stoppedEarlyByBudget = true;

        if (orgs.length < perPage || stoppedEarlyByBudget) break;
    }

    return {
        variant,
        organizations: collected,
        pagesFetched,
        accepted: collected.length,
        excluded: excludedCount,
        retryCount: metrics.retryCount,
        rateLimitCount: metrics.rateLimitCount,
        stoppedEarlyByBudget,
        durationMs: Date.now() - startedAt,
    };
}

export async function queryApolloOrgs(params: {
    keywords: string[];
    industries: string[];
    employeeRanges: string[];
    queryVariants: string[];
    excludeKeywords: string[];
    perVariant?: number;
    technologyUids?: string[];
    maxPagesPerVariant?: number;
    maxResults?: number;
    variantConcurrency?: number;
}): Promise<ApolloOrg[]> {
    const {
        keywords,
        industries,
        employeeRanges,
        queryVariants,
        excludeKeywords,
        perVariant = DEFAULT_PER_PAGE,
        technologyUids,
        maxPagesPerVariant = DEFAULT_MAX_PAGES,
        maxResults,
        variantConcurrency = DEFAULT_VARIANT_CONCURRENCY,
    } = params;

    const seenIds = new Set<string>();
    const seenDomains = new Set<string>();
    const seenNames = new Set<string>();
    const results: ApolloOrg[] = [];
    const limit = pLimit(variantConcurrency);
    const budget = new SearchBudget(maxResults);

    const variantOutcomes = await Promise.allSettled(
        queryVariants.map((variant) =>
            limit(() =>
                searchVariant({
                    variant,
                    industries,
                    keywords,
                    employeeRanges,
                    excludeKeywords,
                    technologyUids,
                    perPage: perVariant,
                    maxPages: maxPagesPerVariant,
                    budget,
                }),
            ),
        ),
    );

    let duplicatesById = 0;
    let duplicatesByDomain = 0;
    let duplicatesByName = 0;
    let totalPagesFetched = 0;
    let totalAccepted = 0;
    let totalExcluded = 0;
    let totalRetries = 0;
    let totalRateLimitHits = 0;
    let variantsStoppedEarly = 0;

    for (let i = 0; i < variantOutcomes.length; i++) {
        const outcome = variantOutcomes[i];

        if (outcome.status === "rejected") {
            logger.warn(
                { variant: queryVariants[i], err: outcome.reason },
                "[lookalike.apollo] Variant query failed — continuing",
            );
            continue;
        }

        const variantResult = outcome.value;
        totalPagesFetched += variantResult.pagesFetched;
        totalAccepted += variantResult.accepted;
        totalExcluded += variantResult.excluded;
        totalRetries += variantResult.retryCount;
        totalRateLimitHits += variantResult.rateLimitCount;
        if (variantResult.stoppedEarlyByBudget) variantsStoppedEarly += 1;

        logger.debug(
            {
                variant: variantResult.variant,
                pagesFetched: variantResult.pagesFetched,
                resultCount: variantResult.accepted,
                excludedCount: variantResult.excluded,
                retryCount: variantResult.retryCount,
                rateLimitCount: variantResult.rateLimitCount,
                stoppedEarlyByBudget: variantResult.stoppedEarlyByBudget,
                durationMs: variantResult.durationMs,
            },
            "[lookalike.apollo] Variant search complete",
        );

        for (const org of variantResult.organizations) {
            if (seenIds.has(org.id)) {
                duplicatesById += 1;
                continue;
            }

            const domain = normalizeDomain(org);
            if (domain && seenDomains.has(domain)) {
                duplicatesByDomain += 1;
                continue;
            }

            const normalizedName = normalizeCompanyName(org.name);
            if (!domain && normalizedName && seenNames.has(normalizedName)) {
                duplicatesByName += 1;
                continue;
            }

            seenIds.add(org.id);
            if (domain) seenDomains.add(domain);
            if (normalizedName) seenNames.add(normalizedName);
            results.push(org);
        }
    }

    logger.info(
        {
            variantCount: queryVariants.length,
            resultCount: results.length,
            totalPagesFetched,
            totalAccepted,
            totalExcluded,
            duplicatesById,
            duplicatesByDomain,
            duplicatesByName,
            averagePageSize: totalPagesFetched > 0 ? totalAccepted / totalPagesFetched : 0,
            totalRetries,
            totalRateLimitHits,
            variantsStoppedEarly,
        },
        "[lookalike.apollo] Query complete",
    );

    return results;
}