import { RepliesResponse, RepliesTab, Reply, TabCounts } from "../src/lib/reply/replyTypes";

export type ApiErrorKind =
    | "RATE_LIMITED"
    | "UNAUTHORIZED"
    | "FORBIDDEN"
    | "NOT_FOUND"
    | "SERVER_ERROR"
    | "UNAVAILABLE"
    | "NETWORK_ERROR";

export interface ApiError {
    kind: ApiErrorKind;
    status: number | null;
    retryAfterSeconds: number | null;
    userMessage: string;
}

function parseRetryAfter(headers: Headers): number | null {
    const raw = headers.get("retry-after");
    if (!raw) return null;
    const seconds = parseInt(raw, 10);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds, 300);
    const date = Date.parse(raw);
    if (Number.isFinite(date)) {
        const diff = Math.ceil((date - Date.now()) / 1000);
        return diff > 0 ? Math.min(diff, 300) : null;
    }
    return null;
}

function classifyResponse(status: number, headers: Headers): ApiError {
    switch (status) {
        case 401:
            return { kind: "UNAUTHORIZED", status, retryAfterSeconds: null, userMessage: "Session expired. Please sign in again." };
        case 403:
            return { kind: "FORBIDDEN", status, retryAfterSeconds: null, userMessage: "You don't have permission to view replies." };
        case 404:
            return { kind: "NOT_FOUND", status, retryAfterSeconds: null, userMessage: "Replies not found." };
        case 429: {
            const retryAfterSeconds = parseRetryAfter(headers) ?? 30;
            return { kind: "RATE_LIMITED", status, retryAfterSeconds, userMessage: "Replies are temporarily paused due to high activity." };
        }
        case 502:
        case 503:
        case 504:
            return { kind: "UNAVAILABLE", status, retryAfterSeconds: null, userMessage: "The server is temporarily unavailable." };
        default:
            return { kind: "SERVER_ERROR", status, retryAfterSeconds: null, userMessage: "Something went wrong. Please try again." };
    }
}

async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
    try {
        return await fetch(url, init);
    } catch {
        const err: ApiError = {
            kind: "NETWORK_ERROR",
            status: null,
            retryAfterSeconds: null,
            userMessage: "Unable to reach the server. Check your connection.",
        };
        throw err;
    }
}

export class ApiRequestError extends Error {
    readonly apiError: ApiError;
    constructor(apiError: ApiError) {
        super(apiError.userMessage);
        this.name = "ApiRequestError";
        this.apiError = apiError;
    }
}

export function buildRepliesQuery(tab: RepliesTab, page = 1, limit = 40): string {
    const params = new URLSearchParams();
    if (tab === "NEEDS_REVIEW") {
        params.set("requiresHumanReview", "true");
    } else if (tab !== "ALL") {
        params.set("intent", tab);
    }
    params.set("page", String(page));
    params.set("limit", String(limit));
    return params.toString();
}

export async function fetchReplies(tab: RepliesTab, page = 1, signal?: AbortSignal): Promise<RepliesResponse> {
    const res = await apiFetch(`/api/replies?${buildRepliesQuery(tab, page)}`, { signal });
    if (!res.ok) throw new ApiRequestError(classifyResponse(res.status, res.headers));
    return res.json();
}

export async function fetchTabCounts(signal?: AbortSignal): Promise<TabCounts> {
    const res = await apiFetch(`/api/replies/counts`, { signal });
    if (!res.ok) {
        return {};
    }
    return res.json();
}

export async function patchReply(
    id: string,
    body: Record<string, unknown>
): Promise<void> {
    await fetch(`/api/replies/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
}

export async function sendReplyDraft(
    id: string
): Promise<{ success: true; externalId: string | undefined }> {
    const res = await fetch(`/api/replies/${id}/send-draft`, { method: "POST" });
    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? "Failed to send draft. Please try again.");
    }
    return res.json();
}

export function isApiRequestError(e: unknown): e is ApiRequestError {
    return e instanceof ApiRequestError;
}