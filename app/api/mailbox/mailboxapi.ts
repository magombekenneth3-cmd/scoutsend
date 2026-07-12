import { CreateMailboxPayload, MailboxesResponse, SenderMailboxDetail, UpdateMailboxPayload } from "./Mailbox.Types";


async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw Object.assign(
            new Error((data as { error?: string }).error ?? `Server error ${res.status}`),
            { status: res.status }
        );
    }
    return data as T;
}

export async function fetchMailboxes(
    page = 1,
    limit = 20,
    filters?: { providerType?: string; health?: string }
): Promise<MailboxesResponse> {
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (filters?.providerType) params.set("providerType", filters.providerType);
    if (filters?.health) params.set("health", filters.health);
    return apiFetch<MailboxesResponse>(`/api/sender-mailboxes?${params}`);
}

export async function fetchMailboxById(id: string): Promise<SenderMailboxDetail> {
    return apiFetch<SenderMailboxDetail>(`/api/sender-mailboxes/${id}`);
}

export async function createMailbox(
    payload: CreateMailboxPayload
): Promise<SenderMailboxDetail> {
    return apiFetch<SenderMailboxDetail>("/api/sender-mailboxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
}

export async function updateMailbox(
    id: string,
    payload: UpdateMailboxPayload
): Promise<SenderMailboxDetail> {
    return apiFetch<SenderMailboxDetail>(`/api/sender-mailboxes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
}

export async function deleteMailbox(id: string): Promise<void> {
    const res = await fetch(`/api/sender-mailboxes/${id}`, { method: "DELETE" });
    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to delete mailbox");
    }
}

export async function verifyMailbox(id: string): Promise<{ connected: boolean }> {
    return apiFetch<{ connected: boolean }>(`/api/sender-mailboxes/${id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
    });
}

export async function resetMailboxDailyCount(id: string): Promise<SenderMailboxDetail> {
    return apiFetch<SenderMailboxDetail>(`/api/sender-mailboxes/${id}/reset-daily-count`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
    });
}