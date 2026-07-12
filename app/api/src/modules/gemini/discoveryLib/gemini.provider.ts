import pLimit from "p-limit";
import { logger } from "../../../lib/logger";
import { callGemini, extractJSON, MODELS } from "../gemini.client";
import { serperSearch } from "../../../lib/serper";
import type { SerperResult } from "../../../lib/serper";
import { circuitBreakerAllow } from "./circuit.breaker";
import { retryWithBackoff } from "./retry";
import { cacheGet, cacheSet } from "./cache";
import { redisKeys } from "./redis.keys";
import {
    FALLBACK_CONCURRENCY,
    GEMINI_FALLBACK_COMPANY_COUNT,
    MIN_DISCOVERY_CONFIDENCE,
    CACHE_TTL_TITLE_INFERENCE_S,
    CACHE_TTL_ATS_INGREDIENTS_S,
    ATS_SITE_CLAUSE,
    ATS_QUERIES_PER_RUN,
    ATS_NON_CONFIRMED_CONFIDENCE_CAP,
    SOURCE_WEIGHTS,
    DEFAULT_SOURCE_WEIGHT,
} from "./discovery.constants";
import {
    buildTitleInferencePrompt,
    buildAtsIngredientsPrompt,
    buildGeminiFallbackPrompt,
    buildLeadExtractorPrompt,
} from "./prompt";
import { isAtsUrl, computeWeightedScore, sourceWeight, icpHash } from "./discovery";
import type { DiscoveredLead, AtsQueryIngredients, DiscoverySignalType } from "./discovery.types";

const CB = "gemini";
const geminiLimit = pLimit(Number(process.env.GEMINI_CONCURRENCY ?? 2));

function callGeminiGated(options: Parameters<typeof callGemini>[0]) {
    return geminiLimit(() => retryWithBackoff(() => callGemini(options), CB));
}

export async function inferDecisionMakerTitles(icpDescription: string): Promise<string[]> {
    const cacheKey = redisKeys.titleInference(icpHash(icpDescription));
    const cached = await cacheGet<string[]>(cacheKey);
    if (cached) {
        logger.debug({ cacheKey }, "[discovery/gemini] Title inference cache hit");
        return cached;
    }

    const { text } = await callGeminiGated({
        agentName: "multi-source-discovery.title-inference",
        model: MODELS.RESEARCH,
        ...buildTitleInferencePrompt(icpDescription),
        temperature: 0.1,
    });

    const titles = extractJSON<string[]>(text);
    const result = Array.isArray(titles) ? titles.filter((t): t is string => typeof t === "string") : [];

    if (result.length > 0) await cacheSet(cacheKey, result, CACHE_TTL_TITLE_INFERENCE_S);
    return result;
}

export async function expandAtsQueryIngredients(params: {
    icpDescription: string;
    targetIndustry: string;
}): Promise<AtsQueryIngredients> {
    const { icpDescription, targetIndustry } = params;
    const cacheKey = redisKeys.atsIngredients(icpHash(icpDescription + targetIndustry));

    const cached = await cacheGet<AtsQueryIngredients>(cacheKey);
    if (cached) {
        logger.debug({ cacheKey }, "[discovery/gemini] ATS ingredients cache hit");
        return cached;
    }

    const { text } = await callGeminiGated({
        agentName: "multi-source-discovery.ats-query-expansion",
        model: MODELS.RESEARCH,
        ...buildAtsIngredientsPrompt(icpDescription, targetIndustry),
        temperature: 0.15,
    });

    try {
        const parsed = extractJSON<AtsQueryIngredients>(text);
        if (parsed && Array.isArray(parsed.roleTitles) && parsed.roleTitles.length > 0) {
            const result: AtsQueryIngredients = {
                roleTitles: parsed.roleTitles.filter((t): t is string => typeof t === "string"),
                techTerms: (parsed.techTerms ?? []).filter((t): t is string => typeof t === "string"),
                departmentTerms: (parsed.departmentTerms ?? []).filter((t): t is string => typeof t === "string"),
            };
            await cacheSet(cacheKey, result, CACHE_TTL_ATS_INGREDIENTS_S);
            return result;
        }
    } catch (err) {
        logger.warn({ err }, "[discovery/gemini] ATS query expansion JSON parse failed — falling back to empty ingredients");
    }

    return { roleTitles: [], techTerms: [], departmentTerms: [] };
}

export function buildAtsSerperQueries(params: {
    ingredients: AtsQueryIngredients;
    region: string;
}): string[] {
    const { ingredients, region } = params;
    if (ingredients.roleTitles.length === 0) return [];

    const regionClause = region ? `"${region}"` : "";

    return ingredients.roleTitles
        .slice(0, ATS_QUERIES_PER_RUN)
        .map((role, i) => {
            const techClause = ingredients.techTerms[i] ? `"${ingredients.techTerms[i]}"` : "";
            return [ATS_SITE_CLAUSE, `"${role}"`, techClause, regionClause].filter(Boolean).join(" ");
        });
}

export function buildGenericHiringQuery(params: {
    icpDescription: string;
    region: string;
    currentYear: number;
}): string {
    const { icpDescription, region, currentYear } = params;
    const phrase = icpDescription.split(/\s+/).slice(0, 6).join(" ");
    const regionClause = region ? `"${region}"` : "";
    return [`"${phrase}"`, `("we're hiring" OR "now hiring" OR "join our team")`, regionClause, String(currentYear)]
        .filter(Boolean)
        .join(" ");
}

export async function extractLeadsFromSerperResults(params: {
    results: SerperResult[];
    icpDescription: string;
    signalType: Exclude<DiscoverySignalType, "TECH_SIGNAL">;
    source: string;
    enforceAtsSignal: boolean;
}): Promise<DiscoveredLead[]> {
    const { results, icpDescription, signalType, source, enforceAtsSignal } = params;

    if (results.length === 0) return [];

    if (!(await circuitBreakerAllow(CB))) {
        logger.warn({ source }, "[discovery/gemini] Circuit breaker open — skipping Serper extraction");
        return [];
    }

    type RawItem = {
        sourceIndex: number;
        companyName: string;
        website?: string | null;
        linkedinUrl?: string | null;
        firstName?: string | null;
        lastName?: string | null;
        title?: string | null;
        email?: string | null;
        signalValue: string;
        confidence: number;
        explanation: string;
    };

    const { text } = await callGeminiGated({
        agentName: "multi-source-discovery.extractor",
        model: MODELS.RESEARCH,
        ...buildLeadExtractorPrompt(icpDescription, signalType, results),
        temperature: 0.2,
    });

    const extracted = extractJSON<RawItem[]>(text);
    const sw = sourceWeight(source);

    return extracted
        .filter(e => e.confidence >= MIN_DISCOVERY_CONFIDENCE && e.companyName?.trim())
        .map(e => {
            const sourceIdx = typeof e.sourceIndex === "number" ? e.sourceIndex - 1 : -1;
            const sourceUrl = sourceIdx >= 0 && sourceIdx < results.length
                ? (results[sourceIdx]?.link ?? "")
                : "";
            const resolvedSignalType: Exclude<DiscoverySignalType, "TECH_SIGNAL"> =
                enforceAtsSignal && isAtsUrl(sourceUrl) ? "HIRING_SIGNAL" : signalType;
            const rawConfidence = enforceAtsSignal && !isAtsUrl(sourceUrl)
                ? Math.min(e.confidence, ATS_NON_CONFIRMED_CONFIDENCE_CAP)
                : e.confidence;

            return {
                companyName: e.companyName,
                website: e.website ?? undefined,
                linkedinUrl: e.linkedinUrl ?? undefined,
                firstName: e.firstName ?? undefined,
                lastName: e.lastName ?? undefined,
                title: e.title ?? undefined,
                email: e.email ?? undefined,
                signalType: resolvedSignalType,
                signalValue: e.signalValue,
                rawConfidence,
                sourceWeight: sw,
                weightedScore: computeWeightedScore(rawConfidence, source),
                explanation: e.explanation,
                source,
            };
        });
}

export async function runGeminiCompanyFallback(params: {
    icpDescription: string;
    industry: string;
    region: string;
}): Promise<DiscoveredLead[]> {
    const { icpDescription, industry, region } = params;

    if (!(await circuitBreakerAllow(CB))) {
        logger.warn({ industry, region }, "[discovery/gemini] Circuit breaker open — skipping fallback");
        return [];
    }

    logger.info({ industry, region }, "[discovery/gemini] Apollo returned 0 results — running Gemini company fallback");

    const { text } = await callGeminiGated({
        agentName: "multi-source-discovery.gemini-fallback",
        model: MODELS.RESEARCH,
        ...buildGeminiFallbackPrompt(icpDescription, industry, region),
        temperature: 0.3,
    });

    type RawCompany = { companyName: string; website: string | null; decisionMakerTitle: string };
    let companies: RawCompany[] = [];
    try {
        const parsed = extractJSON<RawCompany[]>(text);
        companies = Array.isArray(parsed) ? parsed.filter(c => c.companyName?.trim()) : [];
    } catch (err) {
        logger.warn({ err }, "[discovery/gemini] Fallback JSON parse failed");
        return [];
    }

    const leads: DiscoveredLead[] = [];
    const fallbackLimit = pLimit(FALLBACK_CONCURRENCY);

    const results = await Promise.allSettled(
        companies.slice(0, GEMINI_FALLBACK_COMPANY_COUNT).map(company =>
            fallbackLimit(async () => {
                if (!(await circuitBreakerAllow("serper"))) return;

                const serperResults = await retryWithBackoff(() => serperSearch(
                    `"${company.companyName}" ${company.decisionMakerTitle} site:linkedin.com OR "${company.companyName}" contact email`,
                    "search",
                ), "serper");

                const extracted = await extractLeadsFromSerperResults({
                    results: serperResults,
                    icpDescription,
                    signalType: "INTENT_SIGNAL",
                    source: "gemini_fallback",
                    enforceAtsSignal: false,
                });

                if (extracted.length > 0) {
                    leads.push(...extracted);
                } else {
                    logger.info(
                        { companyName: company.companyName },
                        "[discovery/gemini] No contact data found for fallback company — discarding phantom lead",
                    );
                }
            })
        ),
    );

    const rejected = results.filter(r => r.status === "rejected").length;
    if (rejected > 0) {
        logger.warn({ rejected, total: companies.length }, "[discovery/gemini] Some fallback Serper searches threw");
    }

    logger.info({ leadsExtracted: leads.length, failedSearches: rejected }, "[discovery/gemini] Fallback complete");
    return leads;
}