import { ApiKeyVault } from "./key-manager";
import { logger } from "./logger";

const SERPER_RESULTS = 10;
const SERPER_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 400;
const RETRY_MAX_DELAY_MS = 4_000;

const FATAL_STATUS = new Set([429, 401, 402, 403]);
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface SerperResult {
    title: string;
    link: string;
    snippet: string;
}

export interface SerperEnvelope {
    organic?: SerperResult[];
    news?: SerperResult[];
    answerBox?: {
        snippet?: string;
    };
    knowledgeGraph?: {
        description?: string;
    };
}

const serperVault = new ApiKeyVault("serper", "SERPER_API_KEYS");

function getEndpoint(type: "search" | "news"): string {
    return type === "news"
        ? "https://google.serper.dev/news"
        : "https://google.serper.dev/search";
}

function getRetryDelay(attempt: number): number {
    const exponential = Math.min(
        RETRY_BASE_DELAY_MS * 2 ** attempt,
        RETRY_MAX_DELAY_MS,
    );

    return Math.floor(exponential * (0.75 + Math.random() * 0.5));
}

function isValidResult(value: unknown): value is SerperResult {
    if (!value || typeof value !== "object") return false;

    const result = value as Record<string, unknown>;

    return (
        typeof result.title === "string" &&
        typeof result.link === "string" &&
        typeof result.snippet === "string"
    );
}

function parseSerperEnvelope(value: unknown): SerperEnvelope {
    if (!value || typeof value !== "object") {
        throw new Error("[serper] Invalid response payload");
    }

    const data = value as Record<string, unknown>;

    const organic = Array.isArray(data.organic)
        ? data.organic.filter(isValidResult)
        : undefined;

    const news = Array.isArray(data.news)
        ? data.news.filter(isValidResult)
        : undefined;

    const rawAnswerBoxSnippet =
        data.answerBox && typeof data.answerBox === "object"
            ? (data.answerBox as Record<string, unknown>).snippet
            : undefined;

    const answerBox =
        typeof rawAnswerBoxSnippet === "string"
            ? { snippet: rawAnswerBoxSnippet }
            : undefined;

    const rawKgDescription =
        data.knowledgeGraph && typeof data.knowledgeGraph === "object"
            ? (data.knowledgeGraph as Record<string, unknown>).description
            : undefined;

    const knowledgeGraph =
        typeof rawKgDescription === "string"
            ? { description: rawKgDescription }
            : undefined;

    return {
        organic,
        news,
        answerBox,
        knowledgeGraph,
    };
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function performSerperRequest(
    query: string,
    type: "search" | "news",
    numResults: number,
): Promise<SerperEnvelope> {
    const endpoint = getEndpoint(type);
    const normalizedQuery = query.trim();
    const normalizedNumResults = Math.max(
        1,
        Math.min(Math.floor(numResults), 100),
    );

    if (!normalizedQuery) {
        throw new Error("[serper] Query cannot be empty");
    }

    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        let key: string;

        try {
            key = await serperVault.acquireKey();
        } catch (err) {
            logger.error(
                { err, query: normalizedQuery, attempt },
                "[serper] All keys exhausted",
            );
            throw err;
        }

        let response: Response;

        try {
            response = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "X-API-KEY": key,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    q: normalizedQuery,
                    num: normalizedNumResults,
                }),
                signal: AbortSignal.timeout(SERPER_TIMEOUT_MS),
            });
        } catch (err) {
            lastError = err;

            logger.warn(
                {
                    err,
                    query: normalizedQuery,
                    attempt: attempt + 1,
                    maxAttempts: MAX_ATTEMPTS,
                },
                "[serper] Network error",
            );

            if (attempt + 1 < MAX_ATTEMPTS) {
                await sleep(getRetryDelay(attempt));
            }

            continue;
        }

        if (FATAL_STATUS.has(response.status)) {
            await serperVault.reportFailure(key, response.status);

            lastError = new Error(
                `[serper] HTTP ${response.status}`,
            );

            if (attempt + 1 < MAX_ATTEMPTS) {
                await sleep(getRetryDelay(attempt));
            }

            continue;
        }

        if (!response.ok) {
            lastError = new Error(
                `[serper] HTTP ${response.status}`,
            );

            logger.warn(
                {
                    status: response.status,
                    query: normalizedQuery,
                    attempt: attempt + 1,
                    maxAttempts: MAX_ATTEMPTS,
                },
                "[serper] Non-OK response",
            );

            if (
                RETRYABLE_STATUS.has(response.status) &&
                attempt + 1 < MAX_ATTEMPTS
            ) {
                await sleep(getRetryDelay(attempt));
                continue;
            }

            break;
        }

        try {
            const payload: unknown = await response.json();
            return parseSerperEnvelope(payload);
        } catch (err) {
            lastError = err;

            logger.warn(
                {
                    err,
                    query: normalizedQuery,
                    attempt: attempt + 1,
                    maxAttempts: MAX_ATTEMPTS,
                },
                "[serper] Invalid response payload",
            );

            if (attempt + 1 < MAX_ATTEMPTS) {
                await sleep(getRetryDelay(attempt));
            }
        }
    }

    throw (
        lastError ??
        new Error("[serper] Exhausted retries")
    );
}

export async function serperSearch(
    query: string,
    type: "search" | "news" = "search",
    numResults: number = SERPER_RESULTS,
): Promise<SerperResult[]> {
    const data = await performSerperRequest(
        query,
        type,
        numResults,
    );

    return (type === "news" ? data.news : data.organic) ?? [];
}

export async function serperSearchFull(
    query: string,
    numResults: number = SERPER_RESULTS,
): Promise<SerperEnvelope> {
    return performSerperRequest(
        query,
        "search",
        numResults,
    );
}