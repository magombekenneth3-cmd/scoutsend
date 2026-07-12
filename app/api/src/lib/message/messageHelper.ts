export type ApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export type DeliveryState =
    | "DRAFT"
    | "QUEUED"
    | "SENT"
    | "DELIVERED"
    | "OPENED"
    | "REPLIED"
    | "BOUNCED"
    | "FAILED"
    | "SUPPRESSED"
    | "SPAM";

export interface Lead {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    companyName: string;
}

export interface DiffEntry {
    from: string;
    to: string;
}

export interface OutreachMessage {
    id: string;
    subject: string;
    body: string;
    originalSubject?: string;
    originalBody?: string;
    diffVector?: Record<string, DiffEntry> | null;
    approvalStatus: ApprovalStatus;
    deliveryState: DeliveryState;
    spamRiskScore?: number | null;
    personalizationScore?: number | null;
    lead: Lead;
    approvedBy?: { firstName: string; lastName: string } | null;
    sentAt?: string | null;
    createdAt: string;
}