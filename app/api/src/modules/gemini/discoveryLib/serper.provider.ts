import { logger } from "../../../lib/logger";
import { serperSearch } from "../../../lib/serper";
import type { SerperResult } from "../../../lib/serper";
import { circuitBreakerAllow } from "./circuit.breaker";
import pLimit from "p-limit";

const CB = "serper";
const PER_DOMAIN_CONCURRENCY = 2;
const DEFAULT_LIMITER_KEY = "__default__";
const MAX_DOMAIN_LIMITERS = 1_000;

type DomainLimiter = ReturnType<typeof pLimit>;

const domainLimiters = new Map<string, DomainLimiter>();

function normalizeDomain(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/^www\./, "");
}

function getDomainLimiter(query: string): DomainLimiter {
    const domainMatch = query.match(/(?:^|\s)site:([^\s]+)/i);

    const key = domainMatch
        ? normalizeDomain(domainMatch[1])
        : DEFAULT_LIMITER_KEY;

    let limiter = domainLimiters.get(key);

    if (limiter) {
        return limiter;
    }

    if (domainLimiters.size >= MAX_DOMAIN_LIMITERS) {
        const oldestKey = domainLimiters.keys().next().value;

        if (oldestKey !== undefined) {
            domainLimiters.delete(oldestKey);
        }
    }

    limiter = pLimit(PER_DOMAIN_CONCURRENCY);
    domainLimiters.set(key, limiter);

    return limiter;
}

async function guardedSearch(
    query: string,
    type: "search" | "news",
): Promise<SerperResult[]> {
    const normalizedQuery = query.trim();

    if (!normalizedQuery) {
        return [];
    }

    if (!(await circuitBreakerAllow(CB))) {
        logger.warn(
            { query: normalizedQuery, type },
            "[discovery/serper] Circuit breaker open",
        );

        return [];
    }

    try {
        return await serperSearch(normalizedQuery, type);
    } catch (err) {
        logger.warn(
            { err, query: normalizedQuery, type },
            "[discovery/serper] Search failed",
        );

        return [];
    }
}

export async function searchAtsPostings(
    queries: string[],
): Promise<SerperResult[]> {
    if (queries.length === 0) {
        return [];
    }

    const uniqueQueries = Array.from(
        new Set(
            queries
                .map((query) => query.trim())
                .filter(Boolean),
        ),
    );

    if (uniqueQueries.length === 0) {
        return [];
    }

    const results = await Promise.all(
        uniqueQueries.map((query) => {
            const limiter = getDomainLimiter(query);

            return limiter(() => guardedSearch(query, "search"));
        }),
    );

    const deduped = new Map<string, SerperResult>();

    for (const result of results.flat()) {
        const link = result.link.trim();

        if (!link) {
            continue;
        }

        if (!deduped.has(link)) {
            deduped.set(link, result);
        }
    }

    return Array.from(deduped.values());
}

export async function searchHiringSignals(
    query: string,
): Promise<SerperResult[]> {
    return guardedSearch(query, "search");
}

export async function searchFundingSignals(
    industry: string,
    region: string,
    year: number,
): Promise<SerperResult[]> {
    const normalizedIndustry = industry.trim();
    const normalizedRegion = region.trim();

    if (!normalizedIndustry || !Number.isInteger(year)) {
        return [];
    }

    const regionClause = normalizedRegion
        ? `"${normalizedRegion}"`
        : "";

    return guardedSearch(
        `${normalizedIndustry} raised funding "Series" OR "seed round" ${regionClause} ${year}`.trim(),
        "news",
    );
}

export async function searchGrowthSignals(
    industry: string,
    region: string,
    year: number,
): Promise<SerperResult[]> {
    const normalizedIndustry = industry.trim();
    const normalizedRegion = region.trim();

    if (!normalizedIndustry || !Number.isInteger(year)) {
        return [];
    }

    const regionClause = normalizedRegion
        ? `"${normalizedRegion}"`
        : "";

    return guardedSearch(
        `${normalizedIndustry} expansion "opened" OR "launched" OR "growing" ${regionClause} ${year}`.trim(),
        "news",
    );
}