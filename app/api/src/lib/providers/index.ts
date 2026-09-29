import { logger } from "../logger";
import { ApolloProvider } from "./apollo.provider";
import { PDLProvider } from "./pdl.provider";
import { HunterProvider } from "./hunter.provider";
import { CrunchbaseProvider } from "./crunchbase.provider";
import { PatternProvider } from "./pattern.provider";
import { ApifyLinkedInProvider } from "./apify-linkedin.provider";
import { ProxycurlProvider } from "./proxycurl.provider";
import {
  CompanyEnrichResult,
  PersonEnrichResult,
  ProviderMap,
  MergedCompanyResult,
  MergedPersonResult,
  EnrichmentProvider,
} from "./types";

export * from "./types";
export * from "./apify-linkedin.provider";

export type ProviderFailureReason =
  | "no_key"
  | "rate_limited"
  | "provider_error"
  | "empty"
  | "malformed"
  | "timeout";

export interface ProviderAttemptLog {
  provider: string;
  status: "success" | ProviderFailureReason;
  durationMs: number;
  fieldsAdded: number;
  failureReason?: string;
}

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

function classifyError(err: unknown): ProviderFailureReason {
  if (!err || typeof err !== "object") return "provider_error";
  const e = err as Record<string, unknown>;
  const status = typeof e.status === "number" ? e.status : typeof e.statusCode === "number" ? e.statusCode : null;
  const code = typeof e.code === "string" ? e.code : "";
  const message = typeof e.message === "string" ? e.message.toLowerCase() : "";

  if (status === 401 || status === 403 || message.includes("api key") || message.includes("unauthorized") || message.includes("no key")) {
    return "no_key";
  }
  if (status === 429 || message.includes("rate limit") || message.includes("quota")) {
    return "rate_limited";
  }
  if (code === "ETIMEDOUT" || code === "ECONNABORTED" || message.includes("timeout")) {
    return "timeout";
  }
  if (message.includes("invalid") || message.includes("parse") || message.includes("json")) {
    return "malformed";
  }
  return "provider_error";
}

function mergeInto<T extends object>(
  merged: Partial<T>,
  providerMap: ProviderMap,
  result: T & { source: string },
  fields: (keyof Omit<T, "source">)[]
): number {
  const now = new Date().toISOString();
  let added = 0;
  for (const field of fields) {
    const key = field as keyof T;
    if (merged[key] == null && result[key] != null) {
      merged[key] = result[key];
      providerMap[field as string] = {
        value: result[key],
        source: result.source,
        fetchedAt: now,
      };
      added++;
    }
  }
  return added;
}

function hasEssentialCompanyFields(merged: Partial<CompanyEnrichResult>): boolean {
  return (
    merged.name != null &&
    merged.domain != null &&
    merged.industry != null &&
    merged.employeeCount != null
  );
}

function hasAllCompanyFields(merged: Partial<CompanyEnrichResult>): boolean {
  return COMPANY_FIELDS.every((field) => merged[field] != null);
}

function hasEssentialPersonFields(merged: Partial<PersonEnrichResult>): boolean {
  return (
    merged.firstName != null &&
    merged.lastName != null &&
    merged.email != null &&
    merged.title != null
  );
}

function hasAllPersonFields(merged: Partial<PersonEnrichResult>): boolean {
  return PERSON_FIELDS.every((field) => merged[field] != null);
}

export async function enrichCompanyWaterfall(
  domain: string,
  options: { excludeProviders?: string[]; onProviderSuccess?: (provider: string, fieldsAdded: number) => void } = {}
): Promise<MergedCompanyResult | null> {
  initEnrichmentProviders();
  const merged: Partial<CompanyEnrichResult> = {};
  const providerMap: ProviderMap = {};
  const excluded = new Set((options.excludeProviders ?? []).map((p) => p.toLowerCase()));
  const attemptLog: ProviderAttemptLog[] = [];

  for (const provider of PROVIDERS) {
    if (excluded.has(provider.name.toLowerCase())) continue;
    const t0 = Date.now();
    try {
      const result = await provider.enrichCompany(domain);
      const durationMs = Date.now() - t0;
      if (!result) {
        attemptLog.push({ provider: provider.name, status: "empty", durationMs, fieldsAdded: 0 });
        continue;
      }
      const fieldsAdded = mergeInto(merged, providerMap, result, COMPANY_FIELDS);
      attemptLog.push({ provider: provider.name, status: "success", durationMs, fieldsAdded });
      logger.info({ provider: provider.name, domain, fieldsAdded, durationMs }, "[enrichment-registry] company hit");
      if (fieldsAdded > 0) options.onProviderSuccess?.(provider.name, fieldsAdded);
      if (hasAllCompanyFields(merged)) break;
    } catch (err) {
      const durationMs = Date.now() - t0;
      const reason = classifyError(err);
      const message = err instanceof Error ? err.message : String(err);
      attemptLog.push({ provider: provider.name, status: reason, durationMs, fieldsAdded: 0, failureReason: message });
      logger.warn({ provider: provider.name, domain, reason, durationMs, err }, "[enrichment-registry] company failed");
    }
  }

  if (Object.keys(providerMap).length === 0) {
    logger.info({ domain, attemptLog }, "[enrichment-registry] company waterfall produced no results");
    return null;
  }

  logger.debug({ domain, attemptLog }, "[enrichment-registry] company waterfall complete");
  return { ...merged, providerMap } as MergedCompanyResult;
}

export async function enrichPersonWaterfall(
  params: {
    email?: string;
    linkedinUrl?: string;
    firstName?: string;
    lastName?: string;
    domain?: string;
  },
  options: { excludeProviders?: string[]; onProviderSuccess?: (provider: string, fieldsAdded: number) => void } = {}
): Promise<MergedPersonResult | null> {
  initEnrichmentProviders();
  const merged: Partial<PersonEnrichResult> = {};
  const providerMap: ProviderMap = {};
  const excluded = new Set((options.excludeProviders ?? []).map((p) => p.toLowerCase()));
  const attemptLog: ProviderAttemptLog[] = [];

  for (const provider of PROVIDERS) {
    if (excluded.has(provider.name.toLowerCase())) continue;
    const t0 = Date.now();
    try {
      const result = await provider.enrichPerson(params);
      const durationMs = Date.now() - t0;
      if (!result) {
        attemptLog.push({ provider: provider.name, status: "empty", durationMs, fieldsAdded: 0 });
        continue;
      }
      const fieldsAdded = mergeInto(merged, providerMap, result, PERSON_FIELDS);
      attemptLog.push({ provider: provider.name, status: "success", durationMs, fieldsAdded });
      logger.info({ provider: provider.name, params, fieldsAdded, durationMs }, "[enrichment-registry] person hit");
      if (fieldsAdded > 0) options.onProviderSuccess?.(provider.name, fieldsAdded);
      if (hasAllPersonFields(merged)) break;
    } catch (err) {
      const durationMs = Date.now() - t0;
      const reason = classifyError(err);
      const message = err instanceof Error ? err.message : String(err);
      attemptLog.push({ provider: provider.name, status: reason, durationMs, fieldsAdded: 0, failureReason: message });
      logger.warn({ provider: provider.name, params, reason, durationMs, err }, "[enrichment-registry] person failed");
    }
  }

  if (Object.keys(providerMap).length === 0) {
    logger.info({ params, attemptLog }, "[enrichment-registry] person waterfall produced no results");
    return null;
  }

  logger.debug({ params, attemptLog }, "[enrichment-registry] person waterfall complete");
  return { ...merged, providerMap } as MergedPersonResult;
}

let _initialized = false;

export function initEnrichmentProviders(): void {
  if (_initialized) return;
  _initialized = true;
  registerProvider(new ApolloProvider());
  registerProvider(new PDLProvider());
  registerProvider(new HunterProvider());
  registerProvider(new CrunchbaseProvider());
  registerProvider(new PatternProvider());
  registerProvider(new ApifyLinkedInProvider());
  registerProvider(new ProxycurlProvider());
}