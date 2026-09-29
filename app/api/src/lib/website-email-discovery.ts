import * as cheerio from "cheerio";
import pLimit from "p-limit";
import { logger } from "./logger";
import { assertPublicHttpUrl } from "./url-safety";
import {
    getCachedEnrichmentValue,
    setCachedEnrichmentValue,
} from "../modules/gemini/enrichment-cache";

const FETCH_TIMEOUT_MS = 8_000;
const ROBOTS_TIMEOUT_MS = 4_000;
const MAX_SITEMAP_URLS = 2_000;
const MAX_SUB_SITEMAPS = 3;
const MAX_CANDIDATE_PAGES = 6;
const PAGE_FETCH_CONCURRENCY = 3;
const DOMAIN_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 21;
const USER_AGENT = "ScoutSendBot/1.0 (+https://scoutsend.com/bot)";

const CANDIDATE_PATH_KEYWORDS = [
    "team", "about", "about-us", "aboutus", "contact", "staff", "people",
    "leadership", "management", "founders", "who-we-are", "meet-the-team",
    "our-team", "our-story", "company", "leadership-team",
];

const FALLBACK_GUESS_PATHS = ["team", "about", "contact", "leadership"];

const GENERIC_LOCAL_PARTS = new Set([
    "info", "contact", "sales", "support", "admin", "hello", "hi", "team",
    "careers", "jobs", "press", "media", "marketing", "help", "office",
    "enquiries", "inquiries", "billing", "accounts", "privacy", "legal",
    "noreply", "no-reply", "webmaster", "postmaster", "abuse", "security",
]);

const EMAIL_REGEX = /[a-zA-Z0-9][a-zA-Z0-9._%+-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}/g;

export interface DiscoveredContact {
    email: string;
    nameRaw: string;
}

export interface WebsiteDiscoveryResult {
    domain: string;
    contacts: DiscoveredContact[];
    inferredPattern: string | null;
    patternExampleCount: number;
    pagesScanned: number;
    scannedAt: string;
}

export type DiscoveryMatch =
    | { kind: "direct"; email: string }
    | { kind: "pattern"; email: string; pattern: string };

const COMPANY_NAME_CACHE_TTL_MS = DOMAIN_CACHE_TTL_MS; // 21 days

/**
 * Fetches the homepage of a website and extracts the real company/brand name
 * from og:site_name → og:title → <title> (stripping "- Home | Tagline" suffixes).
 * Returns null if the URL is invalid, unreachable, or no name can be determined.
 */
export async function fetchCompanyNameFromWebsite(website: string): Promise<string | null> {
    let origin: string;
    let domain: string;
    try {
        const url = await assertPublicHttpUrl(website);
        origin = url.origin;
        domain = url.hostname.replace(/^www\./, "");
    } catch {
        return null;
    }

    const cacheKey = `company-name:${domain}`;
    const cached = await getCachedEnrichmentValue<string>(cacheKey, "domain");
    if (cached) return cached;

    const html = await fetchText(origin, 3000);
    if (!html) return null;

    const $ = cheerio.load(html);

    // 1. og:site_name is the cleanest signal
    const ogSiteName = $("meta[property='og:site_name']").attr("content")?.trim();
    if (ogSiteName && ogSiteName.length >= 2) {
        await setCachedEnrichmentValue(cacheKey, "domain", ogSiteName, COMPANY_NAME_CACHE_TTL_MS);
        return ogSiteName;
    }

    // 2. og:title — often "Company Name | Tagline"
    const ogTitle = $("meta[property='og:title']").attr("content")?.trim();
    const cleanedOgTitle = ogTitle ? cleanPageTitle(ogTitle) : null;
    if (cleanedOgTitle && cleanedOgTitle.length >= 2) {
        await setCachedEnrichmentValue(cacheKey, "domain", cleanedOgTitle, COMPANY_NAME_CACHE_TTL_MS);
        return cleanedOgTitle;
    }

    // 3. <title> tag — "Home | Company Name" or "Company – Tagline"
    const pageTitle = $("title").first().text().trim();
    const cleanedTitle = pageTitle ? cleanPageTitle(pageTitle) : null;
    if (cleanedTitle && cleanedTitle.length >= 2) {
        await setCachedEnrichmentValue(cacheKey, "domain", cleanedTitle, COMPANY_NAME_CACHE_TTL_MS);
        return cleanedTitle;
    }

    return null;
}

/**
 * Strips common homepage title patterns to extract a bare company name.
 * e.g. "Acme Inc. | Home", "Home – Acme", "Welcome to Acme Inc." → "Acme Inc."
 */
function cleanPageTitle(raw: string): string | null {
    // Split on separators and pick the shortest non-generic segment
    const SEPARATORS = /\s*[\|·•—–\-]\s*/;
    const GENERIC_WORDS = /^(home|welcome|index|official|site|website)$/i;

    const parts = raw.split(SEPARATORS).map((p) => p.trim()).filter(Boolean);
    // Filter out obvious generic parts
    const meaningful = parts.filter((p) => !GENERIC_WORDS.test(p));
    if (meaningful.length === 0) return null;

    // Prefer the shortest non-trivial segment (usually the brand name)
    const sorted = [...meaningful].sort((a, b) => a.length - b.length);
    const candidate = sorted[0];

    // Reject if it looks like a sentence (too long, or contains verbs/common words)
    if (!candidate || candidate.length > 60) return null;
    return candidate;
}

const EMPTY_RESULT = (domain: string): WebsiteDiscoveryResult => ({
    domain,
    contacts: [],
    inferredPattern: null,
    patternExampleCount: 0,
    pagesScanned: 0,
    scannedAt: new Date().toISOString(),
});

export async function discoverDomainEmails(website: string): Promise<WebsiteDiscoveryResult> {
    let origin: string;
    let domain: string;
    try {
        const url = await assertPublicHttpUrl(website);
        origin = url.origin;
        domain = url.hostname.replace(/^www\./, "");
    } catch (err) {
        logger.warn({ website, err }, "[website-email-discovery] Unsafe or invalid website URL — skipping");
        return EMPTY_RESULT(website);
    }

    const cacheKey = `website-discovery:${domain}`;
    const cached = await getCachedEnrichmentValue<WebsiteDiscoveryResult>(cacheKey, "domain");
    if (cached) {
        logger.info({ domain, contacts: cached.contacts.length }, "[website-email-discovery] Cache hit");
        return cached;
    }

    if (await isDisallowedByRobots(origin)) {
        logger.info({ domain }, "[website-email-discovery] Disallowed by robots.txt — skipping crawl");
        const result = EMPTY_RESULT(domain);
        await setCachedEnrichmentValue(cacheKey, "domain", result, DOMAIN_CACHE_TTL_MS);
        return result;
    }

    const candidateUrls = await findCandidatePages(origin);

    const limit = pLimit(PAGE_FETCH_CONCURRENCY);
    const pageResults = await Promise.all(
        candidateUrls.map(url => limit(() => extractContactsFromPage(url))),
    );

    const contacts = dedupeContacts(pageResults.flat());
    const { pattern, exampleCount } = inferPattern(contacts);

    const result: WebsiteDiscoveryResult = {
        domain,
        contacts,
        inferredPattern: pattern,
        patternExampleCount: exampleCount,
        pagesScanned: candidateUrls.length,
        scannedAt: new Date().toISOString(),
    };

    await setCachedEnrichmentValue(cacheKey, "domain", result, DOMAIN_CACHE_TTL_MS);
    logger.info(
        { domain, contacts: contacts.length, pattern, pagesScanned: candidateUrls.length },
        "[website-email-discovery] Crawl complete",
    );
    return result;
}

export function matchLeadToDiscovery(
    discovery: WebsiteDiscoveryResult,
    firstName: string | null | undefined,
    lastName: string | null | undefined,
): DiscoveryMatch | null {
    if (!firstName || !lastName) return null;
    const first = normalizeNamePart(firstName);
    const last = normalizeNamePart(lastName);
    if (!first || !last) return null;

    for (const contact of discovery.contacts) {
        const nameNorm = normalizeNamePart(contact.nameRaw);
        if (nameNorm.includes(first) && nameNorm.includes(last)) {
            return { kind: "direct", email: contact.email };
        }
    }

    if (discovery.inferredPattern) {
        const email = applyPattern(discovery.inferredPattern, first, last, discovery.domain);
        if (email) return { kind: "pattern", email, pattern: discovery.inferredPattern };
    }

    // First-party algorithmic pattern builder fallback ({first}.{last}@{domain}, {f}{last}@{domain})
    const algorithmicEmail = generateFirstPartyPatternCandidate(first, last, discovery.domain);
    if (algorithmicEmail) {
        return { kind: "pattern", email: algorithmicEmail, pattern: "{first}.{last}" };
    }

    return null;
}

export function generateFirstPartyPatternCandidate(first: string, last: string, domain: string): string | null {
    if (!first || !last || !domain) return null;
    const cleanFirst = first.toLowerCase().replace(/[^a-z0-9]/g, "");
    const cleanLast = last.toLowerCase().replace(/[^a-z0-9]/g, "");
    const cleanDomain = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    if (!cleanFirst || !cleanLast || !cleanDomain) return null;
    return `${cleanFirst}.${cleanLast}@${cleanDomain}`;
}

async function findCandidatePages(origin: string): Promise<string[]> {
    const sitemapUrls = await collectSitemapUrls(origin);

    if (sitemapUrls.length > 0) {
        const scored = sitemapUrls
            .map(url => ({ url, score: scoreCandidateUrl(url) }))
            .filter(({ score }) => score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_CANDIDATE_PAGES)
            .map(({ url }) => url);

        if (scored.length > 0) return scored;
    }

    return FALLBACK_GUESS_PATHS.map(path => `${origin}/${path}`);
}

async function collectSitemapUrls(origin: string): Promise<string[]> {
    let sitemapLocation = `${origin}/sitemap.xml`;

    const fromRobots = await findSitemapInRobots(origin);
    if (fromRobots) sitemapLocation = fromRobots;

    const rootXml = await fetchText(sitemapLocation);
    if (!rootXml) return [];

    const $ = cheerio.load(rootXml, { xmlMode: true });

    const subSitemaps = $("sitemapindex > sitemap > loc")
        .map((_, el) => $(el).text().trim())
        .get()
        .filter(Boolean);

    if (subSitemaps.length > 0) {
        const prioritized = [...subSitemaps]
            .sort((a, b) => scoreCandidateUrl(b) - scoreCandidateUrl(a))
            .slice(0, MAX_SUB_SITEMAPS);

        const subResults = await Promise.all(prioritized.map(url => fetchText(url)));
        const urls: string[] = [];
        for (const xml of subResults) {
            if (!xml) continue;
            const $$ = cheerio.load(xml, { xmlMode: true });
            $$("urlset > url > loc").each((_, el) => {
                if (urls.length < MAX_SITEMAP_URLS) urls.push($$(el).text().trim());
            });
        }
        return urls;
    }

    return $("urlset > url > loc")
        .map((_, el) => $(el).text().trim())
        .get()
        .slice(0, MAX_SITEMAP_URLS);
}

async function findSitemapInRobots(origin: string): Promise<string | null> {
    const body = await fetchText(`${origin}/robots.txt`, ROBOTS_TIMEOUT_MS);
    if (!body) return null;
    for (const line of body.split("\n")) {
        const match = line.match(/^\s*sitemap:\s*(\S+)/i);
        if (match) return match[1];
    }
    return null;
}

async function isDisallowedByRobots(origin: string): Promise<boolean> {
    const body = await fetchText(`${origin}/robots.txt`, ROBOTS_TIMEOUT_MS);
    if (!body) return false;
    let appliesToAllAgents = false;
    for (const rawLine of body.split("\n")) {
        const line = rawLine.trim().toLowerCase();
        if (line.startsWith("user-agent:")) {
            appliesToAllAgents = line.includes("*");
            continue;
        }
        if (appliesToAllAgents && line === "disallow: /") return true;
    }
    return false;
}

function scoreCandidateUrl(url: string): number {
    const path = url.toLowerCase();
    let score = 0;
    for (const keyword of CANDIDATE_PATH_KEYWORDS) {
        if (path.includes(`/${keyword}`)) score += keyword.length >= 6 ? 2 : 1;
    }
    return score;
}

async function extractContactsFromPage(rawUrl: string): Promise<DiscoveredContact[]> {
    const html = await fetchText(rawUrl);
    if (!html) return [];

    const $ = cheerio.load(html);
    $("script, style, noscript").remove();

    const found: DiscoveredContact[] = [];

    $("a[href^='mailto:']").each((_, el) => {
        const href = $(el).attr("href") ?? "";
        const email = href.replace(/^mailto:/i, "").split("?")[0].trim().toLowerCase();
        if (!isPlausibleEmail(email)) return;

        const linkText = $(el).text().trim();
        const parentText = $(el).parent().text().trim().slice(0, 120);
        found.push({ email, nameRaw: linkText || parentText });
    });

    const bodyText = $("body").text();
    const textMatches = bodyText.match(EMAIL_REGEX) ?? [];
    for (const raw of textMatches) {
        const email = raw.toLowerCase();
        if (!isPlausibleEmail(email)) continue;
        if (found.some(c => c.email === email)) continue;
        found.push({ email, nameRaw: "" });
    }

    return found;
}

function isPlausibleEmail(email: string): boolean {
    EMAIL_REGEX.lastIndex = 0;
    if (!EMAIL_REGEX.test(email)) return false;
    EMAIL_REGEX.lastIndex = 0;
    const localPart = email.split("@")[0];
    if (GENERIC_LOCAL_PARTS.has(localPart)) return false;
    if (/\.(png|jpg|jpeg|gif|svg|webp)$/i.test(email)) return false;
    return true;
}

function dedupeContacts(contacts: DiscoveredContact[]): DiscoveredContact[] {
    const byEmail = new Map<string, DiscoveredContact>();
    for (const c of contacts) {
        const existing = byEmail.get(c.email);
        if (!existing || (!existing.nameRaw && c.nameRaw)) byEmail.set(c.email, c);
    }
    return [...byEmail.values()];
}

const PATTERN_TEMPLATES: Array<{ id: string; build: (first: string, last: string) => string }> = [
    { id: "{first}.{last}", build: (f, l) => `${f}.${l}` },
    { id: "{first}{last}", build: (f, l) => `${f}${l}` },
    { id: "{f}.{last}", build: (f, l) => `${f[0]}.${l}` },
    { id: "{f}{last}", build: (f, l) => `${f[0]}${l}` },
    { id: "{first}", build: (f) => f },
    { id: "{first}_{last}", build: (f, l) => `${f}_${l}` },
    { id: "{last}.{first}", build: (f, l) => `${l}.${f}` },
];

function inferPattern(contacts: DiscoveredContact[]): { pattern: string | null; exampleCount: number } {
    const votes = new Map<string, number>();

    for (const contact of contacts) {
        if (!contact.nameRaw) continue;
        const parts = normalizeNamePart(contact.nameRaw).split(/\s+/).filter(Boolean);
        if (parts.length < 2) continue;
        const [first, last] = [parts[0], parts[parts.length - 1]];
        const localPart = contact.email.split("@")[0].toLowerCase();

        for (const template of PATTERN_TEMPLATES) {
            if (template.build(first, last) === localPart) {
                votes.set(template.id, (votes.get(template.id) ?? 0) + 1);
                break;
            }
        }
    }

    if (votes.size === 0) return { pattern: null, exampleCount: 0 };

    const [bestPattern, bestCount] = [...votes.entries()].sort((a, b) => b[1] - a[1])[0];
    return { pattern: bestPattern, exampleCount: bestCount };
}

function applyPattern(pattern: string, first: string, last: string, domain: string): string | null {
    const template = PATTERN_TEMPLATES.find(t => t.id === pattern);
    if (!template || !first || !last) return null;
    const localPart = template.build(first, last);
    if (!localPart) return null;
    return `${localPart}@${domain}`;
}

function normalizeNamePart(raw: string): string {
    return raw
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z\s]/g, " ")
        .trim();
}

async function fetchText(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<string | null> {
    let safeUrl: URL;
    try {
        safeUrl = await assertPublicHttpUrl(url);
    } catch {
        return null;
    }

    try {
        const res = await fetch(safeUrl.toString(), {
            headers: { "User-Agent": USER_AGENT },
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (!res.ok) return null;
        const contentLength = Number(res.headers.get("content-length") ?? 0);
        if (contentLength > 5_000_000) return null;
        return await res.text();
    } catch {
        return null;
    }
}
