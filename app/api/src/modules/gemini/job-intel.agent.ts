import { SignalType, type CompanySignal } from "@prisma/client";
import pLimit from "p-limit";
import { prisma } from "../../lib/prisma";
import { callGemini, extractJSON, MODELS } from "./gemini.client";
import { logger } from "../../lib/logger";
import { upsertCompanySignal } from "../../lib/company/company.upsert";

const JOB_INTEL_SOURCE = "job_intel";
const JOB_INTEL_BATCH_SIZE = 30;
const COMPANY_CONCURRENCY = 4;
const SEARCH_QUERY_CONCURRENCY = 3;
const SERPER_RESULTS_PER_QUERY = 6;
const SERPER_MAX_ATTEMPTS = 3;
const SERPER_RETRY_BASE_DELAY_MS = 400;
const MIN_RELIABLE_QUERY_RATIO = 0.5;
const REFRESH_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_AI_CONFIDENCE = 0.6;
const MIN_SIGNAL_CONFIDENCE = 0.55;
const MAX_SIGNAL_VALUE_LENGTH = 60;
const MAX_EXPLANATION_LENGTH = 120;
const MAX_GEMINI_ATTEMPTS = 2;
const PAGE_FETCH_TIMEOUT_MS = 3000;
const ROBOTS_FETCH_TIMEOUT_MS = 2000;
const PAGE_CONTEXT_MAX_CHARS = 4000;
const MAX_RAW_HTML_CHARS = 2_000_000;
const MIN_PAGE_FETCH_SOURCE_QUALITY = 0.85;
const TRANSACTION_CHUNK_SIZE = 25;
const CORROBORATION_BONUS_PER_SOURCE = 0.02;
const MAX_CORROBORATION_BONUS = 0.06;
const STRUCTURED_DATA_BONUS = 0.06;
const STALE_SIGNAL_DECAY_FACTOR = 0.3;
const STALE_SIGNAL_CONFIDENCE_FLOOR = 0.1;
const STALE_SIGNAL_EXPLANATION = "No longer observed in the latest refresh";
const STRUCTURED_JOBS_PROMPT_LIMIT = 60;

interface SerperResult {
    title: string;
    link: string;
    snippet: string;
    date?: string;
    position?: number;
}

type IntentCategory =
    | "immediate_purchase"
    | "evaluation"
    | "future_budget"
    | "operational_expansion"
    | "tech_migration"
    | "revenue_expansion";

type SignalDirection = "increasing" | "steady" | "decreasing" | "frozen";

interface JobSignal {
    department: string;
    roleCount: number;
    titles: string[];
    signalType: SignalType;
    intentCategory: IntentCategory;
    direction: SignalDirection;
    signalValue: string;
    confidence: number;
    explanation: string;
}

interface PersistableSignal {
    signalType: SignalType;
    value: string;
    confidence: number;
    explanation: string;
}

interface LeadRef {
    id: string;
    companyName: string;
    companyId: string | null;
}

interface CompanyGroup {
    companyId: string | null;
    companyName: string;
    leads: LeadRef[];
}

interface StructuredJobPosting {
    title: string;
    department?: string;
    location?: string;
}

interface SupplementalContext {
    kind: "structured" | "page" | "none";
    text: string | null;
    jobCount: number | null;
}

interface JobIntelMetrics {
    companyGroupsProcessed: number;
    companyFailures: number;
    cacheHits: number;
    inFlightDedupeHits: number;
    companiesRefreshed: number;
    leadsEnriched: number;
    signalsPersisted: number;
    staleSignalsDecayed: number;
    serperCalls: number;
    serperLatencyMs: number;
    serperFailures: number;
    emptySearchCompanies: number;
    unreliableSearchCompanies: number;
    geminiCalls: number;
    geminiLatencyMs: number;
    geminiParseFailures: number;
    structuredExtractionHits: number;
    totalProcessingMs: number;
}

class SerperRequestError extends Error {
    constructor(public status: number, message: string) {
        super(message);
    }
}

function createMetrics(): JobIntelMetrics {
    return {
        companyGroupsProcessed: 0,
        companyFailures: 0,
        cacheHits: 0,
        inFlightDedupeHits: 0,
        companiesRefreshed: 0,
        leadsEnriched: 0,
        signalsPersisted: 0,
        staleSignalsDecayed: 0,
        serperCalls: 0,
        serperLatencyMs: 0,
        serperFailures: 0,
        emptySearchCompanies: 0,
        unreliableSearchCompanies: 0,
        geminiCalls: 0,
        geminiLatencyMs: 0,
        geminiParseFailures: 0,
        structuredExtractionHits: 0,
        totalProcessingMs: 0,
    };
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry<T>(
    fn: () => Promise<T>,
    opts: { attempts: number; baseDelayMs: number; shouldRetry?: (err: unknown) => boolean },
): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= opts.attempts; attempt++) {
        try {
            return await fn();
        } catch (err) {
            lastError = err;
            const canRetry = opts.shouldRetry ? opts.shouldRetry(err) : true;
            if (!canRetry || attempt === opts.attempts) break;
            const delay = opts.baseDelayMs * 2 ** (attempt - 1) + Math.floor(Math.random() * 100);
            await sleep(delay);
        }
    }
    throw lastError;
}

function average(values: number[]): number {
    if (values.length === 0) return 0.5;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

function chunk<T>(items: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
        result.push(items.slice(i, i + size));
    }
    return result;
}

function normalizeCompanyName(name: string): string {
    return name.trim().toLowerCase();
}

function normalizeForMatch(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function safeHostname(url: string): string | null {
    try {
        return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
        return null;
    }
}

const ATS_DOMAINS = [
    "greenhouse.io",
    "lever.co",
    "ashbyhq.com",
    "myworkdayjobs.com",
    "smartrecruiters.com",
    "breezy.hr",
    "bamboohr.com",
    "workable.com",
];
const SECONDARY_JOB_BOARDS = ["linkedin.com", "wellfound.com"];
const TERTIARY_JOB_BOARDS = ["indeed.com", "glassdoor.com", "ziprecruiter.com"];

function looksLikeOfficialDomain(hostname: string, companyName: string): boolean {
    const normalizedHost = normalizeForMatch(hostname.split(".")[0] ?? "");
    const normalizedCompany = normalizeForMatch(companyName);
    if (normalizedCompany.length < 3 || normalizedHost.length < 3) return false;
    return normalizedHost.includes(normalizedCompany) || normalizedCompany.includes(normalizedHost);
}

function scoreSourceQuality(url: string, companyName: string): number {
    const hostname = safeHostname(url);
    if (!hostname) return 0.3;
    if (ATS_DOMAINS.some((domain) => hostname.endsWith(domain))) return 1;
    if (looksLikeOfficialDomain(hostname, companyName)) return 0.9;
    if (SECONDARY_JOB_BOARDS.some((domain) => hostname.endsWith(domain))) return 0.55;
    if (TERTIARY_JOB_BOARDS.some((domain) => hostname.endsWith(domain))) return 0.5;
    return 0.35;
}

function parseRelativeAgeDays(raw: string | undefined): number | null {
    if (!raw) return null;
    const text = raw.trim().toLowerCase();
    const match = text.match(/(\d+)\s*(hour|day|week|month|year)s?\s+ago/);
    if (!match) return null;
    const amount = Number(match[1]);
    const unitDays: Record<string, number> = { hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 };
    return amount * (unitDays[match[2]] ?? 1);
}

function scoreFreshness(raw: string | undefined): number {
    const ageDays = parseRelativeAgeDays(raw);
    if (ageDays === null) return 0.5;
    if (ageDays <= 7) return 1;
    if (ageDays <= 30) return 0.85;
    if (ageDays <= 90) return 0.6;
    if (ageDays <= 180) return 0.4;
    if (ageDays <= 365) return 0.25;
    return 0.1;
}

function buildSearchQueries(companyName: string): string[] {
    const year = new Date().getFullYear();
    return [
        `"${companyName}" hiring jobs ${year}`,
        `"${companyName}" careers open positions`,
        `"${companyName}" site:greenhouse.io`,
        `"${companyName}" site:jobs.lever.co`,
        `"${companyName}" site:jobs.ashbyhq.com`,
        `"${companyName}" site:myworkdayjobs.com`,
    ];
}

const RETRYABLE_SERPER_STATUSES = new Set([429, 500, 502, 503, 504]);

async function fetchSerperQuery(query: string): Promise<SerperResult[]> {
    const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
            "X-API-KEY": process.env.SERPER_API_KEY!,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: query, num: SERPER_RESULTS_PER_QUERY }),
    });

    if (!res.ok) {
        throw new SerperRequestError(res.status, `Serper request failed with status ${res.status}`);
    }

    const data = (await res.json()) as { organic?: SerperResult[] };
    return data.organic ?? [];
}

async function fetchSerperQueryWithRetry(query: string, metrics: JobIntelMetrics): Promise<{ succeeded: boolean; postings: SerperResult[] }> {
    const startedAt = Date.now();
    try {
        const postings = await withRetry(() => fetchSerperQuery(query), {
            attempts: SERPER_MAX_ATTEMPTS,
            baseDelayMs: SERPER_RETRY_BASE_DELAY_MS,
            shouldRetry: (err) => (err instanceof SerperRequestError ? RETRYABLE_SERPER_STATUSES.has(err.status) : true),
        });
        metrics.serperCalls++;
        metrics.serperLatencyMs += Date.now() - startedAt;
        return { succeeded: true, postings };
    } catch (err) {
        metrics.serperCalls++;
        metrics.serperLatencyMs += Date.now() - startedAt;
        metrics.serperFailures++;
        logger.warn({ err, query }, "[job-intel] Serper query failed after retries");
        return { succeeded: false, postings: [] };
    }
}

interface JobPostingsResult {
    postings: SerperResult[];
    queriesAttempted: number;
    queriesSucceeded: number;
}

async function fetchJobPostings(companyName: string, metrics: JobIntelMetrics): Promise<JobPostingsResult> {
    const queries = buildSearchQueries(companyName);
    const limit = pLimit(SEARCH_QUERY_CONCURRENCY);

    const results = await Promise.allSettled(
        queries.map((query) => limit(() => fetchSerperQueryWithRetry(query, metrics))),
    );

    const merged = new Map<string, SerperResult>();
    let queriesSucceeded = 0;
    for (const result of results) {
        if (result.status !== "fulfilled") continue;
        if (result.value.succeeded) queriesSucceeded++;
        for (const posting of result.value.postings) {
            if (posting.link && !merged.has(posting.link)) merged.set(posting.link, posting);
        }
    }

    if (merged.size === 0) metrics.emptySearchCompanies++;

    return { postings: Array.from(merged.values()), queriesAttempted: queries.length, queriesSucceeded };
}

const BLOCKED_HOSTNAME_PATTERNS = [
    /^localhost$/,
    /^127\./,
    /^0\.0\.0\.0$/,
    /^169\.254\./,
    /^10\./,
    /^172\.(1[6-9]|2\d|3[0-1])\./,
    /^192\.168\./,
];

function isSafeExternalUrl(url: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return false;
    }
    if (parsed.protocol !== "https:") return false;
    return !BLOCKED_HOSTNAME_PATTERNS.some((pattern) => pattern.test(parsed.hostname));
}

async function isDisallowedByRobots(url: string): Promise<boolean> {
    try {
        const origin = new URL(url).origin;
        const res = await fetch(`${origin}/robots.txt`, { signal: AbortSignal.timeout(ROBOTS_FETCH_TIMEOUT_MS) });
        if (!res.ok) return false;
        const body = await res.text();
        const lines = body.split("\n").map((l) => l.trim().toLowerCase());
        let appliesToAllAgents = false;
        for (const line of lines) {
            if (line.startsWith("user-agent:")) {
                appliesToAllAgents = line.includes("*");
                continue;
            }
            if (appliesToAllAgents && line === "disallow: /") return true;
        }
        return false;
    } catch {
        return false;
    }
}

const HTML_ENTITY_MAP: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
    "&nbsp;": " ",
};

function decodeHtmlEntities(text: string): string {
    return text.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (entity) => HTML_ENTITY_MAP[entity] ?? entity);
}

function stripHtml(html: string): string {
    const withoutNoise = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
        .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
        .replace(/<[^>]+>/g, " ");
    return decodeHtmlEntities(withoutNoise).replace(/\s+/g, " ").trim();
}

function extractJsonLdJobPostings(html: string): StructuredJobPosting[] {
    const blocks = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];
    const jobs: StructuredJobPosting[] = [];

    for (const block of blocks) {
        const jsonMatch = block.match(/>([\s\S]*?)<\/script>/i);
        if (!jsonMatch) continue;
        try {
            const parsed: unknown = JSON.parse(jsonMatch[1]);
            const items = Array.isArray(parsed) ? parsed : [parsed];
            for (const item of items) {
                const graph = item && typeof item === "object" ? (item as Record<string, unknown>)["@graph"] : undefined;
                const entries = Array.isArray(graph) ? graph : [item];
                for (const entry of entries) {
                    if (!entry || typeof entry !== "object") continue;
                    const record = entry as Record<string, unknown>;
                    if (record["@type"] !== "JobPosting" || typeof record.title !== "string") continue;
                    const jobLocation = record.jobLocation as Record<string, unknown> | undefined;
                    const address = jobLocation?.address as Record<string, unknown> | undefined;
                    jobs.push({
                        title: record.title,
                        department: typeof record.industry === "string" ? record.industry : undefined,
                        location: typeof address?.addressLocality === "string" ? address.addressLocality : undefined,
                    });
                }
            }
        } catch {
            continue;
        }
    }

    return jobs;
}

interface GreenhouseJobsResponse {
    jobs?: { title: string; departments?: { name: string }[]; location?: { name: string } }[];
}

interface AshbyJobsResponse {
    jobs?: { title: string; department?: string; location?: string }[];
}

async function fetchGreenhouseJobs(url: string): Promise<StructuredJobPosting[] | null> {
    const match = url.match(/(?:boards|job-boards)\.greenhouse\.io\/([^/?#]+)/i);
    if (!match) return null;
    try {
        const res = await fetch(`https://boards-api.greenhouse.io/v1/boards/${match[1]}/jobs`, {
            signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as GreenhouseJobsResponse;
        if (!Array.isArray(data.jobs)) return null;
        return data.jobs.map((j) => ({ title: j.title, department: j.departments?.[0]?.name, location: j.location?.name }));
    } catch {
        return null;
    }
}

async function fetchLeverJobs(url: string): Promise<StructuredJobPosting[] | null> {
    const match = url.match(/jobs\.lever\.co\/([^/?#]+)/i);
    if (!match) return null;
    try {
        const res = await fetch(`https://api.lever.co/v0/postings/${match[1]}?mode=json`, {
            signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { text: string; categories?: { team?: string; location?: string } }[];
        if (!Array.isArray(data)) return null;
        return data.map((j) => ({ title: j.text, department: j.categories?.team, location: j.categories?.location }));
    } catch {
        return null;
    }
}

async function fetchAshbyJobs(url: string): Promise<StructuredJobPosting[] | null> {
    const match = url.match(/jobs\.ashbyhq\.com\/([^/?#]+)/i);
    if (!match) return null;
    try {
        const res = await fetch(`https://api.ashbyhq.com/posting-api/job-board/${match[1]}`, {
            signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const data = (await res.json()) as AshbyJobsResponse;
        if (!Array.isArray(data.jobs)) return null;
        return data.jobs.map((j) => ({ title: j.title, department: j.department, location: j.location }));
    } catch {
        return null;
    }
}

async function tryStructuredJobs(postings: SerperResult[]): Promise<StructuredJobPosting[] | null> {
    const greenhouse = postings.find((p) => /(?:boards|job-boards)\.greenhouse\.io/i.test(p.link));
    if (greenhouse) {
        const jobs = await fetchGreenhouseJobs(greenhouse.link);
        if (jobs && jobs.length > 0) return jobs;
    }

    const lever = postings.find((p) => /jobs\.lever\.co/i.test(p.link));
    if (lever) {
        const jobs = await fetchLeverJobs(lever.link);
        if (jobs && jobs.length > 0) return jobs;
    }

    const ashby = postings.find((p) => /jobs\.ashbyhq\.com/i.test(p.link));
    if (ashby) {
        const jobs = await fetchAshbyJobs(ashby.link);
        if (jobs && jobs.length > 0) return jobs;
    }

    return null;
}

function formatStructuredJobs(jobs: StructuredJobPosting[]): string {
    return jobs
        .slice(0, STRUCTURED_JOBS_PROMPT_LIMIT)
        .map((j, i) => `${i + 1}. ${j.title}${j.department ? ` — ${j.department}` : ""}${j.location ? ` (${j.location})` : ""}`)
        .join("\n");
}

async function fetchBestPage(postings: SerperResult[], companyName: string): Promise<{ html: string } | null> {
    const ranked = postings
        .filter((p) => isSafeExternalUrl(p.link))
        .map((p) => ({ posting: p, quality: scoreSourceQuality(p.link, companyName) }))
        .sort((a, b) => b.quality - a.quality);

    const best = ranked[0];
    if (!best || best.quality < MIN_PAGE_FETCH_SOURCE_QUALITY) return null;
    if (await isDisallowedByRobots(best.posting.link)) return null;

    try {
        const res = await fetch(best.posting.link, {
            signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
            headers: { "User-Agent": "Mozilla/5.0 (compatible; JobIntelBot/1.0)" },
        });
        if (!res.ok) return null;
        const contentType = res.headers.get("content-type") ?? "";
        if (!contentType.includes("text/html")) return null;
        const html = (await res.text()).slice(0, MAX_RAW_HTML_CHARS);
        return html.length > 0 ? { html } : null;
    } catch {
        return null;
    }
}

async function gatherSupplementalContext(postings: SerperResult[], companyName: string): Promise<SupplementalContext> {
    const atsJobs = await tryStructuredJobs(postings);
    if (atsJobs && atsJobs.length > 0) {
        return { kind: "structured", text: formatStructuredJobs(atsJobs), jobCount: atsJobs.length };
    }

    const page = await fetchBestPage(postings, companyName);
    if (!page) return { kind: "none", text: null, jobCount: null };

    const jsonLdJobs = extractJsonLdJobPostings(page.html);
    if (jsonLdJobs.length > 0) {
        return { kind: "structured", text: formatStructuredJobs(jsonLdJobs), jobCount: jsonLdJobs.length };
    }

    const text = stripHtml(page.html).slice(0, PAGE_CONTEXT_MAX_CHARS);
    return text.length > 0 ? { kind: "page", text, jobCount: null } : { kind: "none", text: null, jobCount: null };
}

function buildSystemPrompt(): string {
    return `You are a B2B intelligence analyst specialising in job-posting signals.

You are given a customer's Ideal Customer Profile (ICP) and job data for a target company. Use the ICP as the primary filter for which roles matter. When the supplied job data is explicitly marked as fetched directly from the company's job board, treat it as ground truth and prefer it over search snippets.

Reference categories and what hiring into them typically implies:
- SDR / BDR -> sales engagement and outreach automation tools
- RevOps -> CRM, attribution, forecasting, revenue intelligence tooling
- Sales leadership (VP Sales, CRO) -> a large, multi-tool investment cycle
- Customer Success -> CS platforms and support/helpdesk tooling
- Marketing Operations -> marketing automation and campaign/lead management tooling
- Data / Analytics -> BI, data warehousing, data-quality tooling
- Engineering / DevOps -> developer tooling, CI/CD, observability

When a role clearly matches one of these categories, use that category name as "department" so equivalent roles are grouped consistently across companies. Only use a different label when a role genuinely does not fit any of them.

Group roles by department instead of returning one entry per title. Only use "direction": "decreasing" or "frozen" when the evidence actually supports it; use "steady" if uncertain rather than guessing.

Return ONLY a JSON array, no markdown fences, no commentary, matching exactly this shape:
[
  {
    "department": string,
    "roleCount": number,
    "titles": string[],
    "signalType": "HIRING_SIGNAL" | "INTENT_SIGNAL",
    "intentCategory": "immediate_purchase" | "evaluation" | "future_budget" | "operational_expansion" | "tech_migration" | "revenue_expansion",
    "direction": "increasing" | "steady" | "decreasing" | "frozen",
    "signalValue": string,
    "confidence": number,
    "explanation": string
  }
]

signalValue max 60 characters, e.g. "Hiring 6 SDRs". explanation max 120 characters, e.g. why this indicates buying intent. Only include departments with genuine buying-signal relevance. Return [] if none found.`;
}

function buildUserPrompt(params: {
    companyName: string;
    postings: SerperResult[];
    icpDescription: string;
    context: SupplementalContext;
}): string {
    const { companyName, postings, icpDescription, context } = params;
    const postingsBlock = postings.map((p, i) => `${i + 1}. ${p.title}\n   ${p.snippet}\n   ${p.link}`).join("\n\n");
    const contextBlock =
        context.kind === "structured"
            ? `\n\nActual open roles fetched directly from the company's job board (${context.jobCount ?? "unknown"} total, ground truth, prefer this over the search results above):\n${context.text}`
            : context.kind === "page"
                ? `\n\nCareers page extract:\n${context.text}`
                : "";
    return `Company: ${companyName}\nICP: ${icpDescription}\n\nJob search results:\n${postingsBlock}${contextBlock}`;
}

function attemptJsonRepair(text: string): string {
    const withoutFences = text.replace(/```json/gi, "").replace(/```/g, "");
    const start = withoutFences.indexOf("[");
    const end = withoutFences.lastIndexOf("]");
    const sliced = start !== -1 && end !== -1 && end > start ? withoutFences.slice(start, end + 1) : withoutFences;
    return sliced.replace(/,\s*([\]}])/g, "$1");
}

const SIGNAL_TYPES = new Set<string>(Object.values(SignalType));
const INTENT_CATEGORIES = new Set<string>([
    "immediate_purchase",
    "evaluation",
    "future_budget",
    "operational_expansion",
    "tech_migration",
    "revenue_expansion",
]);
const DIRECTIONS = new Set<string>(["increasing", "steady", "decreasing", "frozen"]);

function validateJobSignals(raw: unknown): JobSignal[] {
    if (!Array.isArray(raw)) {
        throw new Error("Gemini response was not a JSON array");
    }

    const results: JobSignal[] = [];
    for (const item of raw) {
        if (!item || typeof item !== "object") continue;
        const candidate = item as Record<string, unknown>;

        const signalType = candidate.signalType;
        const confidence = candidate.confidence;
        const signalValue = candidate.signalValue;
        const explanation = candidate.explanation;

        if (typeof signalType !== "string" || !SIGNAL_TYPES.has(signalType)) continue;
        if (typeof confidence !== "number" || Number.isNaN(confidence)) continue;
        if (typeof signalValue !== "string" || signalValue.trim().length === 0) continue;
        if (typeof explanation !== "string") continue;

        const intentCategory = (
            typeof candidate.intentCategory === "string" && INTENT_CATEGORIES.has(candidate.intentCategory)
                ? candidate.intentCategory
                : "operational_expansion"
        ) as IntentCategory;
        const direction = (
            typeof candidate.direction === "string" && DIRECTIONS.has(candidate.direction) ? candidate.direction : "steady"
        ) as SignalDirection;
        const roleCount =
            typeof candidate.roleCount === "number" && candidate.roleCount > 0 ? Math.round(candidate.roleCount) : 1;
        const department =
            typeof candidate.department === "string" && candidate.department.trim().length > 0
                ? candidate.department.trim()
                : "General";
        const titles = Array.isArray(candidate.titles)
            ? candidate.titles.filter((t): t is string => typeof t === "string").slice(0, 6)
            : [];

        results.push({
            department,
            roleCount,
            titles,
            signalType: signalType as SignalType,
            intentCategory,
            direction,
            signalValue: signalValue.trim().slice(0, MAX_SIGNAL_VALUE_LENGTH),
            confidence: clamp(confidence, 0, 1),
            explanation: explanation.trim().slice(0, MAX_EXPLANATION_LENGTH),
        });
    }
    return results;
}

function mergeSignalsByDepartment(signals: JobSignal[]): JobSignal[] {
    const byDepartment = new Map<string, JobSignal>();
    for (const signal of signals) {
        const key = normalizeForMatch(signal.department);
        const existing = byDepartment.get(key);
        if (!existing) {
            byDepartment.set(key, signal);
            continue;
        }
        const base = existing.confidence >= signal.confidence ? existing : signal;
        byDepartment.set(key, {
            ...base,
            roleCount: existing.roleCount + signal.roleCount,
            titles: Array.from(new Set([...existing.titles, ...signal.titles])).slice(0, 6),
        });
    }
    return Array.from(byDepartment.values());
}

async function extractJobSignalsWithRetry(params: {
    companyName: string;
    postings: SerperResult[];
    icpDescription: string;
    context: SupplementalContext;
    metrics: JobIntelMetrics;
}): Promise<JobSignal[]> {
    const { companyName, postings, icpDescription, context, metrics } = params;
    const systemPrompt = buildSystemPrompt();
    const basePrompt = buildUserPrompt({ companyName, postings, icpDescription, context });

    let lastError: unknown;

    for (let attempt = 1; attempt <= MAX_GEMINI_ATTEMPTS; attempt++) {
        const startedAt = Date.now();
        try {
            const { text } = await callGemini({
                agentName: "job-intel.signal-extractor",
                model: MODELS.RESEARCH,
                systemPrompt,
                userPrompt:
                    attempt === 1
                        ? basePrompt
                        : `${basePrompt}\n\nYour previous response was not valid JSON matching the required schema. Return ONLY the JSON array, with no markdown fences or commentary.`,
                temperature: attempt === 1 ? 0.2 : 0,
            });
            metrics.geminiCalls++;
            metrics.geminiLatencyMs += Date.now() - startedAt;

            try {
                const validated = mergeSignalsByDepartment(validateJobSignals(extractJSON<unknown>(text)));
                return validated.filter((s) => s.confidence >= MIN_AI_CONFIDENCE);
            } catch {
                const repaired = attemptJsonRepair(text);
                const validated = mergeSignalsByDepartment(validateJobSignals(extractJSON<unknown>(repaired)));
                return validated.filter((s) => s.confidence >= MIN_AI_CONFIDENCE);
            }
        } catch (err) {
            metrics.geminiCalls++;
            metrics.geminiLatencyMs += Date.now() - startedAt;
            lastError = err;
            metrics.geminiParseFailures++;
        }
    }

    logger.warn({ err: lastError, companyName }, "[job-intel] Gemini extraction failed after retries");
    return [];
}

function computeCompositeConfidence(params: {
    signal: JobSignal;
    postings: SerperResult[];
    companyName: string;
    hasStructuredData: boolean;
}): number {
    const { signal, postings, companyName, hasStructuredData } = params;

    const avgSourceQuality = average(postings.map((p) => scoreSourceQuality(p.link, companyName)));
    const avgFreshness = average(postings.map((p) => scoreFreshness(p.date)));
    const volumeBonus = Math.min(0.06, Math.max(0, signal.roleCount - 1) * 0.015);

    const distinctHosts = new Set(postings.map((p) => safeHostname(p.link)).filter((h): h is string => Boolean(h)));
    const corroborationBonus = Math.min(MAX_CORROBORATION_BONUS, Math.max(0, distinctHosts.size - 1) * CORROBORATION_BONUS_PER_SOURCE);

    const structuredBonus = hasStructuredData ? STRUCTURED_DATA_BONUS : 0;

    const directionAdjustment =
        signal.direction === "increasing"
            ? 0.05
            : signal.direction === "decreasing"
                ? -0.05
                : signal.direction === "frozen"
                    ? -0.15
                    : 0;

    const composite =
        signal.confidence * 0.5 +
        avgSourceQuality * 0.16 +
        avgFreshness * 0.1 +
        volumeBonus +
        corroborationBonus +
        structuredBonus +
        directionAdjustment;

    return clamp(Number(composite.toFixed(3)), 0, 1);
}

function buildUnconfirmedSlowdownSignal(): JobSignal {
    return {
        department: "General",
        roleCount: 0,
        titles: [],
        signalType: SignalType.INTENT_SIGNAL,
        intentCategory: "operational_expansion",
        direction: "frozen",
        signalValue: "Unknown hiring state on refresh",
        confidence: 0.3,
        explanation: "Previously observed roles were not found on refresh; not confirmed as a freeze",
    };
}

function buildStaleSignalUpdates(existingSignals: CompanySignal[], freshValues: Set<string>): PersistableSignal[] {
    return existingSignals
        .filter((s) => !freshValues.has(s.value))
        .map((s) => ({
            signalType: s.signalType,
            value: s.value,
            confidence: Math.max(STALE_SIGNAL_CONFIDENCE_FLOOR, Number((s.confidence * STALE_SIGNAL_DECAY_FACTOR).toFixed(3))),
            explanation: STALE_SIGNAL_EXPLANATION,
        }));
}

function toPersistable(signals: JobSignal[]): PersistableSignal[] {
    return signals.map((s) => ({
        signalType: s.signalType,
        value: s.signalValue,
        confidence: s.confidence,
        explanation: s.explanation,
    }));
}

interface ExtractionOutcome {
    signals: JobSignal[];
    hadNoPostings: boolean;
    searchReliable: boolean;
}

async function fetchAndExtractSignals(params: {
    companyName: string;
    icpDescription: string;
    metrics: JobIntelMetrics;
}): Promise<ExtractionOutcome> {
    const { companyName, icpDescription, metrics } = params;

    const { postings, queriesAttempted, queriesSucceeded } = await fetchJobPostings(companyName, metrics);
    const searchReliable = queriesSucceeded >= Math.ceil(queriesAttempted * MIN_RELIABLE_QUERY_RATIO);
    if (!searchReliable) metrics.unreliableSearchCompanies++;

    if (postings.length === 0) {
        return { signals: [], hadNoPostings: true, searchReliable };
    }

    const context = await gatherSupplementalContext(postings, companyName);
    if (context.kind === "structured") metrics.structuredExtractionHits++;

    const extracted = await extractJobSignalsWithRetry({ companyName, postings, icpDescription, context, metrics });

    const scored = extracted.map((signal) => ({
        ...signal,
        confidence: computeCompositeConfidence({ signal, postings, companyName, hasStructuredData: context.kind === "structured" }),
    }));

    return { signals: scored.filter((s) => s.confidence >= MIN_SIGNAL_CONFIDENCE), hadNoPostings: false, searchReliable };
}

const inFlightExtractions = new Map<string, Promise<ExtractionOutcome>>();

function fetchAndExtractSignalsDeduped(params: {
    companyName: string;
    icpDescription: string;
    metrics: JobIntelMetrics;
}): Promise<ExtractionOutcome> {
    const key = normalizeCompanyName(params.companyName);
    const existing = inFlightExtractions.get(key);
    if (existing) {
        params.metrics.inFlightDedupeHits++;
        return existing;
    }

    const promise = fetchAndExtractSignals(params).finally(() => {
        inFlightExtractions.delete(key);
    });
    inFlightExtractions.set(key, promise);
    return promise;
}

function groupLeadsForEnrichment(leads: LeadRef[]): CompanyGroup[] {
    const groups = new Map<string, CompanyGroup>();
    for (const lead of leads) {
        const key = lead.companyId ?? `name:${normalizeCompanyName(lead.companyName)}`;
        const existing = groups.get(key);
        if (existing) {
            existing.leads.push(lead);
        } else {
            groups.set(key, { companyId: lead.companyId, companyName: lead.companyName, leads: [lead] });
        }
    }
    return Array.from(groups.values());
}

async function loadExistingCompanySignals(companyIds: string[]): Promise<Map<string, CompanySignal[]>> {
    const map = new Map<string, CompanySignal[]>();
    if (companyIds.length === 0) return map;

    const rows = await prisma.companySignal.findMany({
        where: {
            companyId: { in: companyIds },
            signalType: { in: [SignalType.HIRING_SIGNAL, SignalType.INTENT_SIGNAL] },
            source: JOB_INTEL_SOURCE,
        },
    });

    for (const row of rows) {
        const list = map.get(row.companyId);
        if (list) list.push(row);
        else map.set(row.companyId, [row]);
    }
    return map;
}

async function persistCompanySignals(params: {
    companyId: string;
    leads: LeadRef[];
    signals: PersistableSignal[];
    writeCompanySignal: boolean;
    metrics: JobIntelMetrics;
}): Promise<void> {
    const { companyId, leads, signals, writeCompanySignal, metrics } = params;
    if (signals.length === 0 || leads.length === 0) return;

    if (writeCompanySignal) {
        await Promise.all(
            signals.map((signal) =>
                upsertCompanySignal({
                    companyId,
                    signalType: signal.signalType,
                    value: signal.value,
                    confidence: signal.confidence,
                    source: JOB_INTEL_SOURCE,
                    explanation: signal.explanation,
                }),
            ),
        );
    }

    const operations = leads.flatMap((lead) =>
        signals.map((signal) =>
            prisma.leadSignal.upsert({
                where: {
                    leadId_signalType_value: { leadId: lead.id, signalType: signal.signalType, value: signal.value },
                },
                create: {
                    leadId: lead.id,
                    signalType: signal.signalType,
                    value: signal.value,
                    confidence: signal.confidence,
                    source: JOB_INTEL_SOURCE,
                    explanation: signal.explanation,
                },
                update: {
                    lastSeenAt: new Date(),
                    confidence: signal.confidence,
                    explanation: signal.explanation,
                },
            }),
        ),
    );

    for (const batch of chunk(operations, TRANSACTION_CHUNK_SIZE)) {
        await prisma.$transaction(batch);
    }

    metrics.leadsEnriched += leads.length;
    metrics.signalsPersisted += signals.length * leads.length;
}

async function persistLeadOnlySignals(params: {
    leads: LeadRef[];
    signals: PersistableSignal[];
    metrics: JobIntelMetrics;
}): Promise<void> {
    const { leads, signals, metrics } = params;
    if (leads.length === 0 || signals.length === 0) return;

    await prisma.leadSignal.createMany({
        data: leads.flatMap((lead) =>
            signals.map((signal) => ({
                leadId: lead.id,
                type: signal.signalType,
                signalType: signal.signalType,
                value: signal.value,
                confidence: signal.confidence,
                source: JOB_INTEL_SOURCE,
                explanation: signal.explanation,
            })),
        ),
        skipDuplicates: true,
    });

    metrics.leadsEnriched += leads.length;
    metrics.signalsPersisted += signals.length * leads.length;
}

async function processKnownCompanyGroup(params: {
    companyId: string;
    companyName: string;
    leads: LeadRef[];
    icpDescription: string;
    refreshThreshold: Date;
    existingSignals: CompanySignal[];
    metrics: JobIntelMetrics;
}): Promise<void> {
    const { companyId, companyName, leads, icpDescription, refreshThreshold, existingSignals, metrics } = params;

    const isFresh = existingSignals.length > 0 && existingSignals.every((s) => s.lastSeenAt > refreshThreshold);

    if (isFresh) {
        const cached: PersistableSignal[] = existingSignals.map((s) => ({
            signalType: s.signalType,
            value: s.value,
            confidence: s.confidence,
            explanation: s.explanation ?? "",
        }));
        await persistCompanySignals({ companyId, leads, signals: cached, writeCompanySignal: false, metrics });
        metrics.cacheHits++;
        return;
    }

    const hadPriorData = existingSignals.length > 0;
    if (hadPriorData) metrics.companiesRefreshed++;

    const { signals, hadNoPostings, searchReliable } = await fetchAndExtractSignalsDeduped({ companyName, icpDescription, metrics });

    const realSignals = signals.length > 0 ? toPersistable(signals) : [];
    const shouldFlagUncertain = realSignals.length === 0 && hadNoPostings && hadPriorData && searchReliable;
    const uncertainFallback = shouldFlagUncertain ? toPersistable([buildUnconfirmedSlowdownSignal()]) : [];

    const freshWrites = realSignals.length > 0 ? realSignals : uncertainFallback;
    const freshValues = new Set(freshWrites.map((s) => s.value));
    const staleDecays = freshWrites.length > 0 ? buildStaleSignalUpdates(existingSignals, freshValues) : [];

    const combined = [...freshWrites, ...staleDecays];
    if (combined.length === 0) return;

    metrics.staleSignalsDecayed += staleDecays.length;
    await persistCompanySignals({ companyId, leads, signals: combined, writeCompanySignal: true, metrics });
}

async function processUnknownCompanyGroup(params: {
    companyName: string;
    leads: LeadRef[];
    icpDescription: string;
    metrics: JobIntelMetrics;
}): Promise<void> {
    const { companyName, leads, icpDescription, metrics } = params;

    const { signals } = await fetchAndExtractSignalsDeduped({ companyName, icpDescription, metrics });
    if (signals.length === 0) return;

    await persistLeadOnlySignals({ leads, signals: toPersistable(signals), metrics });
}

async function processCompanyGroup(params: {
    group: CompanyGroup;
    icpDescription: string;
    refreshThreshold: Date;
    existingSignals: CompanySignal[];
    metrics: JobIntelMetrics;
}): Promise<void> {
    const { group, icpDescription, refreshThreshold, existingSignals, metrics } = params;
    const startedAt = Date.now();

    try {
        if (group.companyId) {
            await processKnownCompanyGroup({
                companyId: group.companyId,
                companyName: group.companyName,
                leads: group.leads,
                icpDescription,
                refreshThreshold,
                existingSignals,
                metrics,
            });
        } else {
            await processUnknownCompanyGroup({ companyName: group.companyName, leads: group.leads, icpDescription, metrics });
        }
    } catch (err) {
        metrics.companyFailures++;
        logger.warn({ err, companyName: group.companyName }, "[job-intel] Failed to process company group");
    } finally {
        metrics.companyGroupsProcessed++;
        metrics.totalProcessingMs += Date.now() - startedAt;
    }
}

export async function runJobIntelAgent(campaignId: string, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return;

    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { icpDescription: true },
    });

    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    const refreshThreshold = new Date(Date.now() - REFRESH_WINDOW_DAYS * DAY_MS);
    const metrics = createMetrics();
    const companyLimit = pLimit(COMPANY_CONCURRENCY);

    let cursor: string | undefined;

    while (true) {
        if (signal?.aborted) {
            logger.info({ campaignId }, "[job-intel] Run cancelled before completion");
            break;
        }

        const leads = await prisma.lead.findMany({
            where: {
                campaignId,
                deletedAt: null,
                outreachMessages: { none: {} },
                OR: [
                    { signals: { none: { signalType: SignalType.HIRING_SIGNAL, source: JOB_INTEL_SOURCE } } },
                    {
                        signals: {
                            some: { signalType: SignalType.HIRING_SIGNAL, source: JOB_INTEL_SOURCE, lastSeenAt: { lt: refreshThreshold } },
                        },
                    },
                ],
            },
            select: { id: true, companyName: true, companyId: true },
            orderBy: { createdAt: "desc" },
            take: JOB_INTEL_BATCH_SIZE,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
        });

        if (leads.length === 0) break;

        logger.info({ campaignId, batch: leads.length, enriched: metrics.leadsEnriched }, "[job-intel] Processing batch");

        const companyGroups = groupLeadsForEnrichment(leads);
        const companyIds = companyGroups.map((g) => g.companyId).filter((id): id is string => Boolean(id));
        const existingSignalsByCompanyId = await loadExistingCompanySignals(companyIds);

        await Promise.allSettled(
            companyGroups.map((group) =>
                companyLimit(() =>
                    processCompanyGroup({
                        group,
                        icpDescription: campaign.icpDescription,
                        refreshThreshold,
                        existingSignals: group.companyId ? existingSignalsByCompanyId.get(group.companyId) ?? [] : [],
                        metrics,
                    }),
                ),
            ),
        );

        cursor = leads[leads.length - 1].id;

        if (leads.length < JOB_INTEL_BATCH_SIZE) break;
    }

    const avgSerperLatencyMs = metrics.serperCalls ? Math.round(metrics.serperLatencyMs / metrics.serperCalls) : 0;
    const avgGeminiLatencyMs = metrics.geminiCalls ? Math.round(metrics.geminiLatencyMs / metrics.geminiCalls) : 0;
    const avgMsPerCompanyGroup = metrics.companyGroupsProcessed
        ? Math.round(metrics.totalProcessingMs / metrics.companyGroupsProcessed)
        : 0;
    const cacheableCompanies = metrics.cacheHits + metrics.companiesRefreshed;
    const cacheHitRate = cacheableCompanies ? Number((metrics.cacheHits / cacheableCompanies).toFixed(3)) : 0;

    logger.info(
        {
            campaignId,
            ...metrics,
            avgMsPerCompanyGroup,
            avgSerperLatencyMs,
            avgGeminiLatencyMs,
            cacheHitRate,
        },
        "[job-intel] Job intelligence run complete",
    );
}