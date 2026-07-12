import { Prisma, PrismaClient } from "@prisma/client";
import pLimit from "p-limit";
import { prisma } from "../../lib/prisma";
import { callGemini, extractJSON, MODELS } from "./gemini.client";
import { logger } from "../../lib/logger";
import {
    upsertCompany,
    upsertCompanySignal,
    extractDomain,
} from "../../lib/company/company.upsert";

type PrismaTx = Omit<
    PrismaClient,
    "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

type CallGeminiParams = Parameters<typeof callGemini>[0];

const FETCH_TIMEOUT_MS = 10_000;
const MIN_CONFIDENCE = 0.65;
const MAX_QUERIES = 3;
const SERPER_RESULTS_PER_QUERY = 8;
const SEARCH_MAX_ATTEMPTS = 3;
const SEARCH_RETRY_BASE_DELAY_MS = 500;
const SEARCH_CONCURRENCY = 6;
const EXTRACTION_CONCURRENCY = 3;
const MAX_RESULTS_PER_EXTRACTION = 20;
const MAX_SNIPPET_LENGTH = 300;
const MAX_TITLE_LENGTH = 200;
const GEMINI_MAX_ATTEMPTS = 2;
const GEMINI_RETRY_BASE_DELAY_MS = 500;
const LEAD_TRANSACTION_CONCURRENCY = 5;
const LEAD_TRANSACTION_TIMEOUT_MS = 15_000;

interface SerperResult {
    title: string;
    link: string;
    snippet: string;
}

type CommunitySource = "reddit" | "hacker_news" | "indie_hackers";

interface CommunityLead {
    companyName: string;
    website?: string;
    firstName?: string;
    title?: string;
    email?: string;
    intentSignal: string;
    confidence: number;
    explanation: string;
    postUrl: string;
    source: CommunitySource;
}

interface SearchJobResult {
    results: SerperResult[];
    source: CommunitySource;
    query: string;
    failed: boolean;
}

const COMMUNITY_SOURCES: Array<{ name: CommunitySource; siteFilter: string }> =
    [
        { name: "reddit", siteFilter: "site:reddit.com" },
        { name: "hacker_news", siteFilter: "site:news.ycombinator.com" },
        { name: "indie_hackers", siteFilter: "site:indiehackers.com" },
    ];

const DISALLOWED_DOMAINS = new Set([
    "gmail.com",
    "yahoo.com",
    "hotmail.com",
    "outlook.com",
    "protonmail.com",
    "proton.me",
    "aol.com",
    "icloud.com",
    "mail.com",
    "gmx.com",
    "zoho.com",
    "yandex.com",
    "github.com",
    "reddit.com",
    "google.com",
    "youtube.com",
    "news.ycombinator.com",
    "indiehackers.com",
    "linkedin.com",
    "twitter.com",
    "x.com",
    "facebook.com",
    "instagram.com",
    "medium.com",
    "substack.com",
    "notion.site",
    "wordpress.com",
    "wixsite.com",
    "carrd.co",
    "linktr.ee",
    "discord.gg",
    "discord.com",
    "t.me",
    "producthunt.com",
    "bit.ly",
    "tinyurl.com",
]);

const DISALLOWED_COMPANY_NAMES = new Set([
    "unknown",
    "none",
    "n/a",
    "self",
    "myself",
    "individual",
    "hobbyist",
    "freelancer",
    "personal",
    "student",
]);

const DOMAIN_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const RESERVED_TLD_SUFFIXES = [".local", ".test", ".invalid", ".example", ".temp"];
const COMPANY_SUFFIX_PATTERN = /\b(incorporated|corporation|company|holdings|limited|group|inc|llc|ltd|corp)\b/g;
const EMAIL_PATTERN =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

function isNonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(text: string, maxLength: number): string {
    return text.length > maxLength ? `${text.slice(0, maxLength)}…` : text;
}

function extractCreatedFlag(value: unknown): boolean | null {
    if (typeof value !== "object" || value === null) return null;
    const created = (value as Record<string, unknown>).created;
    if (typeof created === "boolean") return created;
    const wasCreated = (value as Record<string, unknown>).wasCreated;
    if (typeof wasCreated === "boolean") return wasCreated;
    return null;
}

function coerceOptionalString(value: unknown): string | null {
    return isNonEmptyString(value) ? value.trim() : null;
}

function cleanText(value: string): string {
    return value.replace(/\s+/g, " ").trim();
}

function isValidCommunitySource(value: unknown): value is CommunitySource {
    return value === "reddit" || value === "hacker_news" || value === "indie_hackers";
}

function isValidEmail(email: string): boolean {
    return EMAIL_PATTERN.test(email.trim());
}

function normalizeCompanyName(name: string): string {
    return name
        .toLowerCase()
        .replace(/[.,'"]/g, "")
        .replace(COMPANY_SUFFIX_PATTERN, "")
        .replace(/\s+/g, "");
}

function normalizeDomain(domain: string | null | undefined): string | null {
    if (!isNonEmptyString(domain)) return null;
    const lower = domain.toLowerCase().trim().replace(/^www\./, "");
    if (!DOMAIN_PATTERN.test(lower)) return null;
    if (RESERVED_TLD_SUFFIXES.some((suffix) => lower.endsWith(suffix))) return null;
    return lower;
}

function normalizeUrlForComparison(url: string): string {
    try {
        const parsed = new URL(url);
        return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "")}`.toLowerCase();
    } catch {
        return url.trim().toLowerCase();
    }
}

function isKnownResultUrl(url: string, results: SerperResult[]): boolean {
    const normalized = normalizeUrlForComparison(url);
    return results.some((result) => normalizeUrlForComparison(result.link) === normalized);
}

function dedupeAndCapResults(results: SerperResult[], cap: number): SerperResult[] {
    const seen = new Set<string>();
    const deduped: SerperResult[] = [];
    for (const result of results) {
        if (!isNonEmptyString(result.link) || seen.has(result.link)) continue;
        seen.add(result.link);
        deduped.push(result);
        if (deduped.length >= cap) break;
    }
    return deduped;
}

function parseCommunityLead(raw: unknown, fallbackSource: CommunitySource): CommunityLead | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;

    if (!isNonEmptyString(obj.companyName)) return null;
    if (!isNonEmptyString(obj.intentSignal)) return null;
    if (!isNonEmptyString(obj.postUrl)) return null;
    if (!isFiniteNumber(obj.confidence)) return null;

    return {
        companyName: cleanText(obj.companyName),
        website: coerceOptionalString(obj.website) ?? undefined,
        firstName: coerceOptionalString(obj.firstName) ?? undefined,
        title: coerceOptionalString(obj.title) ?? undefined,
        email: coerceOptionalString(obj.email) ?? undefined,
        intentSignal: cleanText(obj.intentSignal),
        confidence: Math.min(1, Math.max(0, obj.confidence)),
        explanation: isNonEmptyString(obj.explanation) ? cleanText(obj.explanation) : "",
        postUrl: obj.postUrl.trim(),
        source: isValidCommunitySource(obj.source) ? obj.source : fallbackSource,
    };
}

function parseQueriesResponse(raw: unknown): string[] | null {
    if (typeof raw !== "object" || raw === null) return null;
    const obj = raw as Record<string, unknown>;
    if (!Array.isArray(obj.queries)) return null;
    return obj.queries.filter(isNonEmptyString).slice(0, MAX_QUERIES);
}

function validateBusinessLead(lead: CommunityLead): boolean {
    const normalizedName = normalizeCompanyName(lead.companyName);
    if (DISALLOWED_COMPANY_NAMES.has(normalizedName) || normalizedName.length < 2) {
        return false;
    }

    if (lead.website) {
        const websiteDomain = normalizeDomain(extractDomain(lead.website));
        if (!websiteDomain || DISALLOWED_DOMAINS.has(websiteDomain)) {
            return false;
        }
    }

    if (lead.email) {
        if (!isValidEmail(lead.email)) return false;
        const emailDomain = normalizeDomain(lead.email.split("@")[1]);
        if (!emailDomain || DISALLOWED_DOMAINS.has(emailDomain)) {
            return false;
        }
    }

    if (lead.intentSignal.length < 5) {
        return false;
    }

    return true;
}

function resolveLeadDomain(lead: CommunityLead): string | null {
    const websiteDomain = normalizeDomain(extractDomain(lead.website));
    if (websiteDomain) return websiteDomain;

    const emailDomain = normalizeDomain(lead.email?.split("@")[1]);
    if (emailDomain && !DISALLOWED_DOMAINS.has(emailDomain)) return emailDomain;

    return null;
}

async function serperSearch(query: string): Promise<{ results: SerperResult[]; failed: boolean }> {
    if (!isNonEmptyString(process.env.SERPER_API_KEY)) {
        logger.error("[community-intent] SERPER_API_KEY is not configured");
        return { results: [], failed: true };
    }

    let lastError: unknown;

    for (let attempt = 1; attempt <= SEARCH_MAX_ATTEMPTS; attempt++) {
        try {
            const res = await fetch("https://google.serper.dev/search", {
                method: "POST",
                headers: {
                    "X-API-KEY": process.env.SERPER_API_KEY,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ q: query, num: SERPER_RESULTS_PER_QUERY }),
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });

            if (res.ok) {
                const data = (await res.json()) as { organic?: SerperResult[] };
                return { results: Array.isArray(data.organic) ? data.organic : [], failed: false };
            }

            if (res.status === 429 || res.status >= 500) {
                lastError = new Error(`Serper request failed with status ${res.status}`);
                if (attempt < SEARCH_MAX_ATTEMPTS) {
                    const retryAfterHeader = res.headers.get("retry-after");
                    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null;
                    const delay =
                        retryAfterMs && Number.isFinite(retryAfterMs)
                            ? retryAfterMs
                            : SEARCH_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
                    logger.warn(
                        { query, status: res.status, attempt },
                        "[community-intent] Serper request failed, retrying",
                    );
                    await sleep(delay);
                    continue;
                }
            }

            logger.warn({ query, status: res.status }, "[community-intent] Serper request failed");
            return { results: [], failed: true };
        } catch (err) {
            lastError = err;
            if (attempt < SEARCH_MAX_ATTEMPTS) {
                logger.warn({ err, query, attempt }, "[community-intent] Serper request threw, retrying");
                await sleep(SEARCH_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
                continue;
            }
        }
    }

    logger.warn({ err: lastError, query }, "[community-intent] Serper request failed after retries");
    return { results: [], failed: true };
}

async function callGeminiForJSON<T>(
    params: CallGeminiParams & { parse: (raw: unknown) => T | null; maxAttempts?: number },
): Promise<T | null> {
    const { parse, maxAttempts = GEMINI_MAX_ATTEMPTS, ...geminiParams } = params;
    const { agentName, temperature: baseTemperature } = geminiParams;

    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const attemptStartedAt = Date.now();
        try {
            const { text } = await callGemini({
                ...geminiParams,
                temperature: attempt === 1 ? baseTemperature : 0,
            });

            const parsed = parse(extractJSON<unknown>(text));
            if (parsed !== null) {
                logger.info(
                    { agentName, attempt, durationMs: Date.now() - attemptStartedAt },
                    "[community-intent] Gemini call succeeded",
                );
                return parsed;
            }

            lastError = new Error("Response failed shape validation");
        } catch (err) {
            lastError = err;
        }

        logger.warn(
            { agentName, attempt, maxAttempts, err: lastError, durationMs: Date.now() - attemptStartedAt },
            "[community-intent] Gemini call failed",
        );

        if (attempt < maxAttempts) {
            await sleep(GEMINI_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1) + Math.random() * 100);
        }
    }

    logger.error({ agentName, err: lastError }, "[community-intent] Gemini call failed after all retries");
    return null;
}

async function buildIntentQueries(params: {
    icpDescription: string;
    targetIndustry?: string;
}): Promise<string[]> {
    const { icpDescription, targetIndustry } = params;

    const result = await callGeminiForJSON<string[]>({
        agentName: "community-intent.query-builder",
        model: MODELS.RESEARCH,
        systemPrompt: `Generate exactly 3 short search queries to find community posts (Reddit, HN, Indie Hackers) from people expressing pain points that match this ICP.

Focus on posts like:
  "looking for a tool for…"
  "switching from X to Y"
  "need help with…"
  "any recommendations for…"

Wrap the key intent phrase in double quotes for exact-match search precision, e.g. "looking for" CRM, "switching from" Salesforce. Vary the phrasing across the 3 queries so they target different intent expressions rather than near-duplicates of each other.

Return ONLY JSON: { "queries": string[] }

Each query should be ≤10 words, including quotes. Do NOT include "site:" in the queries.`,
        userPrompt: `ICP: ${icpDescription}
Industry: ${targetIndustry ?? "general"}`,
        temperature: 0.4,
        parse: parseQueriesResponse,
    });

    if (result === null) {
        throw new Error("Failed to generate intent queries: Gemini returned an unparseable response after retries");
    }

    return result;
}

async function extractIntentLeads(params: {
    results: SerperResult[];
    queries: string[];
    icpDescription: string;
    source: CommunitySource;
}): Promise<CommunityLead[]> {
    const { results, queries, icpDescription, source } = params;

    if (results.length === 0) return [];

    const rawArray = await callGeminiForJSON<unknown[]>({
        agentName: "community-intent.extractor",
        model: MODELS.RESEARCH,
        systemPrompt: `Analyse community posts (Reddit / HN / Indie Hackers) for companies with active buying intent.

Active buying intent indicators:
  "looking for a tool / software / solution for…"
  "switching from X to Y"
  "hiring a team to handle…"
  "any recommendations for…"
  Expressing pain with a current vendor

Return ONLY a JSON array:
[
  {
    "companyName": string (the poster's employer ONLY if explicitly named by the poster themselves, e.g. "I run Acme" or "we built Acme" — never inferred from indirect cues, tone, or guesswork; use "Unknown" if not explicitly stated),
    "website": string | null,
    "firstName": string | null,
    "title": string | null,
    "intentSignal": string (≤80 chars — what they are looking for),
    "confidence": number (0.0–1.0 — strength of buying intent),
    "explanation": string (≤120 chars — why this is a signal),
    "postUrl": string (the post's URL, copied exactly from the listing below — never invented or modified)
  }
]

Rules:
  • Confidence ≥ 0.65 only.
  • Skip purely personal/hobby posts — focus on business context.
  • Exclude "Unknown" company names.
  • Return [] if nothing qualifies.`,
        userPrompt: `ICP: ${icpDescription}
Community source: ${source}
Search queries used: ${queries.join(", ")}

Posts:
${results
                .map(
                    (r, i) =>
                        `${i + 1}. ${truncate(r.title, MAX_TITLE_LENGTH)}\n   ${r.link}\n   ${truncate(r.snippet, MAX_SNIPPET_LENGTH)}`,
                )
                .join("\n\n")}`,
        temperature: 0.2,
        parse: (raw) => (Array.isArray(raw) ? raw : null),
    });

    if (rawArray === null) {
        logger.warn({ source, queries }, "[community-intent] Extractor returned no usable response after retries");
        return [];
    }

    const parsed = rawArray
        .map((item) => parseCommunityLead(item, source))
        .filter((l): l is CommunityLead => l !== null)
        .filter((l) => {
            const verified = isKnownResultUrl(l.postUrl, results);
            if (!verified) {
                logger.info(
                    { source, postUrl: l.postUrl },
                    "[community-intent] Dropped lead with unverifiable postUrl",
                );
            }
            return verified;
        });

    const beforeFilterCount = parsed.length;
    const filtered = parsed.filter(
        (l) => l.confidence >= MIN_CONFIDENCE && l.companyName.toLowerCase().trim() !== "unknown",
    );

    if (beforeFilterCount !== filtered.length) {
        logger.info(
            { source, queries, dropped: beforeFilterCount - filtered.length },
            "[community-intent] Dropped low-confidence or unknown-company leads",
        );
    }

    return filtered;
}

export async function runCommunityIntentAgent(
    campaignId: string,
): Promise<void> {
    const runStartedAt = Date.now();

    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { icpDescription: true, targetIndustry: true },
    });

    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    let queries: string[];
    try {
        queries = await buildIntentQueries({
            icpDescription: campaign.icpDescription,
            targetIndustry: campaign.targetIndustry ?? undefined,
        });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err, campaignId }, "[community-intent] Failed to build intent queries");
        await prisma.discoveryRun.create({
            data: {
                sourceType: "COMMUNITY_INTENT",
                status: "FAILED",
                campaignId,
                query: "",
                startedAt: new Date(runStartedAt),
                completedAt: new Date(),
                errorMessage: message,
            },
        });
        throw err;
    }

    const runRecord = await prisma.discoveryRun.create({
        data: {
            sourceType: "COMMUNITY_INTENT",
            status: "RUNNING",
            campaignId,
            query: queries.join(", "),
            startedAt: new Date(runStartedAt),
        },
    });

    let created = 0;
    let skipped = 0;
    let failedLeadWrites = 0;
    const processedCompanyIds = new Set<string>();
    let newLeadsWithSignals = 0;
    let companySignalsCreated = 0;
    let companySignalCreationUnknown = 0;

    try {
        logger.info(
            { campaignId, queries },
            "[community-intent] Starting community scan",
        );

        if (queries.length === 0) {
            logger.warn({ campaignId }, "[community-intent] No queries generated, ending run");
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

        const searchJobs: Array<{ source: CommunitySource; query: string }> = COMMUNITY_SOURCES.flatMap(
            (src) => queries.map((q) => ({ source: src.name, query: q })),
        );

        const searchLimit = pLimit(SEARCH_CONCURRENCY);
        const searchPhaseStartedAt = Date.now();

        const searchResults: SearchJobResult[] = await Promise.all(
            searchJobs.map(({ source, query }) =>
                searchLimit(async () => {
                    const sourceConfig = COMMUNITY_SOURCES.find((s) => s.name === source)!;
                    const { results, failed } = await serperSearch(`${sourceConfig.siteFilter} ${query}`);
                    return { results, source, query, failed };
                }),
            ),
        );

        const searchPhaseDurationMs = Date.now() - searchPhaseStartedAt;

        const failedSearchCount = searchResults.filter((r) => r.failed).length;
        const allSearchesFailed = failedSearchCount === searchResults.length;

        const resultsBySource = new Map<CommunitySource, { results: SerperResult[]; queries: string[] }>();
        for (const { source, query, results } of searchResults) {
            const bucket = resultsBySource.get(source);
            if (bucket) {
                bucket.results.push(...results);
                bucket.queries.push(query);
            } else {
                resultsBySource.set(source, { results: [...results], queries: [query] });
            }
        }

        const extractionLimit = pLimit(EXTRACTION_CONCURRENCY);
        const extractionPhaseStartedAt = Date.now();

        const allLeadSets = await Promise.all(
            Array.from(resultsBySource.entries()).map(([source, bucket]) =>
                extractionLimit(() =>
                    extractIntentLeads({
                        results: dedupeAndCapResults(bucket.results, MAX_RESULTS_PER_EXTRACTION),
                        queries: bucket.queries,
                        icpDescription: campaign.icpDescription,
                        source,
                    }),
                ),
            ),
        );

        const extractionPhaseDurationMs = Date.now() - extractionPhaseStartedAt;
        const allLeads = allLeadSets.flat();

        if (allLeads.length === 0) {
            const status = allSearchesFailed ? "FAILED" : "COMPLETED";
            logger.info(
                { campaignId, failedSearchCount, totalSearches: searchResults.length },
                "[community-intent] No intent leads found",
            );
            await prisma.discoveryRun.update({
                where: { id: runRecord.id },
                data: {
                    status,
                    companiesFound: 0,
                    leadsFound: 0,
                    signalsFound: 0,
                    completedAt: new Date(),
                    errorMessage: allSearchesFailed
                        ? `All ${searchResults.length} search requests failed`
                        : null,
                },
            });
            if (allSearchesFailed) {
                throw new Error(`All ${searchResults.length} community search requests failed`);
            }
            return;
        }

        const existingLeads = await prisma.lead.findMany({
            where: { campaignId, deletedAt: null },
            select: { companyName: true, domain: true },
        });

        const existingNames = new Set(existingLeads.map((l) => normalizeCompanyName(l.companyName)));
        const existingDomains = new Set(
            existingLeads
                .map((l) => l.domain)
                .filter((d): d is string => isNonEmptyString(d))
                .map((d) => d.toLowerCase()),
        );

        const seenNamesThisRun = new Set<string>();
        const seenDomainsThisRun = new Set<string>();

        const uniqueLeads = allLeads.filter((lead) => {
            if (!validateBusinessLead(lead)) return false;

            const nameKey = normalizeCompanyName(lead.companyName);
            if (existingNames.has(nameKey) || seenNamesThisRun.has(nameKey)) return false;

            const domainKey = resolveLeadDomain(lead);
            if (domainKey && (existingDomains.has(domainKey) || seenDomainsThisRun.has(domainKey))) return false;

            seenNamesThisRun.add(nameKey);
            if (domainKey) seenDomainsThisRun.add(domainKey);
            return true;
        });

        const limit = pLimit(LEAD_TRANSACTION_CONCURRENCY);
        const writePhaseStartedAt = Date.now();

        await Promise.all(
            uniqueLeads.map((lead) =>
                limit(async () => {
                    try {
                        const result = await prisma.$transaction(
                            async (tx: PrismaTx) => {
                                const companyId = await upsertCompany(
                                    { name: lead.companyName, website: lead.website },
                                    tx,
                                );

                                const signalUpsertResult = await upsertCompanySignal(
                                    {
                                        companyId,
                                        signalType: "INTENT_SIGNAL",
                                        value: lead.intentSignal,
                                        confidence: lead.confidence,
                                        source: lead.source,
                                        explanation: lead.explanation,
                                    },
                                    tx,
                                );

                                if (lead.email) {
                                    const globalEmailExists = await tx.lead.findFirst({
                                        where: { email: lead.email },
                                        select: { id: true },
                                    });
                                    if (globalEmailExists) {
                                        return {
                                            wasCreated: false,
                                            companyId,
                                            reason: "duplicate_email",
                                            signalUpsertResult,
                                        };
                                    }
                                }

                                const leadDomain = resolveLeadDomain(lead);

                                if (leadDomain) {
                                    const domainExists = await tx.lead.findFirst({
                                        where: { campaignId, domain: leadDomain },
                                        select: { id: true },
                                    });
                                    if (domainExists) {
                                        return {
                                            wasCreated: false,
                                            companyId,
                                            reason: "duplicate_domain",
                                            signalUpsertResult,
                                        };
                                    }
                                }

                                const existingLead = await tx.lead.findFirst({
                                    where: { campaignId, companyId },
                                    select: { id: true },
                                });
                                if (existingLead) {
                                    return {
                                        wasCreated: false,
                                        companyId,
                                        reason: "duplicate_company",
                                        signalUpsertResult,
                                    };
                                }

                                const newLead = await tx.lead.create({
                                    data: {
                                        companyName: lead.companyName,
                                        website: lead.website,
                                        domain: leadDomain,
                                        firstName: lead.firstName,
                                        title: lead.title,
                                        source: lead.source,
                                        campaignId,
                                        companyId,
                                        enrichmentData: {
                                            discoveredAt: new Date().toISOString(),
                                            discoverySource: lead.source,
                                            communityPostUrl: lead.postUrl,
                                        } as unknown as Prisma.InputJsonValue,
                                    },
                                });

                                await tx.leadSignal.create({
                                    data: {
                                        leadId: newLead.id,
                                        signalType: "INTENT_SIGNAL",
                                        value: lead.intentSignal,
                                        confidence: lead.confidence,
                                        source: lead.source,
                                        explanation: lead.explanation,
                                    },
                                });

                                return { wasCreated: true, companyId, reason: null as string | null, signalUpsertResult };
                            },
                            { timeout: LEAD_TRANSACTION_TIMEOUT_MS },
                        );

                        if (result.companyId) {
                            processedCompanyIds.add(result.companyId);
                        }

                        const signalCreationFlag = extractCreatedFlag(result.signalUpsertResult);
                        if (signalCreationFlag === true) {
                            companySignalsCreated++;
                        } else if (signalCreationFlag === null) {
                            companySignalCreationUnknown++;
                        }

                        if (result.wasCreated) {
                            created++;
                            newLeadsWithSignals++;
                        } else {
                            skipped++;
                            logger.info(
                                { companyName: lead.companyName, reason: result.reason },
                                "[community-intent] Skipped duplicate lead",
                            );
                        }
                    } catch (err) {
                        failedLeadWrites++;
                        logger.warn(
                            { err, companyName: lead.companyName },
                            "[community-intent] Failed to create lead",
                        );
                    }
                }),
            ),
        );

        const writePhaseDurationMs = Date.now() - writePhaseStartedAt;

        const avgConfidence =
            uniqueLeads.length > 0
                ? uniqueLeads.reduce((sum, l) => sum + l.confidence, 0) / uniqueLeads.length
                : 0;

        await prisma.discoveryRun.update({
            where: { id: runRecord.id },
            data: {
                status: "COMPLETED",
                companiesFound: processedCompanyIds.size,
                leadsFound: created,
                signalsFound: companySignalCreationUnknown > 0 ? newLeadsWithSignals : companySignalsCreated,
                completedAt: new Date(),
            },
        });

        if (companySignalCreationUnknown > 0) {
            logger.warn(
                { campaignId, companySignalCreationUnknown },
                "[community-intent] upsertCompanySignal did not report created/wasCreated; signalsFound fell back to newLeadsWithSignals",
            );
        }

        logger.info(
            {
                campaignId,
                created,
                skipped,
                failedLeadWrites,
                candidatesConsidered: allLeads.length,
                uniqueCandidates: uniqueLeads.length,
                newLeadsWithSignals,
                companySignalsCreated,
                companySignalCreationUnknown,
                avgConfidence: Number(avgConfidence.toFixed(3)),
                failedSearchCount,
                totalSearches: searchResults.length,
                searchPhaseDurationMs,
                extractionPhaseDurationMs,
                writePhaseDurationMs,
                totalDurationMs: Date.now() - runStartedAt,
            },
            "[community-intent] Scan complete",
        );
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err, campaignId }, "[community-intent] Scan failed");
        await prisma.discoveryRun.update({
            where: { id: runRecord.id },
            data: {
                status: "FAILED",
                errorMessage: message,
                completedAt: new Date(),
            },
        });
        throw err;
    }
}