import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getClientIp } from "./users/utils";

export const API_BASE = process.env.INTERNAL_API_URL ?? "http://localhost:8080";

const TIMEOUT_MS = 15_000;
const RETRY_DELAY_MS = 300;

const RATE_LIMIT_HEADERS = [
    "retry-after",
    "x-ratelimit-limit",
    "x-ratelimit-remaining",
    "x-ratelimit-reset",
] as const;

export async function getToken(): Promise<string | undefined> {
    const store = await cookies();
    return store.get("token")?.value;
}

async function doFetch(upstreamUrl: string, init: RequestInit, token?: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const clientIp = await getClientIp();
    try {
        return await fetch(upstreamUrl, {
            ...init,
            signal: controller.signal,
            headers: {
                "X-Requested-With": "XMLHttpRequest",
                ...(init?.body != null ? { "Content-Type": "application/json" } : {}),
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                ...(clientIp ? { "X-Forwarded-For": clientIp } : {}),
                ...(init?.headers ?? {}),
            },
            cache: "no-store",
        });
    } finally {
        clearTimeout(timer);
    }
}

function isRetryable(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    if (error.name === "AbortError") return false;
    const code = (error as NodeJS.ErrnoException).code;
    return (
        code === "ECONNRESET" ||
        code === "ECONNREFUSED" ||
        code === "EPIPE" ||
        error.message.includes("fetch failed") ||
        error.message.includes("ECONNRESET")
    );
}

function pickRateLimitHeaders(upstreamRes: Response): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of RATE_LIMIT_HEADERS) {
        const val = upstreamRes.headers.get(key);
        if (val !== null) out[key] = val;
    }
    return out;
}

export async function proxyRequest(
    upstreamUrl: string,
    init?: RequestInit
): Promise<NextResponse> {
    const token = await getToken();
    const reqInit: RequestInit = init ?? {};
    const method = (reqInit.method ?? "GET").toUpperCase();
    const isSafeMethod = method === "GET" || method === "HEAD" || method === "OPTIONS";
    const maxAttempts = isSafeMethod ? 2 : 1;

    let lastError: unknown;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0) {
            await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
        try {
            const res = await doFetch(upstreamUrl, reqInit, token);
            const rlHeaders = pickRateLimitHeaders(res);

            if (res.status === 204) return new NextResponse(null, { status: 204, headers: rlHeaders });

            const contentType = res.headers.get("content-type") || "";
            if (contentType.includes("application/json")) {
                const data = await res.json();
                return NextResponse.json(data, { status: res.status, headers: rlHeaders });
            }

            const text = await res.text();
            return NextResponse.json(
                { error: text || `Upstream returned ${res.status}` },
                { status: res.status, headers: rlHeaders }
            );
        } catch (error) {
            lastError = error;
            const isAbort = error instanceof Error && error.name === "AbortError";
            if (isAbort || !isRetryable(error)) {
                return NextResponse.json(
                    { error: isAbort ? "Upstream request timed out" : "Failed to reach API server" },
                    { status: isAbort ? 504 : 502 }
                );
            }
        }
    }

    void lastError;
    return NextResponse.json(
        { error: "Failed to reach API server after retry" },
        { status: 502 }
    );
}