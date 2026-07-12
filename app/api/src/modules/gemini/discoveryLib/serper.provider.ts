import { logger } from "../../../lib/logger";
import { serperSearch } from "../../../lib/serper";
import type { SerperResult } from "../../../lib/serper";
import { circuitBreakerAllow } from "./circuit.breaker";
import { retryWithBackoff } from "./retry";

const CB = "serper";

async function guardedSearch(query: string, type: "search" | "news"): Promise<SerperResult[]> {
    if (!(await circuitBreakerAllow(CB))) {
        logger.warn({ query }, "[discovery/serper] Circuit breaker open — returning empty results");
        return [];
    }
    return retryWithBackoff(() => serperSearch(query, type), CB);
}

export async function searchAtsPostings(queries: string[]): Promise<SerperResult[]> {
    if (queries.length === 0) return [];
    const results = await Promise.all(queries.map(q => guardedSearch(q, "search")));
    return Array.from(new Map(results.flat().map(r => [r.link, r])).values());
}

export async function searchHiringSignals(query: string): Promise<SerperResult[]> {
    return guardedSearch(query, "search");
}

export async function searchFundingSignals(industry: string, region: string, year: number): Promise<SerperResult[]> {
    const regionClause = region ? `"${region}"` : "";
    return guardedSearch(
        `${industry} raised funding "Series" OR "seed round" ${regionClause} ${year}`.trim(),
        "news",
    );
}

export async function searchGrowthSignals(industry: string, region: string, year: number): Promise<SerperResult[]> {
    const regionClause = region ? `"${region}"` : "";
    return guardedSearch(
        `${industry} expansion "opened" OR "launched" OR "growing" ${regionClause} ${year}`.trim(),
        "news",
    );
}