import { callGemini, extractJSON, MODELS } from "@/app/api/src/modules/gemini/gemini.client";
import { logger } from "@/app/api/src/lib/logger";
import { CompanySignals } from "./extract-signals";
import { APOLLO_INDUSTRIES_ALLOWED } from "./extract-signals";

export interface ICPFilterProfile {
    apolloIndustries: string[];
    employeeSizeBands: Array<{ min: number; max: number }>;
    keywords: string[];
    titleKeywords: string[];
    excludeKeywords: string[];
    queryVariants: string[];
}

const MAX_INDUSTRIES = 15;
const MAX_KEYWORDS = 25;
const MAX_TITLE_KEYWORDS = 15;
const MAX_EXCLUDE_KEYWORDS = 15;
const MAX_QUERY_VARIANTS = 5;
const MAX_EMPLOYEE_BANDS = 10;
const MAX_EMPLOYEES = 500_000;
const SYNTHESIS_MAX_ATTEMPTS = 2;

function uniqueStrings(values: string[], maxLength: number): string[] {
    const seen = new Map<string, string>();

    for (const raw of values) {
        const trimmed = raw.trim();
        if (!trimmed) continue;

        const key = trimmed.toLowerCase();
        if (!seen.has(key)) {
            seen.set(key, trimmed);
        }
    }

    return [...seen.values()].slice(0, maxLength);
}

function toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === "string");
}

function mergeEmployeeBands(
    bands: Array<{ min: number; max: number }>
): Array<{ min: number; max: number }> {
    if (bands.length === 0) return [];

    const sorted = [...bands].sort((a, b) => a.min - b.min);
    const merged: Array<{ min: number; max: number }> = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
        const last = merged[merged.length - 1];
        const current = sorted[i];

        if (current.min <= last.max) {
            last.max = Math.max(last.max, current.max);
        } else {
            merged.push({ ...current });
        }
    }

    return merged;
}

function toEmployeeSizeBands(value: unknown): Array<{ min: number; max: number }> {
    if (!Array.isArray(value)) return [];

    const bands: Array<{ min: number; max: number }> = [];
    for (const item of value) {
        if (!item || typeof item !== "object") continue;
        const candidate = item as Record<string, unknown>;
        const min = Number(candidate.min);
        const max = Number(candidate.max);

        if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
        if (min < 0 || max < 0 || min > max) continue;

        bands.push({
            min: Math.floor(Math.min(min, MAX_EMPLOYEES)),
            max: Math.floor(Math.min(max, MAX_EMPLOYEES)),
        });
    }

    return mergeEmployeeBands(bands).slice(0, MAX_EMPLOYEE_BANDS);
}

function validateICPFilterProfile(
    raw: unknown,
    context: Record<string, unknown>
): { profile: ICPFilterProfile; isEmpty: boolean; warnings: string[] } {
    if (!raw || typeof raw !== "object") {
        logger.warn({ ...context, raw }, "[lookalike.icp-filter] Gemini returned non-object — using empty defaults");
        raw = {};
    }

    const candidate = raw as Partial<Record<keyof ICPFilterProfile, unknown>>;
    const warnings: string[] = [];

    const rawIndustries = uniqueStrings(toStringArray(candidate.apolloIndustries), MAX_INDUSTRIES);
    const apolloIndustries = rawIndustries.filter((i) => APOLLO_INDUSTRIES_ALLOWED.has(i));
    const rejectedIndustries = rawIndustries.filter((i) => !APOLLO_INDUSTRIES_ALLOWED.has(i));
    if (rejectedIndustries.length > 0) {
        warnings.push(`apolloIndustries dropped values outside Apollo allowlist: ${rejectedIndustries.join(", ")}`);
    }
    if (apolloIndustries.length === 0) warnings.push("apolloIndustries empty");

    const employeeSizeBands = toEmployeeSizeBands(candidate.employeeSizeBands);
    if (employeeSizeBands.length === 0) warnings.push("employeeSizeBands empty or malformed");

    const queryVariants = uniqueStrings(toStringArray(candidate.queryVariants), MAX_QUERY_VARIANTS);
    if (queryVariants.length === 0) warnings.push("queryVariants empty — Apollo search will have nothing to run");

    const profile: ICPFilterProfile = {
        apolloIndustries,
        employeeSizeBands,
        keywords: uniqueStrings(toStringArray(candidate.keywords), MAX_KEYWORDS),
        titleKeywords: uniqueStrings(toStringArray(candidate.titleKeywords), MAX_TITLE_KEYWORDS),
        excludeKeywords: uniqueStrings(toStringArray(candidate.excludeKeywords), MAX_EXCLUDE_KEYWORDS),
        queryVariants,
    };

    if (warnings.length > 0) {
        logger.warn({ ...context, warnings }, "[lookalike.icp-filter] ICPFilterProfile validation applied defaults");
    }

    const isEmpty = apolloIndustries.length === 0 && queryVariants.length === 0;

    return { profile, isEmpty, warnings };
}

async function requestICPFilterProfile(signalSet: CompanySignals[]): Promise<unknown> {
    const { text } = await callGemini({
        agentName: "lookalike.icp-filter-profile",
        model: MODELS.RESEARCH,
        systemPrompt: `You are a B2B sales targeting expert. Given signals from a user's best clients, synthesize a unified Ideal Customer Profile for finding lookalike companies. Return ONLY valid JSON with no markdown or preamble.`,
        userPrompt: `Client signals (${signalSet.length} companies):
${JSON.stringify(signalSet, null, 2)}

JSON schema:
{
  "apolloIndustries": string[],
  "employeeSizeBands": [{ "min": number, "max": number }],
  "keywords": string[],
  "titleKeywords": string[],
  "excludeKeywords": string[],
  "queryVariants": string[]
}

queryVariants should each approach from a different angle, max 5:
1. Core product category
2. Target customer type
3. Tech or methodology angle
4. Problem they solve
5. Business model angle`,
        temperature: 0.3,
        metadata: { signalCount: signalSet.length },
    });

    try {
        return extractJSON<unknown>(text);
    } catch (err) {
        logger.warn(
            { signalCount: signalSet.length, rawResponse: text.slice(0, 2_000), err },
            "[lookalike.icp-filter] Failed to parse Gemini response as JSON"
        );
        return null;
    }
}

export async function synthesizeICPProfile(
    signalSet: CompanySignals[]
): Promise<ICPFilterProfile> {
    const startedAt = Date.now();
    const context = { signalCount: signalSet.length, source: "icp-filter-profile" };

    let lastResult: { profile: ICPFilterProfile; isEmpty: boolean; warnings: string[] } | null = null;

    for (let attempt = 1; attempt <= SYNTHESIS_MAX_ATTEMPTS; attempt++) {
        const parsed = await requestICPFilterProfile(signalSet);
        const result = validateICPFilterProfile(parsed, { ...context, attempt });
        lastResult = result;

        if (!result.isEmpty) {
            logger.info(
                {
                    ...context,
                    attempt,
                    industryCount: result.profile.apolloIndustries.length,
                    keywordCount: result.profile.keywords.length,
                    titleCount: result.profile.titleKeywords.length,
                    queryVariantCount: result.profile.queryVariants.length,
                    durationMs: Date.now() - startedAt,
                },
                "[lookalike.icp-filter] ICP profile synthesized"
            );
            return Object.freeze(result.profile);
        }

        if (attempt < SYNTHESIS_MAX_ATTEMPTS) {
            logger.warn(
                { ...context, attempt },
                "[lookalike.icp-filter] Profile empty after validation — retrying"
            );
        }
    }

    logger.warn(
        { ...context, durationMs: Date.now() - startedAt },
        "[lookalike.icp-filter] Profile still empty after retries — returning empty defaults"
    );

    return Object.freeze(lastResult!.profile);
}