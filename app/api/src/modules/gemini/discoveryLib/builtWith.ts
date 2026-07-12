import pLimit from "p-limit";
import { logger } from "../../../lib/logger";
import { upsertCompanySignal } from "../../../lib/company/company.upsert";
import { circuitBreakerAllow, circuitBreakerFailure, circuitBreakerSuccess } from "./circuit.breaker";
import { cacheGetNullable, cacheSetNullable } from "./cache";
import { retryWithBackoff } from "./retry";
import { redisKeys } from "./redis.keys";
import type { BuiltWithTech } from "./discovery.types";
import {
    EXTERNAL_FETCH_TIMEOUT_MS, BUILTWITH_CONCURRENCY,
    BUILTWITH_CONFIDENCE,
    CACHE_TTL_BUILTWITH_S,
    BUILTWITH_MIN_TECH_COUNT,
} from "./discovery.constants";

const CB = "builtwith";

async function fetchBuiltWithSignal(domain: string): Promise<string | null> {
    if (!process.env.BUILTWITH_API_KEY) return null;

    const cacheKey = redisKeys.builtWith(domain);
    const cached = await cacheGetNullable(cacheKey);
    if (cached !== undefined) {
        logger.debug({ domain }, "[discovery/builtwith] Cache hit");
        return cached;
    }

    if (!(await circuitBreakerAllow(CB))) {
        logger.debug({ domain }, "[discovery/builtwith] Circuit breaker open — skipping");
        return null;
    }

    try {
        const result = await retryWithBackoff(async () => {
            const res = await fetch(
                `https://api.builtwith.com/free1/api.json?KEY=${process.env.BUILTWITH_API_KEY}&LOOKUP=${domain}`,
                { signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS) },
            );

            if (res.status === 429 || res.status >= 500) throw new Error(`BuiltWith ${res.status}`);
            if (!res.ok) return null;

            const data = await res.json() as {
                Results?: Array<{
                    Result?: {
                        Paths?: Array<{ Technologies?: BuiltWithTech[] }>;
                    };
                }>;
            };

            const techs = data.Results?.[0]?.Result?.Paths
                ?.flatMap(p => p.Technologies ?? [])
                .map(t => t.Name)
                .filter(Boolean) ?? [];

            if (techs.length < BUILTWITH_MIN_TECH_COUNT) return null;
            return techs.slice(0, 10).join(", ");
        }, CB);

        await cacheSetNullable(cacheKey, result, CACHE_TTL_BUILTWITH_S);
        return result;
    } catch (err) {
        logger.debug({ err, domain }, "[discovery/builtwith] Fetch error — tech signal skipped");
        await circuitBreakerFailure(CB);
        return null;
    }
}

export async function populateTechSignals(
    companyDomains: Array<{ companyId: string; domain: string }>,
): Promise<void> {
    const limit = pLimit(BUILTWITH_CONCURRENCY);

    await Promise.allSettled(
        companyDomains.map(({ companyId, domain }) =>
            limit(async () => {
                const techValue = await fetchBuiltWithSignal(domain);
                if (!techValue) return;

                await upsertCompanySignal({
                    companyId,
                    signalType: "TECH_SIGNAL",
                    value: techValue,
                    confidence: BUILTWITH_CONFIDENCE,
                    source: "builtwith",
                    explanation: `Tech stack detected: ${techValue}`,
                });

                logger.info({ companyId, domain }, "[discovery/builtwith] TECH_SIGNAL saved");
            }),
        ),
    );
}