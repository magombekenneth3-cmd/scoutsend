export type DomainHealth = "HEALTHY" | "WARNING" | "DEGRADED" | "BLOCKED";

export interface DeliverabilityEvent {
    id: string;
    type: string;
    severity: string;
    metadata: Record<string, unknown> | null;
    createdAt: string;
}

export interface DomainCampaign {
    id: string;
    name: string;
    status: string;
    dailySendLimit: number;
}

export interface SenderDomain {
    id: string;
    domain: string;
    health: DomainHealth;
    dailyLimit: number;
    currentSent: number;
    totalSent: number;
    reputationScore: number;
    bounceRate: number;
    complaintRate: number;
    warmupEnabled: boolean;
    spfValid: boolean | null;
    dkimValid: boolean | null;
    dmarcValid: boolean | null;
    dkimSelector: string | null;
    dkimPublicKey: string | null;
    dnsCheckedAt: string | null;
    createdAt: string;
    updatedAt: string;
    _count: { campaigns: number };
}

export interface SenderDomainDetail extends SenderDomain {
    campaigns: DomainCampaign[];
    deliverabilityEvents: DeliverabilityEvent[];
}

export interface DomainsResponse {
    data: SenderDomain[];
    meta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

export interface CreateDomainPayload {
    domain: string;
    dailyLimit?: number;
    warmupEnabled?: boolean;
}

export interface UpdateDomainPayload {
    dailyLimit?: number;
    warmupEnabled?: boolean;
    health?: DomainHealth;
    reputationScore?: number;
    bounceRate?: number;
    complaintRate?: number;
}


export interface DnsVerifyResult {
    spfValid: boolean;
    dkimValid: boolean;
    dmarcValid: boolean;
    dnsCheckedAt: string;
}