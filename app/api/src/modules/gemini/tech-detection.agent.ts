import { Prisma, SignalType } from "@prisma/client";
import { randomUUID } from "crypto";
import dns from "dns/promises";
import pLimit from "p-limit";
import { prisma } from "../../lib/prisma";
import { redis } from "../../lib/ioredis";
import { callGemini, extractJSON, MODELS } from "./gemini.client";
import { logger } from "../../lib/logger";

// ─── Constants ────────────────────────────────────────────────────────────────

const TECH_ENRICHMENT_KEY = "techStack";
const BUILTWITH_TECH_LIMIT = 50;
const GEMINI_TECH_LIMIT = 15;
const DETECTION_CONCURRENCY = 5;

const TECH_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1_000;
const FAILURE_RETRY_TTL_MS = 1 * 24 * 60 * 60 * 1_000;
const NO_TECH_RETRY_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const DOMAIN_CACHE_TTL_SEC = 90 * 24 * 60 * 60;
const DISTRIBUTED_LOCK_TTL_MS = 60_000;

const BUILTWITH_CONFIDENCE = 0.97;
const HEADERS_CONFIDENCE = 0.80;
const DNS_CONFIDENCE = 0.90;
const SERPER_CONFIDENCE = 0.62;

const BUILTWITH_EARLY_EXIT_THRESHOLD = 0.95;

const CONFIDENCE_SOURCE_WEIGHT = 0.7;
const CONFIDENCE_AI_WEIGHT = 0.3;

const RETRY_MAX_ATTEMPTS = 3;
const RETRY_BASE_DELAY_MS = 600;

const builtwithLimit = pLimit(2);
const serperLimit = pLimit(3);
const geminiLimit = pLimit(3);

// ─── Metrics ──────────────────────────────────────────────────────────────────

interface EnrichmentMetrics {
    builtwithHits: number;
    cacheHits: number;
    geminiSkipped: number;
    geminiCalled: number;
    earlyExits: number;
    migrationSignals: number;
    totalProcessed: number;
    totalEnriched: number;
    startedAt: number;
}

function makeMetrics(): EnrichmentMetrics {
    return { builtwithHits: 0, cacheHits: 0, geminiSkipped: 0, geminiCalled: 0, earlyExits: 0, migrationSignals: 0, totalProcessed: 0, totalEnriched: 0, startedAt: Date.now() };
}

function logMetrics(campaignId: string, m: EnrichmentMetrics): void {
    const elapsedMs = Date.now() - m.startedAt;
    logger.info({
        campaignId,
        builtwithHitPct: m.totalProcessed ? ((m.builtwithHits / m.totalProcessed) * 100).toFixed(1) + "%" : "n/a",
        cacheHitPct: m.totalProcessed ? ((m.cacheHits / m.totalProcessed) * 100).toFixed(1) + "%" : "n/a",
        geminiSkippedPct: m.totalProcessed ? ((m.geminiSkipped / m.totalProcessed) * 100).toFixed(1) + "%" : "n/a",
        earlyExits: m.earlyExits,
        migrationSignals: m.migrationSignals,
        geminiCalled: m.geminiCalled,
        totalProcessed: m.totalProcessed,
        totalEnriched: m.totalEnriched,
        elapsedMs,
        avgMsPerGroup: m.totalProcessed ? Math.round(elapsedMs / m.totalProcessed) : 0,
    }, "[tech-detection] metrics");
}

// ─── Technology taxonomy ──────────────────────────────────────────────────────

const KNOWN_CRMS = new Set([
    "hubspot", "salesforce", "pipedrive", "zoho crm", "microsoft dynamics",
    "dynamics 365", "freshsales", "copper", "close", "activecampaign",
    "keap", "insightly", "nutshell", "sugarcrm", "zendesk sell",
]);

const KNOWN_ANALYTICS = new Set([
    "google analytics", "mixpanel", "amplitude", "segment", "heap",
    "pendo", "fullstory", "hotjar", "kissmetrics", "adobe analytics",
    "snowplow", "rudderstack", "posthog",
]);

const KNOWN_CLOUD = new Set([
    "amazon web services", "aws", "google cloud", "google cloud platform",
    "microsoft azure", "azure", "cloudflare", "fastly", "vercel",
    "netlify", "digitalocean", "heroku",
]);

const KNOWN_AI_TOOLS = new Set([
    "openai", "anthropic", "cohere", "hugging face", "pinecone",
    "weaviate", "intercom fin", "drift ai", "chatgpt", "azure openai",
]);

const NOISE_TECHNOLOGIES = new Set([
    "jquery", "bootstrap", "react", "vue.js", "angular", "webpack",
    "babel", "lodash", "moment.js", "axios", "normalize.css", "font awesome",
    "google fonts", "recaptcha", "jsdelivr", "cdnjs", "woocommerce",
    "wix", "squarespace", "shopify checkout",
]);

function normalizeTech(t: string): string {
    return t.toLowerCase().trim();
}

// ─── Stack pattern inference ───────────────────────────────────────────────────

interface StackPattern {
    name: string;
    description: string;
    tier: "enterprise" | "mid-market" | "startup";
    requiredTechs: string[];
}

const STACK_PATTERNS: StackPattern[] = [
    {
        name: "Modern GTM Stack",
        description: "Sophisticated go-to-market with CRM, engagement, and analytics",
        tier: "mid-market",
        requiredTechs: ["hubspot", "segment", "intercom"],
    },
    {
        name: "Enterprise Sales Org",
        description: "Full enterprise sales and marketing infrastructure",
        tier: "enterprise",
        requiredTechs: ["salesforce", "marketo"],
    },
    {
        name: "Enterprise Sales Org",
        description: "Full enterprise sales and marketing infrastructure",
        tier: "enterprise",
        requiredTechs: ["salesforce", "pardot"],
    },
    {
        name: "Data-Driven Growth",
        description: "Analytics-first product-led growth stack",
        tier: "startup",
        requiredTechs: ["amplitude", "segment", "posthog"],
    },
    {
        name: "Sales Engagement Platform",
        description: "Active outbound sales motion with sequencing tools",
        tier: "mid-market",
        requiredTechs: ["salesloft", "salesforce"],
    },
    {
        name: "Sales Engagement Platform",
        description: "Active outbound sales motion with sequencing tools",
        tier: "mid-market",
        requiredTechs: ["outreach", "salesforce"],
    },
    {
        name: "Intent-Driven ABM",
        description: "Account-based marketing with buying intent signals",
        tier: "enterprise",
        requiredTechs: ["6sense", "salesforce"],
    },
    {
        name: "Intent-Driven ABM",
        description: "Account-based marketing with buying intent signals",
        tier: "enterprise",
        requiredTechs: ["demandbase", "salesforce"],
    },
    {
        name: "Cloud-Native Engineering",
        description: "Modern infrastructure on major cloud with observability",
        tier: "mid-market",
        requiredTechs: ["aws", "datadog"],
    },
    {
        name: "Cloud-Native Engineering",
        description: "Modern infrastructure on major cloud with observability",
        tier: "mid-market",
        requiredTechs: ["google cloud platform", "datadog"],
    },
];

function inferStackPatterns(technologies: string[]): StackPattern[] {
    const normalized = new Set(technologies.map(normalizeTech));
    return STACK_PATTERNS.filter(p =>
        p.requiredTechs.every(t => normalized.has(t)),
    );
}

// ─── Technology change detection ──────────────────────────────────────────────

interface TechRecord {
    name: string;
    firstSeen: string;
    lastSeen: string;
    confidence: number;
    source: string;
}

interface MigrationSignal {
    category: string;
    from: string;
    to: string;
    confidence: number;
    detectedAt: string;
}

function detectMigrations(
    oldTechs: TechRecord[],
    newTechs: string[],
    category: "CRM" | "Analytics" | "Cloud",
    knownSet: Set<string>,
): MigrationSignal[] {
    const oldInCategory = oldTechs.filter(t => knownSet.has(normalizeTech(t.name)));
    const newInCategory = newTechs.filter(t => knownSet.has(normalizeTech(t)));
    const migrations: MigrationSignal[] = [];

    for (const oldT of oldInCategory) {
        for (const newT of newInCategory) {
            if (normalizeTech(oldT.name) !== normalizeTech(newT)) {
                migrations.push({
                    category,
                    from: oldT.name,
                    to: newT,
                    confidence: 0.88,
                    detectedAt: new Date().toISOString(),
                });
            }
        }
    }

    return migrations;
}

function buildTechRecords(
    names: string[],
    source: string,
    confidence: number,
    existing: TechRecord[],
): TechRecord[] {
    const existingMap = new Map(existing.map(r => [normalizeTech(r.name), r]));
    const now = new Date().toISOString();

    return names.map(name => {
        const key = normalizeTech(name);
        const prev = existingMap.get(key);
        return prev
            ? { ...prev, lastSeen: now, confidence: Math.max(prev.confidence, confidence), source }
            : { name, firstSeen: now, lastSeen: now, confidence, source };
    });
}

// ─── Pre-compiled HTML detectors ──────────────────────────────────────────────

const HTML_DETECTORS: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /window\.__NEXT_DATA__/, name: "Next.js" },
    { pattern: /Nuxt\.js|__nuxt/, name: "Nuxt.js" },
    { pattern: /cdn\.segment\.com|analytics\.js/, name: "Segment" },
    { pattern: /js\.intercomcdn\.com|intercomSettings/, name: "Intercom" },
    { pattern: /js\.hs-analytics\.net|hubspot\.com\/beacon/, name: "HubSpot" },
    { pattern: /static\.hotjar\.com/, name: "Hotjar" },
    { pattern: /cdn\.amplitude\.com/, name: "Amplitude" },
    { pattern: /cdn\.pendo\.io/, name: "Pendo" },
    { pattern: /app\.fullstory\.com/, name: "FullStory" },
    { pattern: /mixpanel\.com\/lib/, name: "Mixpanel" },
    { pattern: /cdn\.posthog\.com/, name: "PostHog" },
    { pattern: /drift\.com\/drift-frame/, name: "Drift" },
    { pattern: /js\.chilipiper\.com/, name: "Chili Piper" },
    { pattern: /cdn\.heapanalytics\.com/, name: "Heap" },
    { pattern: /fast\.wistia\.net/, name: "Wistia" },
    { pattern: /platform\.linkedin\.com\/badges/, name: "LinkedIn Insight Tag" },
    { pattern: /munchkin\.marketo\.net/, name: "Marketo" },
    { pattern: /pi\.pardot\.com|cdn\.pardot\.com/, name: "Pardot" },
    { pattern: /salesloft\.com\/sl\.js/, name: "Salesloft" },
    { pattern: /js\.outreach\.io/, name: "Outreach" },
    { pattern: /6sc\.co|6sense\.com\/js/, name: "6sense" },
    { pattern: /tag\.demandbase\.com/, name: "Demandbase" },
    { pattern: /cdn\.clearbit\.com|x\.clearbit\.com/, name: "Clearbit" },
    { pattern: /apollo\.io\/js|app\.apollo\.io/, name: "Apollo" },
    { pattern: /cdn\.zoominfo\.com/, name: "ZoomInfo" },
    { pattern: /app\.termly\.io|cdn\.cookielaw\.org/, name: "OneTrust" },
    { pattern: /cdn\.cookiebot\.com/, name: "Cookiebot" },
    { pattern: /assets\.calendly\.com/, name: "Calendly" },
    { pattern: /browser\.sentry-cdn\.com/, name: "Sentry" },
    { pattern: /js\.stripe\.com/, name: "Stripe" },
    { pattern: /js\.chargebee\.com/, name: "Chargebee" },
    { pattern: /js\.recurly\.com/, name: "Recurly" },
    { pattern: /cdn\.optimizely\.com/, name: "Optimizely" },
    { pattern: /app\.launchdarkly\.com|clientsdk\.launchdarkly\.com/, name: "LaunchDarkly" },
    { pattern: /cdn\.algolia\.net|algoliasearch/, name: "Algolia" },
    { pattern: /js\.usemessages\.com|firebaseapp\.com/, name: "Firebase" },
    { pattern: /static\.klaviyo\.com/, name: "Klaviyo" },
    { pattern: /js\.driftt\.com/, name: "Drift" },
    { pattern: /cdn\.snowplow\.io/, name: "Snowplow" },
    { pattern: /js\.rudderstack\.com/, name: "RudderStack" },
];

// ─── DNS-based detection ──────────────────────────────────────────────────────

const MX_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /google\.com|googlemail\.com/, name: "Google Workspace" },
    { pattern: /outlook\.com|protection\.outlook\.com/, name: "Microsoft 365" },
    { pattern: /aspmx\.l\.google\.com/, name: "Google Workspace" },
    { pattern: /mxrecord\.io|hubspot\.com/, name: "HubSpot" },
    { pattern: /sendgrid\.net/, name: "SendGrid" },
    { pattern: /mailgun\.org/, name: "Mailgun" },
    { pattern: /mktomail\.com/, name: "Marketo" },
    { pattern: /exacttarget\.com|salesforce\.com/, name: "Salesforce Marketing Cloud" },
    { pattern: /zendesk\.com/, name: "Zendesk" },
    { pattern: /mimecast\.com/, name: "Mimecast" },
    { pattern: /ppe-hosted\.com|pphosted\.com/, name: "Proofpoint" },
];

const TXT_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
    { pattern: /google-site-verification/, name: "Google Workspace" },
    { pattern: /MS=/, name: "Microsoft 365" },
    { pattern: /include:_spf\.hubspot\.com/, name: "HubSpot" },
    { pattern: /include:sendgrid\.net/, name: "SendGrid" },
    { pattern: /include:spf\.mandrillapp\.com/, name: "Mailchimp" },
    { pattern: /include:mktomail\.com/, name: "Marketo" },
    { pattern: /include:spf\.salesforce\.com/, name: "Salesforce" },
    { pattern: /include:spf\.protection\.outlook\.com/, name: "Microsoft 365" },
    { pattern: /atlassian-domain-verification/, name: "Atlassian" },
    { pattern: /okta\.com|okta-domain/, name: "Okta" },
    { pattern: /auth0\.com/, name: "Auth0" },
    { pattern: /stripe\.com/, name: "Stripe" },
    { pattern: /docusign/i, name: "DocuSign" },
];

async function fetchViaDNS(domain: string): Promise<string[]> {
    const detected: string[] = [];

    await Promise.allSettled([
        dns.resolveMx(domain).then(records => {
            const combined = records.map(r => r.exchange.toLowerCase()).join(" ");
            for (const { pattern, name } of MX_PATTERNS) {
                if (pattern.test(combined)) detected.push(name);
            }
        }),
        dns.resolveTxt(domain).then(records => {
            const combined = records.flat().join(" ");
            for (const { pattern, name } of TXT_PATTERNS) {
                if (pattern.test(combined) && !detected.includes(name)) detected.push(name);
            }
        }),
    ]);

    return [...new Set(detected)];
}

// ─── Serper query expansion ───────────────────────────────────────────────────

function buildSerperQueries(companyName: string, domain: string): string[] {
    return [
        `site:${domain} "technology" OR "powered by" OR "built with"`,
        `"${companyName}" CRM OR "marketing automation" OR analytics software`,
        `"${companyName}" "uses" OR "switched to" OR "migrated to" software`,
        `site:${domain}/blog engineering OR "tech stack" OR architecture`,
        `site:${domain}/careers engineer OR developer OR infrastructure`,
        `"${companyName}" integrations OR "works with" software tools`,
    ];
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

type TechEnrichmentStatus = "SUCCESS" | "FAILED" | "NO_TECH_FOUND";

interface DomainCacheEntry {
    technologies: string[];
    provider: string;
    confidence: number;
    timestamp: string;
}

interface CachedTechStack {
    technologies?: string[];
    techRecords?: TechRecord[];
    crmDetected?: string | null;
    analyticsDetected?: string | null;
    cloudProvider?: string | null;
    aiToolsDetected?: string[];
    stackPatterns?: string[];
    migrations?: MigrationSignal[];
    detectedAt?: string;
    status?: TechEnrichmentStatus;
    lastCheckedAt?: string;
    sourceConfidence?: number;
    evidenceSources?: EvidenceRecord[];
}

interface EvidenceRecord {
    provider: string;
    url?: string;
    timestamp: string;
    confidence: number;
    technologies: string[];
}

interface SerperResult {
    title: string;
    link: string;
    snippet: string;
}

interface TechStackResult {
    technologies: string[];
    crmDetected: string | null;
    analyticsDetected: string | null;
    cloudProvider: string | null;
    aiToolsDetected: string[];
    techSignalValue: string;
    confidence: number;
    explanation: string;
    buyingSignals?: string[];
    salesMaturity?: string;
    migrationLikelihood?: string;
    aiAdoptionLevel?: string;
}

interface BuiltWithTech {
    Name: string;
}

interface BuiltWithResponse {
    Results?: Array<{
        Result?: {
            Paths?: Array<{
                Technologies?: BuiltWithTech[];
            }>;
        };
    }>;
}

interface DeterministicClassification {
    crmDetected: string | null;
    analyticsDetected: string | null;
    cloudProvider: string | null;
    aiToolsDetected: string[];
    isFullyClassified: boolean;
}

// ─── Pure utilities ───────────────────────────────────────────────────────────

function normalizeDomain(website: string): string | null {
    try {
        const url = new URL(website.startsWith("http") ? website : `https://${website}`);
        return url.hostname.replace(/^www\./, "").toLowerCase();
    } catch {
        return null;
    }
}

function isCacheFresh(cached: CachedTechStack): boolean {
    if (!cached.detectedAt) return false;
    return Date.now() - new Date(cached.detectedAt).getTime() < TECH_CACHE_TTL_MS;
}

function shouldSkipAfterFailure(cached: CachedTechStack): boolean {
    if (!cached.lastCheckedAt) return false;
    const age = Date.now() - new Date(cached.lastCheckedAt).getTime();
    if (cached.status === "FAILED") return age < FAILURE_RETRY_TTL_MS;
    if (cached.status === "NO_TECH_FOUND") return age < NO_TECH_RETRY_TTL_MS;
    return false;
}

function deriveCacheSignalValue(cached: CachedTechStack): string {
    const parts: string[] = [];
    if (cached.stackPatterns?.length) parts.push(cached.stackPatterns[0]!);
    else if (cached.crmDetected) parts.push(`CRM: ${cached.crmDetected}`);
    if (cached.cloudProvider) parts.push(`Cloud: ${cached.cloudProvider}`);
    if (cached.technologies?.length) parts.push(...cached.technologies.slice(0, 3));
    return (parts.join(", ") || "Tech stack detected").slice(0, 80);
}

function filterNoise(technologies: string[]): string[] {
    return technologies.filter(t => !NOISE_TECHNOLOGIES.has(normalizeTech(t)));
}

function mergeTechRecords(existing: TechRecord[] | undefined, incoming: TechRecord[]): TechRecord[] {
    const map = new Map((existing ?? []).map(r => [normalizeTech(r.name), r]));
    for (const r of incoming) {
        const key = normalizeTech(r.name);
        const prev = map.get(key);
        map.set(key, prev
            ? { ...prev, lastSeen: r.lastSeen, confidence: Math.max(prev.confidence, r.confidence), source: r.source }
            : r,
        );
    }
    return Array.from(map.values());
}

function mergeTechnologies(existing: string[] | undefined, incoming: string[]): string[] {
    return Array.from(new Set([...(existing ?? []), ...incoming]));
}

function buildSignalValue(techData: TechStackResult, stackPatterns: StackPattern[]): string {
    if (stackPatterns.length > 0) return stackPatterns[0]!.name.slice(0, 80);
    return (techData.buyingSignals?.[0] ?? techData.techSignalValue).slice(0, 80);
}

function weightedConfidence(sourceConf: number, aiConf: number): number {
    return Math.round((CONFIDENCE_SOURCE_WEIGHT * sourceConf + CONFIDENCE_AI_WEIGHT * aiConf) * 1000) / 1000;
}

// ─── Deterministic classification ─────────────────────────────────────────────

function classifyDeterministically(technologies: string[]): DeterministicClassification {
    const normalized = technologies.map(normalizeTech);
    const crmDetected = technologies[normalized.findIndex(t => KNOWN_CRMS.has(t))] ?? null;
    const analyticsDetected = technologies[normalized.findIndex(t => KNOWN_ANALYTICS.has(t))] ?? null;
    const cloudProvider = technologies[normalized.findIndex(t => KNOWN_CLOUD.has(t))] ?? null;
    const aiToolsDetected = technologies.filter((_, i) => KNOWN_AI_TOOLS.has(normalized[i]!));
    const classifiedCount = [crmDetected, analyticsDetected, cloudProvider].filter(Boolean).length;
    const isFullyClassified = classifiedCount >= 2 && technologies.length <= 15;
    return { crmDetected, analyticsDetected, cloudProvider, aiToolsDetected, isFullyClassified };
}

// ─── Distributed lock (token-based, safe release via Lua CAS) ─────────────────

const LOCK_RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

async function acquireLock(key: string): Promise<string | null> {
    const token = randomUUID();
    const lockKey = `lock:tech-detection:${key}`;
    const result = await redis.set(lockKey, token, "PX", DISTRIBUTED_LOCK_TTL_MS, "NX");
    return result === "OK" ? token : null;
}

async function releaseLock(key: string, token: string): Promise<void> {
    await (redis as any).eval(LOCK_RELEASE_SCRIPT, 1, `lock:tech-detection:${key}`, token);
}

// ─── Global domain cache (Redis) ──────────────────────────────────────────────

async function getDomainCache(domain: string): Promise<DomainCacheEntry | null> {
    const raw = await redis.get(`domain-tech:${domain}`);
    if (!raw) return null;
    try { return JSON.parse(raw) as DomainCacheEntry; } catch { return null; }
}

async function setDomainCache(domain: string, entry: DomainCacheEntry): Promise<void> {
    await redis.set(`domain-tech:${domain}`, JSON.stringify(entry), "EX", DOMAIN_CACHE_TTL_SEC);
}

// ─── Retry ────────────────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let attempt = 0; attempt < RETRY_MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) {
            await new Promise(r => setTimeout(r, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1)));
        }
        try {
            return await fn();
        } catch (err: any) {
            if (err?.status === 400 || err?.status === 401 || err?.status === 403) throw err;
            lastErr = err;
        }
    }
    throw lastErr;
}

// ─── External fetchers ────────────────────────────────────────────────────────

async function fetchViaBuiltWith(domain: string): Promise<string[]> {
    const key = process.env.BUILTWITH_API_KEY;
    if (!key) return [];

    return builtwithLimit(() => withRetry(async () => {
        const res = await fetch(
            `https://api.builtwith.com/v21/api.json?KEY=${key}&LOOKUP=${domain}`,
            { signal: AbortSignal.timeout(10_000) },
        );
        if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`BuiltWith ${res.status}`), { status: res.status });
        if (!res.ok) return [];
        const data = (await res.json()) as BuiltWithResponse;
        return (
            data.Results?.[0]?.Result?.Paths?.flatMap(p => p.Technologies?.map(t => t.Name) ?? []) ?? []
        ).slice(0, BUILTWITH_TECH_LIMIT);
    }));
}

async function fetchViaSerper(companyName: string, domain: string): Promise<SerperResult[]> {
    if (!process.env.SERPER_API_KEY) return [];

    const queries = buildSerperQueries(companyName, domain);
    const allResults: SerperResult[] = [];

    for (const q of queries) {
        const results = await serperLimit(() => withRetry(async () => {
            const res = await fetch("https://google.serper.dev/search", {
                method: "POST",
                headers: { "X-API-KEY": process.env.SERPER_API_KEY!, "Content-Type": "application/json" },
                body: JSON.stringify({ q, num: 4 }),
                signal: AbortSignal.timeout(8_000),
            });
            if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`Serper ${res.status}`), { status: res.status });
            if (!res.ok) return [] as SerperResult[];
            const data = (await res.json()) as { organic?: SerperResult[] };
            return data.organic ?? [];
        }));
        allResults.push(...results);
    }

    const seen = new Set<string>();
    return allResults.filter(r => {
        if (seen.has(r.link)) return false;
        seen.add(r.link);
        return true;
    });
}

async function fetchViaHTTPHeaders(website: string): Promise<string[]> {
    const url = website.startsWith("http") ? website : `https://${website}`;

    let res: Response;
    try {
        res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(5_000) });
        if (res.status === 405) {
            res = await fetch(url, { method: "GET", headers: { Range: "bytes=0-0" }, signal: AbortSignal.timeout(5_000) });
        }
    } catch {
        return [];
    }

    const detected: string[] = [];
    const server = res.headers.get("server")?.toLowerCase() ?? "";
    const powered = res.headers.get("x-powered-by")?.toLowerCase() ?? "";
    const via = res.headers.get("via")?.toLowerCase() ?? "";

    if (server.includes("cloudflare")) detected.push("Cloudflare");
    if (server.includes("nginx")) detected.push("nginx");
    if (server.includes("apache")) detected.push("Apache");
    if (powered.includes("next.js")) detected.push("Next.js");
    if (powered.includes("php")) detected.push("PHP");
    if (via.includes("cloudfront")) detected.push("Amazon CloudFront");
    if (res.headers.has("x-shopify-stage")) detected.push("Shopify");
    if (res.headers.has("x-vercel-id")) detected.push("Vercel");
    if (res.headers.has("x-wix-request-id")) detected.push("Wix");
    if (res.headers.has("x-hubspot-request-id")) detected.push("HubSpot");

    return detected;
}

async function fetchViaHTMLScan(website: string): Promise<string[]> {
    try {
        const res = await fetch(website.startsWith("http") ? website : `https://${website}`, {
            signal: AbortSignal.timeout(8_000),
            headers: { Accept: "text/html" },
        });
        if (!res.ok) return [];
        const html = await res.text();
        const detected: string[] = [];
        for (const { pattern, name } of HTML_DETECTORS) {
            if (pattern.test(html)) detected.push(name);
        }
        return detected;
    } catch {
        return [];
    }
}

// ─── Gemini analysis ──────────────────────────────────────────────────────────

async function analyzeTechStack(params: {
    companyName: string;
    technologies: string[];
    searchSnippets: SerperResult[];
    icpDescription: string;
    partialClassification: DeterministicClassification;
    sourceConfidence: number;
}): Promise<TechStackResult | null> {
    const { companyName, technologies, searchSnippets, icpDescription, partialClassification, sourceConfidence } = params;

    if (technologies.length === 0 && searchSnippets.length === 0) return null;

    const topTechs = technologies.slice(0, GEMINI_TECH_LIMIT);

    const techList = topTechs.length > 0
        ? `Technologies detected: ${topTechs.join(", ")}`
        : `Search evidence:\n${searchSnippets.map((r, i) => `${i + 1}. ${r.title}: ${r.snippet}`).join("\n")}`;

    const systemPrompt = partialClassification.isFullyClassified
        ? `You are a B2B intelligence analyst. Classification is already complete — CRM: ${partialClassification.crmDetected ?? "none"}, Analytics: ${partialClassification.analyticsDetected ?? "none"}, Cloud: ${partialClassification.cloudProvider ?? "none"}, AI tools: ${partialClassification.aiToolsDetected.join(", ") || "none"}.

Identify buying signals ONLY:
- CRM migrations (e.g. moved from HubSpot to Salesforce)
- New tool adoption (< 6 months old)
- Outdated tools ripe for replacement
- Competitor products in use
- Technology expansion velocity (> 3 new tools recently)
- Sales engagement or intent data tools installed

Also assess:
- salesMaturity: "nascent" | "developing" | "mature" | "advanced"
- migrationLikelihood: "low" | "medium" | "high"
- aiAdoptionLevel: "none" | "exploring" | "adopting" | "advanced"

Return ONLY JSON:
{
  "technologies": string[],
  "crmDetected": null,
  "analyticsDetected": null,
  "cloudProvider": null,
  "aiToolsDetected": [],
  "techSignalValue": string (max 80 chars),
  "confidence": number (0.0–1.0),
  "explanation": string (max 120 chars),
  "buyingSignals": string[],
  "salesMaturity": string,
  "migrationLikelihood": string,
  "aiAdoptionLevel": string
}`
        : `You are a B2B intelligence analyst specialising in technology-based buying signals.

Identify CRM, analytics, cloud provider, and AI tooling.

Detect buying signals:
- CRM migrations (e.g. moved from HubSpot to Salesforce)
- New tool adoption (< 6 months old)
- Outdated tools ripe for replacement
- Competitor products in use
- Technology expansion velocity (> 3 new tools recently)
- Sales engagement or intent data tools installed

Also assess:
- salesMaturity: "nascent" | "developing" | "mature" | "advanced"
- migrationLikelihood: "low" | "medium" | "high"
- aiAdoptionLevel: "none" | "exploring" | "adopting" | "advanced"

Return ONLY JSON:
{
  "technologies": string[],
  "crmDetected": string | null,
  "analyticsDetected": string | null,
  "cloudProvider": string | null,
  "aiToolsDetected": string[],
  "techSignalValue": string (max 80 chars),
  "confidence": number (0.0–1.0),
  "explanation": string (max 120 chars),
  "buyingSignals": string[],
  "salesMaturity": string,
  "migrationLikelihood": string,
  "aiAdoptionLevel": string
}`;

    const { text } = await geminiLimit(() => callGemini({
        agentName: "tech-detection.analyzer",
        model: MODELS.RESEARCH,
        systemPrompt,
        userPrompt: `Company: ${companyName}\nICP: ${icpDescription}\nSource confidence: ${sourceConfidence}\n\n${techList}`,
        temperature: 0.2,
    }));

    const result = extractJSON<TechStackResult | null>(text);
    if (!result || result.confidence < 0.5) return null;

    if (partialClassification.crmDetected) result.crmDetected = partialClassification.crmDetected;
    if (partialClassification.analyticsDetected) result.analyticsDetected = partialClassification.analyticsDetected;
    if (partialClassification.cloudProvider) result.cloudProvider = partialClassification.cloudProvider;
    if (partialClassification.aiToolsDetected.length) {
        result.aiToolsDetected = Array.from(new Set([...result.aiToolsDetected, ...partialClassification.aiToolsDetected]));
    }

    return result;
}

// ─── Versioned signal writers ─────────────────────────────────────────────────

async function writeVersionedCompanySignal(tx: Prisma.TransactionClient, params: {
    companyId: string;
    value: string;
    confidence: number;
    source: string;
    explanation: string;
}): Promise<void> {
    const { companyId, value, confidence, source, explanation } = params;
    const now = new Date();

    await tx.companySignal.updateMany({
        where: { companyId, signalType: SignalType.TECH_SIGNAL, isActive: true, value: { not: value } },
        data: { isActive: false, expiresAt: now },
    });

    await tx.companySignal.upsert({
        where: { companyId_signalType_value: { companyId, signalType: SignalType.TECH_SIGNAL, value } },
        create: { companyId, signalType: SignalType.TECH_SIGNAL, value, confidence, source, explanation, isActive: true, firstSeenAt: now },
        update: { confidence, source, explanation, isActive: true, lastSeenAt: now },
    });
}

async function writeMigrationSignals(tx: Prisma.TransactionClient, companyId: string, migrations: MigrationSignal[]): Promise<void> {
    const now = new Date();
    for (const m of migrations) {
        const value = `${m.category} migration: ${m.from} → ${m.to}`.slice(0, 80);
        await tx.companySignal.upsert({
            where: { companyId_signalType_value: { companyId, signalType: SignalType.TECH_SIGNAL, value } },
            create: { companyId, signalType: SignalType.TECH_SIGNAL, value, confidence: m.confidence, source: "tech_detection_migration", explanation: `Detected ${m.category} migration`, isActive: true, firstSeenAt: now },
            update: { confidence: m.confidence, isActive: true, lastSeenAt: now },
        });
    }
}

async function writeVersionedLeadSignalBatch(tx: Prisma.TransactionClient, params: {
    leads: Array<{ id: string }>;
    value: string;
    confidence: number;
    source: string;
    explanation: string | null;
}): Promise<void> {
    const { leads, value, confidence, source, explanation } = params;
    const now = new Date();
    const leadIds = leads.map(l => l.id);

    await tx.leadSignal.updateMany({
        where: { leadId: { in: leadIds }, signalType: SignalType.TECH_SIGNAL, isActive: true, value: { not: value } },
        data: { isActive: false, expiresAt: now },
    });

    await Promise.all(
        leadIds.map(leadId =>
            tx.leadSignal.upsert({
                where: { leadId_signalType_value: { leadId, signalType: SignalType.TECH_SIGNAL, value } },
                create: { leadId, signalType: SignalType.TECH_SIGNAL, value, confidence, source, explanation, isActive: true, firstSeenAt: now },
                update: { confidence, source, explanation, isActive: true, lastSeenAt: now },
            }),
        ),
    );
}

// ─── Detection orchestrator ───────────────────────────────────────────────────

interface DetectionResult {
    allRawTechs: string[];
    rawTechs: string[];
    headerTechs: string[];
    htmlTechs: string[];
    dnsTechs: string[];
    snippets: SerperResult[];
    sourceConf: number;
    signalSourceHint: string;
    earlyExit: boolean;
}

async function collectTechEvidence(
    domain: string,
    website: string,
    companyName: string,
    domainCacheEntry: DomainCacheEntry | null,
    metrics: EnrichmentMetrics,
): Promise<DetectionResult> {
    let rawTechs: string[];
    let signalSourceHint: string;

    if (domainCacheEntry) {
        rawTechs = domainCacheEntry.technologies;
        signalSourceHint = domainCacheEntry.provider;
        metrics.cacheHits++;
    } else {
        rawTechs = await fetchViaBuiltWith(domain);
        if (rawTechs.length > 0) {
            metrics.builtwithHits++;
            signalSourceHint = "builtwith";
            await setDomainCache(domain, { technologies: rawTechs, provider: "builtwith", confidence: BUILTWITH_CONFIDENCE, timestamp: new Date().toISOString() });
        } else {
            signalSourceHint = "builtwith";
        }
    }

    const sourceConfBuiltWith = rawTechs.length > 0 ? (domainCacheEntry?.confidence ?? BUILTWITH_CONFIDENCE) : 0;

    if (sourceConfBuiltWith >= BUILTWITH_EARLY_EXIT_THRESHOLD) {
        metrics.earlyExits++;
        return { allRawTechs: rawTechs, rawTechs, headerTechs: [], htmlTechs: [], dnsTechs: [], snippets: [], sourceConf: sourceConfBuiltWith, signalSourceHint, earlyExit: true };
    }

    const [headerTechs, htmlTechs, dnsTechs] = await Promise.all([
        rawTechs.length === 0 ? fetchViaHTTPHeaders(website) : Promise.resolve([]),
        rawTechs.length === 0 ? fetchViaHTMLScan(website) : Promise.resolve([]),
        fetchViaDNS(domain),
    ]);

    const allRawTechs = [...new Set([...rawTechs, ...headerTechs, ...htmlTechs, ...dnsTechs])];

    const sourceConf = rawTechs.length > 0 ? sourceConfBuiltWith
        : dnsTechs.length > 0 ? DNS_CONFIDENCE
            : headerTechs.length > 0 || htmlTechs.length > 0 ? HEADERS_CONFIDENCE
                : 0;

    const snippets = allRawTechs.length === 0 ? await fetchViaSerper(companyName, domain) : [];

    const effectiveConf = snippets.length > 0 && allRawTechs.length === 0 ? SERPER_CONFIDENCE : sourceConf;

    if (headerTechs.length > 0 && signalSourceHint === "builtwith") signalSourceHint = "http_headers";
    if (htmlTechs.length > 0 && signalSourceHint === "http_headers") signalSourceHint = "html_scan";
    if (dnsTechs.length > 0 && rawTechs.length === 0) signalSourceHint = "dns";
    if (snippets.length > 0 && allRawTechs.length === 0) signalSourceHint = "serper";

    return { allRawTechs, rawTechs, headerTechs, htmlTechs, dnsTechs, snippets, sourceConf: effectiveConf, signalSourceHint, earlyExit: false };
}

// ─── Main agent ───────────────────────────────────────────────────────────────

export async function runTechDetectionAgent(campaignId: string): Promise<void> {
    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { icpDescription: true },
    });

    if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

    const ninetyDaysAgo = new Date(Date.now() - TECH_CACHE_TTL_MS);

    const leads = await prisma.lead.findMany({
        where: {
            campaignId,
            deletedAt: null,
            website: { not: null },
            outreachMessages: { none: {} },
            OR: [
                { signals: { none: { signalType: "TECH_SIGNAL" } } },
                { signals: { some: { signalType: "TECH_SIGNAL", lastSeenAt: { lt: ninetyDaysAgo } } } },
            ],
        },
        select: {
            id: true,
            companyName: true,
            website: true,
            enrichmentData: true,
            companyId: true,
        },
        orderBy: { qualificationScore: "desc" },
        take: 25,
    });

    logger.info({ campaignId, count: leads.length }, "[tech-detection] Processing leads");

    const metrics = makeMetrics();

    type LeadRow = typeof leads[number];
    type LeadGroup = { companyId: string | null; domain: string | null; leads: LeadRow[] };

    const groupMap = new Map<string, LeadGroup>();
    for (const lead of leads) {
        const domain = lead.website ? normalizeDomain(lead.website) : null;
        const key = lead.companyId ?? domain ?? lead.id;
        if (!groupMap.has(key)) groupMap.set(key, { companyId: lead.companyId, domain, leads: [] });
        groupMap.get(key)!.leads.push(lead);
    }

    const limit = pLimit(DETECTION_CONCURRENCY);

    await Promise.allSettled(
        Array.from(groupMap.entries()).map(([key, group]) =>
            limit(async () => {
                const rep = group.leads[0];
                if (!rep.website) return;

                const domain = group.domain ?? normalizeDomain(rep.website);
                if (!domain) return;

                const lockToken = await acquireLock(key);
                if (!lockToken) {
                    logger.debug({ key }, "[tech-detection] Skipping — lock held by another worker");
                    return;
                }

                metrics.totalProcessed++;

                try {
                    if (group.companyId) {
                        const company = await prisma.company.findUnique({
                            where: { id: group.companyId },
                            select: { enrichmentData: true },
                        });
                        const companyData = (company?.enrichmentData ?? {}) as Record<string, unknown>;
                        const cachedStack = companyData[TECH_ENRICHMENT_KEY] as CachedTechStack | undefined;

                        if (cachedStack && isCacheFresh(cachedStack)) {
                            metrics.cacheHits++;

                            let existingSignal = await prisma.companySignal.findFirst({
                                where: { companyId: group.companyId, signalType: SignalType.TECH_SIGNAL, isActive: true },
                                select: { signalType: true, value: true, confidence: true, source: true, explanation: true },
                            });

                            if (!existingSignal) {
                                const value = deriveCacheSignalValue(cachedStack);
                                const explanation = "Reconstructed from cached company enrichment data";
                                await prisma.$transaction(async tx => {
                                    await writeVersionedCompanySignal(tx, { companyId: group.companyId!, value, confidence: 0.7, source: "tech_detection_cache", explanation });
                                });
                                existingSignal = { signalType: SignalType.TECH_SIGNAL, value, confidence: 0.7, source: "tech_detection_cache", explanation };
                                logger.info({ companyId: group.companyId }, "[tech-detection] Reconstructed missing CompanySignal from cache");
                            }

                            await prisma.$transaction(async tx => {
                                await writeVersionedLeadSignalBatch(tx, {
                                    leads: group.leads,
                                    value: existingSignal!.value,
                                    confidence: existingSignal!.confidence,
                                    source: existingSignal!.source ?? "tech_detection",
                                    explanation: existingSignal!.explanation,
                                });
                            });

                            metrics.totalEnriched += group.leads.length;
                            return;
                        }

                        if (cachedStack && shouldSkipAfterFailure(cachedStack)) {
                            logger.debug({ companyId: group.companyId, status: cachedStack.status }, "[tech-detection] Skipping — within failure backoff window");
                            return;
                        }

                        const domainCacheEntry = await getDomainCache(domain);
                        const evidence = await collectTechEvidence(domain, rep.website!, rep.companyName, domainCacheEntry, metrics);
                        const { allRawTechs, rawTechs, headerTechs, htmlTechs, snippets, sourceConf: effectiveConf, signalSourceHint } = evidence;

                        const failureBase: CachedTechStack = { ...(cachedStack ?? {}), lastCheckedAt: new Date().toISOString() };

                        if (allRawTechs.length === 0 && snippets.length === 0) {
                            await prisma.company.update({
                                where: { id: group.companyId },
                                data: { enrichmentData: { ...companyData, [TECH_ENRICHMENT_KEY]: { ...failureBase, status: "NO_TECH_FOUND" } } as unknown as Prisma.InputJsonValue },
                            });
                            return;
                        }

                        const partial = classifyDeterministically(allRawTechs);
                        const stackPatterns = inferStackPatterns(allRawTechs);

                        let techData: TechStackResult | null = null;

                        if (partial.isFullyClassified && snippets.length === 0) {
                            metrics.geminiSkipped++;
                            techData = {
                                technologies: filterNoise(allRawTechs),
                                crmDetected: partial.crmDetected,
                                analyticsDetected: partial.analyticsDetected,
                                cloudProvider: partial.cloudProvider,
                                aiToolsDetected: partial.aiToolsDetected,
                                techSignalValue: [
                                    partial.crmDetected && `CRM: ${partial.crmDetected}`,
                                    partial.cloudProvider && `Cloud: ${partial.cloudProvider}`,
                                ].filter(Boolean).join(", ").slice(0, 80) || "Tech stack detected",
                                confidence: effectiveConf,
                                explanation: "Classified deterministically — no AI call needed",
                                buyingSignals: [],
                            };
                        } else {
                            metrics.geminiCalled++;
                            techData = await analyzeTechStack({
                                companyName: rep.companyName,
                                technologies: filterNoise(allRawTechs),
                                searchSnippets: snippets,
                                icpDescription: campaign.icpDescription,
                                partialClassification: partial,
                                sourceConfidence: effectiveConf,
                            });
                        }

                        if (!techData) {
                            await prisma.company.update({
                                where: { id: group.companyId },
                                data: { enrichmentData: { ...companyData, [TECH_ENRICHMENT_KEY]: { ...failureBase, status: "FAILED" } } as unknown as Prisma.InputJsonValue },
                            });
                            return;
                        }

                        const prevTechRecords = (cachedStack?.techRecords ?? []) as TechRecord[];
                        const newTechRecords = buildTechRecords(allRawTechs, signalSourceHint, effectiveConf, prevTechRecords);
                        const migrations = [
                            ...detectMigrations(prevTechRecords, allRawTechs, "CRM", KNOWN_CRMS),
                            ...detectMigrations(prevTechRecords, allRawTechs, "Analytics", KNOWN_ANALYTICS),
                            ...detectMigrations(prevTechRecords, allRawTechs, "Cloud", KNOWN_CLOUD),
                        ];

                        if (migrations.length > 0) metrics.migrationSignals += migrations.length;

                        const finalConf = partial.isFullyClassified ? effectiveConf : weightedConfidence(effectiveConf, techData.confidence);
                        const signalValue = buildSignalValue(techData, stackPatterns);
                        const fullExplanation = [
                            stackPatterns.length > 0 ? stackPatterns[0]!.description : techData.explanation,
                            techData.buyingSignals?.length ? `Signals: ${techData.buyingSignals.join("; ")}` : null,
                            techData.salesMaturity ? `Sales maturity: ${techData.salesMaturity}` : null,
                        ].filter(Boolean).join(" | ").slice(0, 200);

                        const evidenceRecord: EvidenceRecord = {
                            provider: signalSourceHint,
                            url: rep.website ?? undefined,
                            timestamp: new Date().toISOString(),
                            confidence: effectiveConf,
                            technologies: allRawTechs.slice(0, 20),
                        };

                        const techStackPayload: CachedTechStack = {
                            technologies: mergeTechnologies(cachedStack?.technologies, techData.technologies),
                            techRecords: mergeTechRecords(prevTechRecords, newTechRecords),
                            crmDetected: techData.crmDetected,
                            analyticsDetected: techData.analyticsDetected,
                            cloudProvider: techData.cloudProvider,
                            aiToolsDetected: techData.aiToolsDetected,
                            stackPatterns: stackPatterns.map(p => p.name),
                            migrations,
                            detectedAt: new Date().toISOString(),
                            status: "SUCCESS",
                            lastCheckedAt: new Date().toISOString(),
                            sourceConfidence: effectiveConf,
                            evidenceSources: [evidenceRecord, ...((cachedStack?.evidenceSources ?? []) as EvidenceRecord[])].slice(0, 10),
                        };

                        await prisma.$transaction(async tx => {
                            await tx.company.update({
                                where: { id: group.companyId! },
                                data: {
                                    enrichmentData: { ...companyData, [TECH_ENRICHMENT_KEY]: techStackPayload } as unknown as Prisma.InputJsonValue,
                                    lastEnrichedAt: new Date(),
                                },
                            });

                            await writeVersionedCompanySignal(tx, { companyId: group.companyId!, value: signalValue, confidence: finalConf, source: signalSourceHint, explanation: fullExplanation });

                            if (migrations.length > 0) {
                                await writeMigrationSignals(tx, group.companyId!, migrations);
                            }

                            await writeVersionedLeadSignalBatch(tx, { leads: group.leads, value: signalValue, confidence: finalConf, source: signalSourceHint, explanation: techData!.explanation });
                        });

                        metrics.totalEnriched += group.leads.length;

                    } else {
                        const repData = (rep.enrichmentData ?? {}) as Record<string, unknown>;
                        const leadCache = repData[TECH_ENRICHMENT_KEY] as CachedTechStack | undefined;

                        if (leadCache && shouldSkipAfterFailure(leadCache)) {
                            logger.debug({ leadId: rep.id }, "[tech-detection] Skipping — within failure backoff window");
                            return;
                        }

                        const domainCacheEntry = await getDomainCache(domain);
                        const evidence = await collectTechEvidence(domain, rep.website!, rep.companyName, domainCacheEntry, metrics);
                        const { allRawTechs, snippets, sourceConf, signalSourceHint } = evidence;

                        const writeFailure = async (status: TechEnrichmentStatus) => {
                            const leadIds = group.leads.map(l => l.id);
                            await prisma.lead.updateMany({
                                where: { id: { in: leadIds } },
                                data: { enrichmentData: { [TECH_ENRICHMENT_KEY]: { status, lastCheckedAt: new Date().toISOString() } } as unknown as Prisma.InputJsonValue },
                            });
                        };

                        if (allRawTechs.length === 0 && snippets.length === 0) {
                            await writeFailure("NO_TECH_FOUND");
                            return;
                        }

                        const partial = classifyDeterministically(allRawTechs);
                        const stackPatterns = inferStackPatterns(allRawTechs);

                        let techData: TechStackResult | null = null;

                        if (partial.isFullyClassified && snippets.length === 0) {
                            metrics.geminiSkipped++;
                            techData = {
                                technologies: filterNoise(allRawTechs),
                                crmDetected: partial.crmDetected,
                                analyticsDetected: partial.analyticsDetected,
                                cloudProvider: partial.cloudProvider,
                                aiToolsDetected: partial.aiToolsDetected,
                                techSignalValue: [
                                    partial.crmDetected && `CRM: ${partial.crmDetected}`,
                                    partial.cloudProvider && `Cloud: ${partial.cloudProvider}`,
                                ].filter(Boolean).join(", ").slice(0, 80) || "Tech stack detected",
                                confidence: sourceConf,
                                explanation: "Classified deterministically — no AI call needed",
                                buyingSignals: [],
                            };
                        } else {
                            metrics.geminiCalled++;
                            techData = await analyzeTechStack({
                                companyName: rep.companyName,
                                technologies: filterNoise(allRawTechs),
                                searchSnippets: snippets,
                                icpDescription: campaign.icpDescription,
                                partialClassification: partial,
                                sourceConfidence: sourceConf,
                            });
                        }

                        if (!techData) {
                            await writeFailure("FAILED");
                            return;
                        }

                        const prevTechRecords = (leadCache?.techRecords ?? []) as TechRecord[];
                        const newTechRecords = buildTechRecords(allRawTechs, signalSourceHint, sourceConf, prevTechRecords);
                        const migrations = [
                            ...detectMigrations(prevTechRecords, allRawTechs, "CRM", KNOWN_CRMS),
                            ...detectMigrations(prevTechRecords, allRawTechs, "Analytics", KNOWN_ANALYTICS),
                            ...detectMigrations(prevTechRecords, allRawTechs, "Cloud", KNOWN_CLOUD),
                        ];

                        if (migrations.length > 0) metrics.migrationSignals += migrations.length;

                        const finalConf = partial.isFullyClassified ? sourceConf : weightedConfidence(sourceConf, techData.confidence);
                        const signalValue = buildSignalValue(techData, stackPatterns);

                        const techStackPayload: CachedTechStack = {
                            technologies: mergeTechnologies(leadCache?.technologies, techData.technologies),
                            techRecords: mergeTechRecords(prevTechRecords, newTechRecords),
                            crmDetected: techData.crmDetected,
                            analyticsDetected: techData.analyticsDetected,
                            cloudProvider: techData.cloudProvider,
                            aiToolsDetected: techData.aiToolsDetected,
                            stackPatterns: stackPatterns.map(p => p.name),
                            migrations,
                            detectedAt: new Date().toISOString(),
                            status: "SUCCESS",
                            lastCheckedAt: new Date().toISOString(),
                            sourceConfidence: sourceConf,
                            evidenceSources: [{
                                provider: signalSourceHint,
                                url: rep.website ?? undefined,
                                timestamp: new Date().toISOString(),
                                confidence: sourceConf,
                                technologies: allRawTechs.slice(0, 20),
                            }],
                        };

                        const leadIds = group.leads.map(l => l.id);

                        await prisma.$transaction(async tx => {
                            await writeVersionedLeadSignalBatch(tx, { leads: group.leads, value: signalValue, confidence: finalConf, source: signalSourceHint, explanation: techData!.explanation });

                            await tx.lead.updateMany({
                                where: { id: { in: leadIds } },
                                data: { enrichmentData: { [TECH_ENRICHMENT_KEY]: techStackPayload } as unknown as Prisma.InputJsonValue },
                            });
                        });

                        metrics.totalEnriched += group.leads.length;
                    }
                } catch (err) {
                    logger.warn({ err, leadId: rep.id, key }, "[tech-detection] Failed for lead group");
                } finally {
                    await releaseLock(key, lockToken);
                }
            }),
        ),
    );

    logMetrics(campaignId, metrics);
    logger.info({ campaignId, enriched: metrics.totalEnriched }, "[tech-detection] Detection complete");
}