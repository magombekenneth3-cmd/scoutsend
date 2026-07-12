import { RepliesResponse, RepliesTab } from "../src/lib/reply/replyTypes";



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

export async function fetchReplies(tab: RepliesTab, page = 1): Promise<RepliesResponse> {
    const res = await fetch(`/api/replies?${buildRepliesQuery(tab, page)}`);
    if (!res.ok) throw new Error(`Server error ${res.status}`);
    return res.json();
}

export async function fetchTabCount(tab: RepliesTab): Promise<number> {
    const res = await fetch(`/api/replies?${buildRepliesQuery(tab, 1, 1)}`);
    if (!res.ok) return 0;
    const json = await res.json();
    return json.meta?.total ?? 0;
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
        throw new Error(body?.message ?? `Server error ${res.status}`);
    }
    return res.json();
}