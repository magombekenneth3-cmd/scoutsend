import { PrismaClient } from "@prisma/client";

export type PrismaTx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

export type DiscoverySignalType =
    | "FUNDING_SIGNAL"
    | "HIRING_SIGNAL"
    | "GROWTH_SIGNAL"
    | "INTENT_SIGNAL"
    | "TECH_SIGNAL";

export interface ApolloPersonResult {
    id: string;
    first_name: string | null;
    last_name: string | null;
    title: string | null;
    email: string | null;
    organization_name: string | null;
    organization: {
        website_url: string | null;
        linkedin_url: string | null;
        primary_domain: string | null;
    } | null;
    linkedin_url: string | null;
}

export type ApolloPageResult =
    | { ok: true; page: number; people: ApolloPersonResult[] }
    | { ok: false; page: number; error: unknown };

export interface BuiltWithTech {
    Name: string;
    Tag: string;
}

export interface DiscoveredLead {
    companyName: string;
    website?: string;
    linkedinUrl?: string;
    firstName?: string;
    lastName?: string;
    title?: string;
    email?: string;
    externalId?: string;
    signalType: DiscoverySignalType;
    signalValue: string;
    rawConfidence: number;
    sourceWeight: number;
    weightedScore: number;
    explanation: string;
    source: string;
}

export interface AtsQueryIngredients {
    roleTitles: string[];
    techTerms: string[];
    departmentTerms: string[];
}

export interface DiscoveryCheckpoint {
    processedLeadKeys: string[];
    createdLeadIds: string[];
    existingCampaignDomains: string[];
    existingEmails: string[];
    created: number;
    skipped: number;
    failed: number;
    signalsProcessed: number;
    savedAt: string;
}

export interface DiscoveryRunState {
    created: number;
    skipped: number;
    failed: number;
    signalsProcessed: number;
    companyDomainMap: Map<string, string>;
    createdLeadIds: string[];
    processedCompanyIds: Set<string>;
    discoveredSignalsByLeadId: Map<string, {
        signalType: string;
        rawConfidence: number;
        sourceWeight: number;
        source: string;
    }>;
    existingCampaignDomains: Set<string>;
    existingCampaignEmails: Set<string>;
    resumedProcessedKeys: Set<string>;
}

export type LeadInsertOutcome =
    | { status: "created"; companyId: string; leadId: string; signalIsNew: boolean; domain: string | null; lead: DiscoveredLead }
    | { status: "skipped"; companyId: string; signalIsNew: boolean }
    | { status: "failed"; companyName: string; error: unknown };