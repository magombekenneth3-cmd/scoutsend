import { ApiKeyVault } from "./key-manager";
import { logger } from "./logger";

const SERPER_RESULTS = 10;
const SERPER_TIMEOUT_MS = 12_000;
const FATAL_STATUS = new Set([429, 401, 402, 403]);

export interface SerperResult {
    title: string;
    link: string;
    snippet: string;
}

const serperVault = new ApiKeyVault("serper", "SERPER_API_KEYS");

export async function serperSearch(
    query: string,
    type: "search" | "news" = "search",
): Promise<SerperResult[]> {
    const endpoint =
        type === "news"
            ? "https://google.serper.dev/news"
            : "https://google.serper.dev/search";

    for (let attempt = 0; attempt < 4; attempt++) {
        let key: string;
        try {
            key = await serperVault.acquireKey();
        } catch {
            logger.error({ query }, "[serper] All keys exhausted — giving up");
            return [];
        }

        let res: Response;
        try {
            res = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "X-API-KEY": key,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ q: query, num: SERPER_RESULTS }),
                signal: AbortSignal.timeout(SERPER_TIMEOUT_MS),
            });
        } catch (err) {
            logger.warn({ err, query }, "[serper] Network error");
            return [];
        }

        if (FATAL_STATUS.has(res.status)) {
            await serperVault.reportFailure(key, res.status);
            continue;
        }

        if (!res.ok) return [];

        const data = (await res.json()) as {
            organic?: SerperResult[];
            news?: SerperResult[];
        };
        return (type === "news" ? data.news : data.organic) ?? [];
    }

    return [];
}