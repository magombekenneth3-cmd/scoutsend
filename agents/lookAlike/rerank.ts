import pLimit from "p-limit";
import { embedText } from "@/app/api/src/modules/gemini/gemini.client";
import { CompanySignals, ICPProfile } from "./extract-signals";
import { ApolloOrg } from "./apolloCompanies";
import { logger } from "@/app/api/src/lib/logger";

const EMBED_CONCURRENCY = (() => {
    const parsed = Number(process.env.LOOKALIKE_EMBED_BATCH_SIZE);
    return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 5;
})();

const NEUTRAL_SCORE = 0.5;

function parseWeight(envVar: string, fallback: number): number {
    const parsed = Number(process.env[envVar]);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const RAW_SCORE_WEIGHTS = {
    embedding: parseWeight("LOOKALIKE_WEIGHT_EMBEDDING", 0.45),
    industry: parseWeight("LOOKALIKE_WEIGHT_INDUSTRY", 0.15),
    keyword: parseWeight("LOOKALIKE_WEIGHT_KEYWORD", 0.15),
    employee: parseWeight("LOOKALIKE_WEIGHT_EMPLOYEE", 0.1),
    technology: parseWeight("LOOKALIKE_WEIGHT_TECHNOLOGY", 0.1),
    completeness: parseWeight("LOOKALIKE_WEIGHT_COMPLETENESS", 0.05),
};

const SCORE_WEIGHTS = (() => {
    const sum = Object.values(RAW_SCORE_WEIGHTS).reduce((a, b) => a + b, 0);

    if (sum <= 0) {
        logger.warn(
            { RAW_SCORE_WEIGHTS },
            "[lookalike.rerank] Configured score weights sum to 0 — falling back to defaults"
        );
        return { embedding: 0.45, industry: 0.15, keyword: 0.15, employee: 0.1, technology: 0.1, completeness: 0.05 };
    }

    if (Math.abs(sum - 1) > 0.001) {
        logger.warn(
            { RAW_SCORE_WEIGHTS, sum },
            "[lookalike.rerank] Configured score weights do not sum to 1 — normalizing"
        );
    }

    return {
        embedding: RAW_SCORE_WEIGHTS.embedding / sum,
        industry: RAW_SCORE_WEIGHTS.industry / sum,
        keyword: RAW_SCORE_WEIGHTS.keyword / sum,
        employee: RAW_SCORE_WEIGHTS.employee / sum,
        technology: RAW_SCORE_WEIGHTS.technology / sum,
        completeness: RAW_SCORE_WEIGHTS.completeness / sum,
    };
})();

export interface RankedOrg extends ApolloOrg {
    similarityScore: number;
    embeddingScore: number;
    industryScore: number;
    keywordScore: number;
    employeeScore: number;
    technologyScore: number;
    completenessScore: number;
}

interface DeterministicIcp {
    industries: Set<string>;
    keywords: string[];
    techStack: string[];
    employeeRanges: string[];
}

function cosine(a: number[], b: number[]): number {
    let dot = 0;
    let magA = 0;
    let magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    return magA && magB ? dot / (Math.sqrt(magA) * Math.sqrt(magB)) : 0;
}

function toUnitScore(cosineValue: number): number {
    const clamped = Math.max(-1, Math.min(1, cosineValue));
    return Math.max(0, Math.min(1, clamped));
}

function buildIcpText(signals: CompanySignals[]): string {
    return signals
        .map((s) =>
            [s.valueProposition, s.targetCustomer, ...s.keywords, ...s.verticals].join(" ")
        )
        .join(" | ");
}

function buildDeterministicIcp(
    clientSignals: CompanySignals[],
    icpProfile?: ICPProfile
): DeterministicIcp {
    if (icpProfile) {
        return {
            industries: new Set(icpProfile.apolloIndustries.map((i) => i.toLowerCase())),
            keywords: icpProfile.keywords,
            techStack: clientSignals.flatMap((s) => s.techStack),
            employeeRanges: icpProfile.employeeRanges,
        };
    }

    const industries = new Set<string>();
    const keywords: string[] = [];
    const techStack: string[] = [];
    const employeeRanges: string[] = [];

    for (const signal of clientSignals) {
        signal.apolloIndustries.forEach((i) => industries.add(i.toLowerCase()));
        keywords.push(...signal.keywords);
        techStack.push(...signal.techStack);
        employeeRanges.push(...signal.employeeRanges);
    }

    return { industries, keywords, techStack, employeeRanges };
}

function orgSearchableText(org: ApolloOrg): string {
    return [org.name, org.short_description, org.industry, ...(org.keywords ?? [])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
}

function textOverlapScore(haystack: string, terms: string[]): number {
    if (terms.length === 0) return NEUTRAL_SCORE;
    const matched = terms.filter((t) => haystack.includes(t.toLowerCase())).length;
    return matched / terms.length;
}

function industryMatchScore(org: ApolloOrg, industries: Set<string>): number {
    if (industries.size === 0) return NEUTRAL_SCORE;
    if (!org.industry) return NEUTRAL_SCORE;

    const orgIndustry = org.industry.toLowerCase();
    if (industries.has(orgIndustry)) return 1;

    for (const icpIndustry of industries) {
        if (orgIndustry.includes(icpIndustry) || icpIndustry.includes(orgIndustry)) return 1;
    }

    return 0;
}

function employeeMatchScore(org: ApolloOrg, ranges: string[]): number {
    if (ranges.length === 0 || org.estimated_num_employees === undefined) return NEUTRAL_SCORE;

    for (const range of ranges) {
        const [minStr, maxStr] = range.split(",");
        const min = Number(minStr);
        const max = Number(maxStr);
        if (!Number.isFinite(min) || !Number.isFinite(max)) continue;
        if (org.estimated_num_employees >= min && org.estimated_num_employees <= max) return 1;
    }

    return 0;
}

function completenessScore(org: ApolloOrg): number {
    const fields = [org.short_description, org.industry, org.estimated_num_employees, org.keywords?.length];
    const present = fields.filter((f) => f !== undefined && f !== null && f !== "").length;
    return present / fields.length;
}

function blendScore(components: {
    embedding: number;
    industry: number;
    keyword: number;
    employee: number;
    technology: number;
    completeness: number;
}): number {
    const raw =
        SCORE_WEIGHTS.embedding * components.embedding +
        SCORE_WEIGHTS.industry * components.industry +
        SCORE_WEIGHTS.keyword * components.keyword +
        SCORE_WEIGHTS.employee * components.employee +
        SCORE_WEIGHTS.technology * components.technology +
        SCORE_WEIGHTS.completeness * components.completeness;

    return Math.max(0, Math.min(100, Math.round(raw * 100)));
}

function zeroScoredOrg(org: ApolloOrg): RankedOrg {
    return {
        ...org,
        similarityScore: 0,
        embeddingScore: 0,
        industryScore: 0,
        keywordScore: 0,
        employeeScore: 0,
        technologyScore: 0,
        completenessScore: Math.round(completenessScore(org) * 100),
    };
}

export async function rerankBySimilarity(
    clientSignals: CompanySignals[],
    candidates: ApolloOrg[],
    cachedIcpVec?: number[],
    icpProfile?: ICPProfile
): Promise<{ ranked: RankedOrg[]; icpVec: number[] }> {
    if (candidates.length === 0) {
        return { ranked: [], icpVec: cachedIcpVec ?? [] };
    }

    const deterministicIcp = buildDeterministicIcp(clientSignals, icpProfile);

    let icpVec: number[];

    if (cachedIcpVec && cachedIcpVec.length > 0) {
        icpVec = cachedIcpVec;
    } else {
        const icpText = buildIcpText(clientSignals);

        if (!icpText.trim()) {
            logger.warn(
                { signalCount: clientSignals.length },
                "[lookalike.rerank] Empty ICP text — returning unranked"
            );
            return { ranked: candidates.map(zeroScoredOrg), icpVec: [] };
        }

        try {
            icpVec = await embedText(icpText);
        } catch (err) {
            logger.warn({ err }, "[lookalike.rerank] ICP embedding failed — returning unranked");
            return { ranked: candidates.map(zeroScoredOrg), icpVec: [] };
        }
    }

    const startedAt = Date.now();
    let embedFailures = 0;
    const limit = pLimit(EMBED_CONCURRENCY);

    const ranked = await Promise.all(
        candidates.map((org) =>
            limit(async (): Promise<RankedOrg> => {
                const orgText = [org.name, org.short_description, org.industry, ...(org.keywords ?? [])]
                    .filter(Boolean)
                    .join(" ");

                const haystack = orgSearchableText(org);
                const industry = industryMatchScore(org, deterministicIcp.industries);
                const keyword = textOverlapScore(haystack, deterministicIcp.keywords);
                const technology = textOverlapScore(haystack, deterministicIcp.techStack);
                const employee = employeeMatchScore(org, deterministicIcp.employeeRanges);
                const completeness = completenessScore(org);

                let embedding = 0;
                try {
                    const vec = await embedText(orgText);
                    embedding = toUnitScore(cosine(icpVec, vec));
                } catch (err) {
                    embedFailures += 1;
                    logger.warn(
                        { orgId: org.id, name: org.name, err },
                        "[lookalike.rerank] Company embedding failed — scored as 0 for embedding component"
                    );
                }

                return {
                    ...org,
                    embeddingScore: Math.round(embedding * 100),
                    industryScore: Math.round(industry * 100),
                    keywordScore: Math.round(keyword * 100),
                    employeeScore: Math.round(employee * 100),
                    technologyScore: Math.round(technology * 100),
                    completenessScore: Math.round(completeness * 100),
                    similarityScore: blendScore({ embedding, industry, keyword, employee, technology, completeness }),
                };
            })
        )
    );

    logger.info(
        {
            candidateCount: candidates.length,
            rankedCount: ranked.length,
            embedFailures,
            embedConcurrency: EMBED_CONCURRENCY,
            usedCachedIcpVec: Boolean(cachedIcpVec && cachedIcpVec.length > 0),
            usedIcpProfile: Boolean(icpProfile),
            appliedWeights: SCORE_WEIGHTS,
            durationMs: Date.now() - startedAt,
        },
        "[lookalike.rerank] Reranking complete"
    );

    return {
        ranked: ranked.sort((a, b) => b.similarityScore - a.similarityScore),
        icpVec,
    };
}