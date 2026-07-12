import { CreateDomainPayload, DnsVerifyResult, DomainsResponse, SenderDomainDetail, UpdateDomainPayload } from "./domain.type";

export async function fetchDomains(
    page = 1,
    limit = 20,
    health?: string
): Promise<DomainsResponse> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (health) params.set("health", health);
    const res = await fetch(`/api/sender-domains?${params}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw Object.assign(new Error(err?.error ?? `Server error ${res.status}`), { status: res.status });
    }
    return res.json();
}

export async function fetchDomainById(id: string): Promise<SenderDomainDetail> {
    const res = await fetch(`/api/sender-domains/${id}`);
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw Object.assign(new Error(err?.error ?? `Server error ${res.status}`), { status: res.status });
    }
    return res.json();
}

export async function createDomain(payload: CreateDomainPayload): Promise<SenderDomainDetail> {
    const res = await fetch(`/api/sender-domains`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? "Failed to create domain");
    return data;
}

export async function updateDomain(
    id: string,
    payload: UpdateDomainPayload
): Promise<SenderDomainDetail> {
    const res = await fetch(`/api/sender-domains/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? "Failed to update domain");
    return data;
}

export async function deleteDomain(id: string): Promise<void> {
    const res = await fetch(`/api/sender-domains/${id}`, { method: "DELETE" });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to delete domain");
    }
}

export async function resetDailyCount(id: string): Promise<SenderDomainDetail> {
    const res = await fetch(`/api/sender-domains/${id}/reset-daily-count`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? "Failed to reset count");
    return data;
}

export async function verifyDomainDns(id: string): Promise<DnsVerifyResult> {
    const res = await fetch(`/api/sender-domains/${id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error ?? "DNS verification failed");
    return data;
}