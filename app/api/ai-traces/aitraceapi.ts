import type {
    AITracesResponse,
    AITraceDetail,
    AITraceStats,
    TraceFilters,
} from "./types";

export function buildQuery(filters: Partial<TraceFilters>): string {
    const p = new URLSearchParams();

    if (filters.agentName) p.set("agentName", filters.agentName);
    if (filters.model) p.set("model", filters.model);
    if (filters.minConfidence != null) p.set("minConfidence", String(filters.minConfidence));
    if (filters.maxConfidence != null) p.set("maxConfidence", String(filters.maxConfidence));
    if (filters.from) p.set("from", filters.from);
    if (filters.to) p.set("to", filters.to);
    p.set("page", String(filters.page ?? 1));
    p.set("limit", String(filters.limit ?? 20));

    return p.toString();
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
        const headers = new Headers(options?.headers);

        if (options?.body) {
            headers.set("Content-Type", "application/json");
        }

        const res = await fetch(`/api${path}`, {
            cache: "no-store",
            ...options,
            headers,
            signal: controller.signal,
        });

        if (!res.ok) {
            let message = `Server error ${res.status}`;

            try {
                const body = await res.json();
                message = body?.error ?? body?.message ?? message;
            } catch { }

            throw Object.assign(new Error(message), { status: res.status });
        }

        if (res.status === 204) {
            return undefined as T;
        }

        return res.json() as Promise<T>;
    } finally {
        clearTimeout(timeout);
    }
}

export async function fetchTraces(
    filters: Partial<TraceFilters>,
): Promise<AITracesResponse> {
    return request(`/ai-traces?${buildQuery(filters)}`);
}

export async function fetchTraceById(id: string): Promise<AITraceDetail> {
    return request(`/ai-traces/${encodeURIComponent(id)}`);
}

export async function fetchTraceStats(): Promise<AITraceStats> {
    return request("/ai-traces/stats");
}

export async function deleteTrace(id: string): Promise<void> {
    return request(`/ai-traces/${encodeURIComponent(id)}`, { method: "DELETE" });
}