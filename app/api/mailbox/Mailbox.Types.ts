import { DomainHealth } from "../src/lib/domains/domain.type";

export type MailProviderType = "GMAIL" | "OUTLOOK" | "SMTP";

export interface MailboxCampaign {
    id: string;
    name: string;
    status: string;
    dailySendLimit: number;
}

export interface SenderMailbox {
    id: string;
    label: string;
    emailAddress: string;
    providerType: MailProviderType;
    health: DomainHealth;
    dailyLimit: number;
    currentSent: number;
    totalSent: number;
    warmupEnabled: boolean;
    bounceRate: number;
    complaintRate: number;
    reputationScore: number;
    lastReplyCheckedAt: string | null;
    createdAt: string;
    updatedAt: string;
    _count: { campaigns: number };
}

export interface SenderMailboxDetail extends SenderMailbox {
    campaigns: MailboxCampaign[];
}

export interface MailboxesResponse {
    data: SenderMailbox[];
    meta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

// ── Credential payloads (write-only — never returned from API) ────────────

export interface SmtpCredentialPayload {
    type: "SMTP";
    smtpHost: string;
    smtpPort: number;
    secure: boolean;
    username: string;
    password: string;
    imapHost?: string;
    imapPort?: number;
}

export interface GmailCredentialPayload {
    type: "GMAIL";
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    emailAddress: string;
}

export interface OutlookCredentialPayload {
    type: "OUTLOOK";
    clientId: string;
    clientSecret: string;
    tenantId: string;
    refreshToken: string;
    emailAddress: string;
}

export type CredentialPayload =
    | SmtpCredentialPayload
    | GmailCredentialPayload
    | OutlookCredentialPayload;

export interface CreateMailboxPayload {
    label: string;
    emailAddress: string;
    credentials: CredentialPayload;
    dailyLimit?: number;
    warmupEnabled?: boolean;
}

export interface UpdateMailboxPayload {
    label?: string;
    dailyLimit?: number;
    warmupEnabled?: boolean;
    credentials?: CredentialPayload;
}