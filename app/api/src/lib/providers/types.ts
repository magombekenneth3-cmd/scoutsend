export interface CompanyEnrichResult {
  name?: string;
  domain?: string;
  industry?: string;
  employeeCount?: number;
  foundedYear?: number;
  description?: string;
  linkedinUrl?: string;
  country?: string;
  techStack?: string[];
  fundingTotalUsd?: number;
  source: string;
}

export interface PersonEnrichResult {
  firstName?: string;
  lastName?: string;
  email?: string;
  title?: string;
  seniority?: string;
  department?: string;
  linkedinUrl?: string;
  phone?: string;
  source: string;
}

export interface ProviderMapEntry {
  value: unknown;
  source: string;
  fetchedAt: string;
}

export type ProviderMap = Record<string, ProviderMapEntry>;

export interface MergedCompanyResult extends Partial<CompanyEnrichResult> {
  providerMap: ProviderMap;
}

export interface MergedPersonResult extends Partial<PersonEnrichResult> {
  providerMap: ProviderMap;
}

export interface EnrichmentProvider {
  readonly name: string;
  readonly priority: number;
  enrichCompany(domain: string): Promise<CompanyEnrichResult | null>;
  enrichPerson(params: {
    email?: string;
    linkedinUrl?: string;
    firstName?: string;
    lastName?: string;
    domain?: string;
  }): Promise<PersonEnrichResult | null>;
}
