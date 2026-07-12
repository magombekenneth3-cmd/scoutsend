import axios from "axios";
import { HttpsProxyAgent } from "https-proxy-agent";
import { logger } from "./logger";
import { assertPublicHttpUrl } from "./url-safety";

const SCRAPE_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

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

export async function scrapeCompanyText(rawUrl: string): Promise<string> {
    let safeUrl: URL;
    try {
        safeUrl = await assertPublicHttpUrl(rawUrl);
    } catch (err) {
        logger.warn({ url: rawUrl, err }, "[scrape] URL safety check failed");
        return "";
    }

    let html: string;
    try {
        const res = await scrapeClient.get<string>(safeUrl.toString(), {
            responseType: "text",
        });
        html = res.data;
    } catch (err) {
        logger.warn({ url: safeUrl.toString(), err }, "[scrape] Fetch failed");
        return "";
    }

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

    return [metaDesc, ogDesc, h1s, h2s, bodyText]
        .filter(Boolean)
        .join("\n")
        .slice(0, 4_500);
}
