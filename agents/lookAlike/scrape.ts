import { logger } from "@/app/api/src/lib/logger";
import { assertPublicHttpUrl } from "@/app/api/src/lib/url-safety";

const SCRAPE_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;
const SCRAPE_MAX_RETRIES = 3;
const SCRAPE_RETRY_BASE_MS = 1_000;
const SCRAPE_RETRY_JITTER_MS = 300;

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

async function fetchWithRetry(url: string): Promise<Response | null> {
  let lastErr: Error | null = null;

  for (let attempt = 1; attempt <= SCRAPE_MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: "manual",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; ScoutSend/1.0)" },
        signal: AbortSignal.timeout(SCRAPE_TIMEOUT_MS),
      });

      if (RETRYABLE_STATUSES.has(res.status)) {
        if (attempt < SCRAPE_MAX_RETRIES) {
          logger.warn({ url, status: res.status, attempt }, "[lookalike.scrape] Transient error — retrying");
          const delay = SCRAPE_RETRY_BASE_MS * 2 ** (attempt - 1) + Math.random() * SCRAPE_RETRY_JITTER_MS;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        logger.warn({ url, status: res.status }, "[lookalike.scrape] Non-OK after retries");
        return res;
      }

      return res;
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      if (attempt < SCRAPE_MAX_RETRIES) {
        logger.warn({ url, err: lastErr, attempt }, "[lookalike.scrape] Fetch error — retrying");
        const delay = SCRAPE_RETRY_BASE_MS * 2 ** (attempt - 1) + Math.random() * SCRAPE_RETRY_JITTER_MS;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
    }
  }

  logger.warn({ url, err: lastErr }, "[lookalike.scrape] Fetch failed after retries");
  return null;
}

export async function scrapeCompanyText(rawUrl: string): Promise<string> {
  const startedAt = Date.now();
  let current = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let safeUrl: URL;
    try {
      safeUrl = await assertPublicHttpUrl(current);
    } catch (err) {
      logger.warn({ url: current, err }, "[lookalike.scrape] URL safety check failed");
      return "";
    }

    const res = await fetchWithRetry(safeUrl.toString());
    if (!res) return "";

    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const location = res.headers.get("location");
      if (!location) {
        logger.warn({ url: current }, "[lookalike.scrape] Redirect with no Location header");
        return "";
      }
      current = new URL(location, safeUrl).toString();
      continue;
    }

    if (!res.ok) {
      logger.warn({ url: current, status: res.status }, "[lookalike.scrape] Non-OK response");
      return "";
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      logger.info({ url: current, contentType }, "[lookalike.scrape] Skipping non-HTML content-type");
      return "";
    }

    const rawHtml = await res.text();
    const html = rawHtml
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");

    const stripTags = (s: string) => s.replace(/<[^>]+>/g, " ");
    const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

    const metaDesc =
      html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i)?.[1] ?? "";
    const ogDesc =
      html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i)?.[1] ?? "";
    const h1s = [...html.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)]
      .map((m) => stripTags(m[1]))
      .join(" ");
    const h2s = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)]
      .map((m) => stripTags(m[1]))
      .slice(0, 5)
      .join(" ");
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? "";
    const bodyText = collapse(stripTags(bodyMatch)).slice(0, 3_000);

    const extracted = [metaDesc, ogDesc, h1s, h2s, bodyText]
      .filter(Boolean)
      .join("\n")
      .slice(0, 4_500);

    logger.info(
      {
        url: rawUrl,
        finalUrl: current,
        status: res.status,
        contentType,
        redirectCount: hop,
        extractedLength: extracted.length,
        durationMs: Date.now() - startedAt,
      },
      "[lookalike.scrape] Scrape complete",
    );

    return extracted;
  }

  logger.warn({ url: rawUrl }, "[lookalike.scrape] Too many redirects");
  return "";
}