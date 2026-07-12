export interface Suppression {
    id: string;
    email: string | null;
    domain: string | null;
    reason: string;
    source: string | null;
    createdAt: string;
}

export interface SuppressionMeta {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface SuppressionListResponse {
    data: Suppression[];
    meta: SuppressionMeta;
}

export interface SuppressionStats {
    total: number;
    emailCount: number;
    domainCount: number;
}

export interface CheckResult {
    suppressed: boolean;
    reason: string | null;
    matchedOn: "email" | "domain" | "email_domain" | null;
}

export type FilterType = "all" | "email" | "domain";