import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { logger } from "./logger";
import { assertPublicHttpUrl } from "./url-safety";

const SCRAPE_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const PER_PAGE_CHAR_BUDGET = 4_800;
const TOTAL_CHAR_BUDGET = 6_000;
const SUBPAGE_CONCURRENCY = 4;

export interface ScrapedPage {
    url: string;
    text: string;
}

const BLOCK_TAGS = /\s*<(script|style|svg|noscript|iframe|nav|footer|header|aside|form)[^>]*>[\s\S]*?<\/\1>/gi;
const COMMENT_RE = /<!--[\s\S]*?-->/g;
const DATA_ATTR_RE = /\s+data-[a-z][a-z0-9-]*(?:="[^"]*"|='[^']*'|=[^\s>]*)?/gi;
const EVENT_ATTR_RE = /\s+on[a-z]+(?:="[^"]*"|='[^']*'|=[^\s>]*)?/gi;
const TAGS_RE = /<[^>]+>/g;

const BOILERPLATE_PATTERNS: RegExp[] = [
    /\bcookies?.*\b(experience|analytics|track|consent|preferences|accept)\b/i,
    /\b(accept|manage|decline)\b.*\bcookies?\b/i,
    /\bprivacy\s*(policy|notice|statement|settings)\b/i,
    /\bterms\s*(of\s*)?(service|use|conditions)\b/i,
    /\ball\s*rights?\s*reserved\b/i,
    /\bcopyright\s*©?\s*\d{4}/i,
    /\b(unsubscribe|opt.?out)\b.*\bemail\b/i,
    /\b(gdpr|ccpa)\b/i,
    /^(home|about|services?|products?|contact|menu|navigation|search|cart|shop)\s*$/i,
    /\b(follow\s*us|share\s*on|twitter|linkedin|facebook|instagram|youtube)\b/i,
    /\bskip\s*(to\s*)?(main\s*)?content\b/i,
];

const proxyAgent = process.env.PROXY_URL
    ? new HttpsProxyAgent(process.env.PROXY_URL)
    : undefined;

const scrapeClient = axios.create({
    timeout: SCRAPE_TIMEOUT_MS,
    maxRedirects: MAX_REDIRECTS,
    headers: {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
    },
    ...(proxyAgent && { httpsAgent: proxyAgent, httpAgent: proxyAgent }),
    validateStatus: (status) => status < 400,
});

function cleanHtml(html: string): string {
    return html
        .replace(BLOCK_TAGS, " ")
        .replace(COMMENT_RE, " ")
        .replace(DATA_ATTR_RE, "")
        .replace(EVENT_ATTR_RE, "");
}

function extractTagContent(html: string, tag: string, limit?: number): string[] {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
    const results: string[] = [];
    for (const m of html.matchAll(re)) {
        const text = m[1].replace(TAGS_RE, " ").replace(/\s+/g, " ").trim();
        if (text) results.push(text);
        if (limit && results.length >= limit) break;
    }
    return results;
}

function extractAttr(html: string, selector: RegExp): string {
    const m = html.match(selector);
    return m?.[1] ?? "";
}

function deduplicateLines(text: string): string {
    const seen = new Set<string>();
    return text
        .split(/\n+/)
        .filter((line) => {
            const norm = line.trim().toLowerCase();
            if (norm.length < 8) return false;
            if (seen.has(norm)) return false;
            seen.add(norm);
            return true;
        })
        .join("\n");
}

function stripBoilerplate(text: string): string {
    return text
        .split(/(?<=[.!?])\s+/)
        .filter((sentence) => !BOILERPLATE_PATTERNS.some((p) => p.test(sentence)))
        .join(" ");
}

function htmlToText(html: string): string {
    return html
        .replace(TAGS_RE, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, " ")
        .trim();
}

function extractStructuredText(html: string): string {
    const clean = cleanHtml(html);

    const metaDesc = extractAttr(clean, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i);
    const ogDesc = extractAttr(clean, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i);
    const h1s = extractTagContent(clean, "h1", 2).map(htmlToText).join(" ");
    const h2s = extractTagContent(clean, "h2", 6).map(htmlToText).join(" ");
    const h3s = extractTagContent(clean, "h3", 6).map(htmlToText).join(" ");

    const mainMatch = clean.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1] ?? "";
    const articleMatch = clean.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1] ?? "";
    const sectionMatch = [...clean.matchAll(/<section[^>]*>([\s\S]*?)<\/section>/gi)]
        .map((m) => m[1])
        .slice(0, 4)
        .join(" ");

    const bodyPriority = mainMatch || articleMatch || sectionMatch ||
        (clean.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? "");

    const bodyText = stripBoilerplate(htmlToText(bodyPriority)).slice(0, 3_200);

    const combined = deduplicateLines(
        [metaDesc, ogDesc, h1s, h2s, h3s, bodyText]
            .filter(Boolean)
            .join("\n")
    );

    return combined.slice(0, PER_PAGE_CHAR_BUDGET);
}

async function fetchAndExtract(url: URL): Promise<string> {
    const res = await scrapeClient.get<string>(url.toString(), { responseType: "text" });
    return extractStructuredText(res.data);
}

export async function scrapeCompanyText(rawUrl: string): Promise<string> {
    let safeUrl: URL;
    try {
        safeUrl = await assertPublicHttpUrl(rawUrl);
    } catch (err) {
        logger.warn({ url: rawUrl, err }, "[scrape] URL safety check failed");
        return "";
    }

    try {
        return await fetchAndExtract(safeUrl);
    } catch (err) {
        logger.warn({ url: safeUrl.toString(), err }, "[scrape] Fetch failed");
        return "";
    }
}

const SUBPATHS = ["/about", "/product", "/products", "/solutions", "/pricing", "/careers"];

export async function scrapeSubpages(rawBaseUrl: string): Promise<ScrapedPage[]> {
    let base: URL;
    try {
        base = await assertPublicHttpUrl(rawBaseUrl);
    } catch {
        return [];
    }

    const homepageText = await scrapeCompanyText(rawBaseUrl);
    const pages: ScrapedPage[] = [{ url: base.toString(), text: homepageText }];

    let remaining = TOTAL_CHAR_BUDGET - homepageText.length;
    if (remaining <= 0) return pages;

    const subpageUrls = SUBPATHS.map((p) => {
        try {
            return new URL(p, base).toString();
        } catch {
            return null;
        }
    }).filter((u): u is string => u !== null);

    const queue = [...subpageUrls];
    const inFlight: Promise<void>[] = [];

    async function processOne(rawUrl: string): Promise<void> {
        let safeUrl: URL;
        try {
            safeUrl = await assertPublicHttpUrl(rawUrl);
        } catch {
            return;
        }

        try {
            const text = await fetchAndExtract(safeUrl);
            if (!text) return;

            const budget = Math.min(text.length, remaining, PER_PAGE_CHAR_BUDGET);
            if (budget <= 0) return;

            const trimmed = text.slice(0, budget);
            remaining -= trimmed.length;
            pages.push({ url: rawUrl, text: trimmed });
        } catch {
            /* silently skip failed subpages */
        }
    }

    while (queue.length > 0 && remaining > 0) {
        const batch = queue.splice(0, SUBPAGE_CONCURRENCY);
        await Promise.all(batch.map(processOne));
    }

    return pages;
}
