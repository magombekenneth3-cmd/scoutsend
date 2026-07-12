export type LearningEventType =
    | "REVIEW_FLAGGED"
    | "HUMAN_EDITED"
    | "HUMAN_APPROVED"
    | "HUMAN_REJECTED"
    | "AUTO_APPROVED";

export type LearningOutcome =
    | "PENDING_REVIEW"
    | "APPROVED"
    | "REJECTED"
    | "EDITED_AND_APPROVED"
    | "DISMISSED";

export interface DiffVector {
    subject?: { from: string; to: string };
    body?: { from: string; to: string };
}

export interface LearningEventMetadata {
    spamRiskScore?: number;
    personalizationScore?: number;
    failedThresholds?: { spamRisk: boolean; personalization: boolean };
    reviewerNote?: string;
    dismissReason?: string;
    resolvedAt?: string;
    resolvedBy?: string;
    wasEdited?: boolean;
    dismissedAt?: string;
    dismissedBy?: string;
    [key: string]: unknown;
}

export interface OutreachMessageSnippet {
    id: string;
    subject: string;
    spamRiskScore: number | null;
    personalizationScore: number | null;
    approvalStatus: string;
    lead: {
        firstName: string;
        lastName: string;
        companyName: string;
        email: string;
    };
}

export interface LearningEvent {
    id: string;
    eventType: LearningEventType;
    outcome: LearningOutcome | null;
    outreachMessageId: string | null;
    metadata: LearningEventMetadata | null;
    diffVector: DiffVector | null;
    createdAt: string;
    outreachMessage?: OutreachMessageSnippet | null;
}

export interface LearningEventDetail extends LearningEvent {
    originalOutput: string;
    modifiedOutput?: string;
    outreachMessage: {
        id: string;
        subject: string;
        body: string;
        originalSubject: string | null;
        originalBody: string | null;
        spamRiskScore: number | null;
        personalizationScore: number | null;
        approvalStatus: string;
        deliveryState: string;
        lead: {
            id: string;
            firstName: string;
            lastName: string;
            companyName: string;
            email: string;
            title: string | null;
            qualificationScore: number | null;
        };
    } | null;
}

export interface LearningEventsResponse {
    data: LearningEvent[];
    meta: { total: number; page: number; limit: number; totalPages: number };
}

export interface LearningEventStats {
    totals: {
        total: number;
        pending: number;
        resolved: number;
        editRate: string;
    };
    byEventType: { eventType: string; _count: { id: number } }[];
    byOutcome: { outcome: string; _count: { id: number } }[];
    recentResolved: {
        id: string;
        eventType: string;
        outcome: string;
        outreachMessageId: string | null;
        createdAt: string;
    }[];
}

export interface GetLearningEventsParams {
    eventType?: LearningEventType;
    outcome?: LearningOutcome;
    outreachMessageId?: string;
    pendingOnly?: boolean;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`/api${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options?.headers ?? {}),
        },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? `Request failed: ${res.status}`);
    }
    return res.json() as Promise<T>;
}

export const learningApi = {
    getStats(): Promise<LearningEventStats> {
        return request("/learning/stats");
    },

    getEvents(params: GetLearningEventsParams = {}): Promise<LearningEventsResponse> {
        const qs = new URLSearchParams();
        if (params.eventType) qs.set("eventType", params.eventType);
        if (params.outcome) qs.set("outcome", params.outcome);
        if (params.outreachMessageId) qs.set("outreachMessageId", params.outreachMessageId);
        if (params.pendingOnly != null) qs.set("pendingOnly", String(params.pendingOnly));
        if (params.from) qs.set("from", params.from);
        if (params.to) qs.set("to", params.to);
        if (params.page) qs.set("page", String(params.page));
        if (params.limit) qs.set("limit", String(params.limit));
        const q = qs.toString();
        return request(`/learning${q ? `?${q}` : ""}`);
    },

    getEventById(id: string): Promise<LearningEventDetail> {
        return request(`/learning/${id}`);
    },

    resolve(
        id: string,
        data: { subject?: string; body?: string; reviewerNote?: string }
    ): Promise<{ message: unknown; learningEvent: LearningEvent }> {
        return request(`/learning/${id}/resolve`, {
            method: "POST",
            body: JSON.stringify(data),
        });
    },

    dismiss(
        id: string,
        data: { reason: string }
    ): Promise<{ message: unknown; learningEvent: LearningEvent }> {
        return request(`/learning/${id}/dismiss`, {
            method: "POST",
            body: JSON.stringify(data),
        });
    },
};