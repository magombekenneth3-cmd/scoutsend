import { logger } from "../logger";
import { PDLProvider } from "./pdl.provider";
import { ProxycurlProvider } from "./proxycurl.provider";
import { CrunchbaseProvider } from "./crunchbase.provider";
import {
  CompanyEnrichResult,
  PersonEnrichResult,
  ProviderMap,
  MergedCompanyResult,
  MergedPersonResult,
  EnrichmentProvider,
} from "./types";

export * from "./types";

const PROVIDERS: EnrichmentProvider[] = [];

export function registerProvider(p: EnrichmentProvider): void {
  PROVIDERS.push(p);
  PROVIDERS.sort((a, b) => a.priority - b.priority);
}

const COMPANY_FIELDS: (keyof Omit<CompanyEnrichResult, "source">)[] = [
  "name",
  "domain",
  "industry",
  "employeeCount",
  "foundedYear",
  "description",
  "linkedinUrl",
  "country",
  "techStack",
  "fundingTotalUsd",
];

const PERSON_FIELDS: (keyof Omit<PersonEnrichResult, "source">)[] = [
  "firstName",
  "lastName",
  "email",
  "title",
  "seniority",
  "department",
  "linkedinUrl",
  "phone",
];

function mergeInto<T extends object>(
  merged: Partial<T>,
  providerMap: ProviderMap,
  result: T & { source: string },
  fields: (keyof Omit<T, "source">)[]
): void {
  const now = new Date().toISOString();
  for (const field of fields) {
    const key = field as keyof T;
    if (merged[key] == null && result[key] != null) {
      merged[key] = result[key];
      providerMap[field as string] = {
        value: result[key],
        source: result.source,
        fetchedAt: now,
      };
    }
  }
}

function hasEssentialCompanyFields(merged: Partial<CompanyEnrichResult>): boolean {
  return (
    merged.name != null &&
    merged.domain != null &&
    merged.industry != null &&
    merged.employeeCount != null
  );
}

function hasEssentialPersonFields(merged: Partial<PersonEnrichResult>): boolean {
  return (
    merged.firstName != null &&
    merged.lastName != null &&
    merged.email != null &&
    merged.title != null
  );
}

export async function enrichCompanyWaterfall(
  domain: string
): Promise<MergedCompanyResult | null> {
  const merged: Partial<CompanyEnrichResult> = {};
  const providerMap: ProviderMap = {};

  for (const provider of PROVIDERS) {
    try {
      const result = await provider.enrichCompany(domain);
      if (!result) continue;
      logger.info({ provider: provider.name, domain }, "[enrichment-registry] company hit");
      mergeInto(merged, providerMap, result, COMPANY_FIELDS);
      if (hasEssentialCompanyFields(merged)) break;
    } catch (err) {
      logger.warn({ provider: provider.name, domain, err }, "[enrichment-registry] company failed");
    }
  }

  if (Object.keys(providerMap).length === 0) return null;
  return { ...merged, providerMap } as MergedCompanyResult;
}

export async function enrichPersonWaterfall(params: {
  email?: string;
  linkedinUrl?: string;
  firstName?: string;
  lastName?: string;
  domain?: string;
}): Promise<MergedPersonResult | null> {
  const merged: Partial<PersonEnrichResult> = {};
  const providerMap: ProviderMap = {};

  for (const provider of PROVIDERS) {
    try {
      const result = await provider.enrichPerson(params);
      if (!result) continue;
      logger.info({ provider: provider.name, params }, "[enrichment-registry] person hit");
      mergeInto(merged, providerMap, result, PERSON_FIELDS);
      if (hasEssentialPersonFields(merged)) break;
    } catch (err) {
      logger.warn({ provider: provider.name, params, err }, "[enrichment-registry] person failed");
    }
  }

  if (Object.keys(providerMap).length === 0) return null;
  return { ...merged, providerMap } as MergedPersonResult;
}

let _initialized = false;

export function initEnrichmentProviders(): void {
  if (_initialized) return;
  _initialized = true;
  registerProvider(new PDLProvider());
  registerProvider(new ProxycurlProvider());
  registerProvider(new CrunchbaseProvider());
}
