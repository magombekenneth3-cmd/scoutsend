import { Prisma } from "@prisma/client";
import { getDomain } from "tldts";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import {
  initEnrichmentProviders,
  enrichCompanyWaterfall,
  enrichPersonWaterfall,
} from "../../lib/providers";

export type WaterfallProviderState =
  | "success"
  | "empty"
  | "timeout"
  | "error"
  | "skipped";

export interface WaterfallProviderStatus {
  provider: string;
  status: WaterfallProviderState;
  durationMs: number;
  fieldsReceived: number;
  fieldsAdded: number;
  error?: string;
}

export interface WaterfallEnrichResult {
  leadId: string;
  companyHit: boolean;
  personHit: boolean;
  fieldsAdded: string[];
  fieldsAddedByProvider: { company: string[]; person: string[] };
  changes: FieldChange[];
  skipped: boolean;
  company: WaterfallProviderStatus;
  person: WaterfallProviderStatus;
}

interface ProviderEntry {
  value: unknown;
  confidence?: number;
  url?: string;
  retrievedAt?: string;
  [key: string]: unknown;
}

type ProviderMap = Record<string, ProviderEntry>;

interface ProviderMeta {
  provider: string;
  status: WaterfallProviderState;
  durationMs: number;
  attemptedAt: string;
  lastSuccessAt?: string;
}

interface EnrichResultShape {
  providerMap: unknown;
  provider?: string;
}

export interface FieldChange {
  entity: "company" | "person";
  field: string;
  previousValue: unknown;
  currentValue: unknown;
  delta?: number;
  provider: string;
  observedAt: string;
}

const PROVIDER_TIMEOUT_MS = 5000;
const MAX_TX_RETRIES = 3;
const FRESHNESS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const ENRICHMENT_SCHEMA_VERSION = 2;
const MAX_PROVIDER_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 200;
const RETRYABLE_STATUS_CODES = new Set([429, 502, 503, 504]);
const RETRYABLE_ERROR_CODES = new Set(["ECONNRESET", "ETIMEDOUT", "EAI_AGAIN"]);

initEnrichmentProviders();

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProviderMap(value: unknown): value is ProviderMap {
  if (!isPlainObject(value)) return false;
  return Object.values(value).every((entry) => {
    if (!isPlainObject(entry)) return false;
    if (!("value" in entry) || entry.value === undefined) return false;
    if (
      "confidence" in entry &&
      entry.confidence !== undefined &&
      typeof entry.confidence !== "number"
    ) {
      return false;
    }
    return true;
  });
}

function getConfidence(entry: ProviderEntry | undefined): number | undefined {
  return entry && typeof entry.confidence === "number" ? entry.confidence : undefined;
}

function isRetryablePrismaError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    (err.code === "P2034" || err.code === "P2028")
  );
}

function isRetryableProviderError(err: unknown): boolean {
  if (!isPlainObject(err)) return false;
  const response = isPlainObject(err.response) ? err.response : undefined;
  const status = (err.status ?? err.statusCode ?? response?.status) as number | undefined;
  if (typeof status === "number" && RETRYABLE_STATUS_CODES.has(status)) return true;
  const code = err.code;
  if (typeof code === "string" && RETRYABLE_ERROR_CODES.has(code)) return true;
  return false;
}

async function attemptWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = MAX_PROVIDER_RETRIES
): Promise<T> {
  let attempt = 0;
  for (; ;) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      if (attempt > maxRetries || !isRetryableProviderError(err)) {
        throw err;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, RETRY_BASE_DELAY_MS * 2 ** (attempt - 1))
      );
    }
  }
}

interface SafeEnrichContext {
  leadId: string;
  domain?: string;
}

type SafeEnrichStatus = "success" | "timeout" | "error";

interface SafeEnrichOutcome<T> {
  result: T | null;
  durationMs: number;
  status: SafeEnrichStatus;
  error?: string;
}

async function safeEnrich<T>(
  label: string,
  fn: (signal: AbortSignal) => Promise<T>,
  context: SafeEnrichContext,
  timeoutMs = PROVIDER_TIMEOUT_MS
): Promise<SafeEnrichOutcome<T>> {
  const start = performance.now();
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
        reject(new Error(`${label} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    const result = await Promise.race([fn(controller.signal), timeout]);
    const durationMs = performance.now() - start;
    logger.info(
      { provider: label, leadId: context.leadId, durationMs, status: "success" },
      "[enrichment-waterfall] provider_latency"
    );
    logger.info({ provider: label, leadId: context.leadId }, "[enrichment-waterfall] provider_success_total");
    return { result, durationMs, status: "success" };
  } catch (err) {
    const durationMs = performance.now() - start;
    const errorMessage = err instanceof Error ? err.message : String(err);
    const status: SafeEnrichStatus = timedOut ? "timeout" : "error";
    logger.warn(
      {
        provider: label,
        leadId: context.leadId,
        domain: context.domain,
        timeoutMs,
        durationMs,
        status,
        err: errorMessage,
      },
      "[enrichment-waterfall] provider lookup failed"
    );
    logger.info(
      { provider: label, leadId: context.leadId },
      status === "timeout"
        ? "[enrichment-waterfall] provider_timeout_total"
        : "[enrichment-waterfall] provider_error_total"
    );
    return { result: null, durationMs, status, error: errorMessage };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function resolveProviderStatus(
  provider: string,
  leadId: string,
  ran: boolean,
  safe: SafeEnrichOutcome<unknown> | null,
  hit: boolean,
  fieldsReceived: number,
  fieldsAddedCount: number
): WaterfallProviderStatus {
  if (!ran) {
    return { provider, status: "skipped", durationMs: 0, fieldsReceived: 0, fieldsAdded: 0 };
  }
  if (!safe) {
    return { provider, status: "error", durationMs: 0, fieldsReceived: 0, fieldsAdded: 0 };
  }
  if (safe.status !== "success") {
    return {
      provider,
      status: safe.status,
      durationMs: safe.durationMs,
      fieldsReceived: 0,
      fieldsAdded: 0,
      error: safe.error,
    };
  }
  if (fieldsAddedCount > 0) {
    logger.info(
      { provider, leadId, count: fieldsAddedCount },
      "[enrichment-waterfall] provider_fields_added_total"
    );
  }
  if (fieldsReceived > 0) {
    logger.info(
      { provider, leadId, count: fieldsReceived },
      "[enrichment-waterfall] provider_fields_received_total"
    );
  } else {
    logger.info({ provider, leadId }, "[enrichment-waterfall] provider_empty_total");
  }
  return {
    provider,
    status: hit ? "success" : "empty",
    durationMs: safe.durationMs,
    fieldsReceived,
    fieldsAdded: fieldsAddedCount,
  };
}

async function runTransactionWithRetry<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  let attempt = 0;
  for (; ;) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (err) {
      attempt += 1;
      if (!isRetryablePrismaError(err) || attempt >= MAX_TX_RETRIES) {
        throw err;
      }
      logger.info({ attempt }, "[enrichment-waterfall] transaction_retry_total");
      logger.warn({ attempt }, "[enrichment-waterfall] transaction conflict — retrying");
      await new Promise((resolve) => setTimeout(resolve, 50 * 2 ** attempt));
    }
  }
}

function getMeta(container: Record<string, unknown>): ProviderMeta | undefined {
  const meta = container.meta;
  return isPlainObject(meta) ? (meta as unknown as ProviderMeta) : undefined;
}

function shouldRunProvider(meta: ProviderMeta | undefined, force: boolean): boolean {
  if (force) return true;
  if (!meta?.lastSuccessAt) return true;
  return Date.now() - new Date(meta.lastSuccessAt).getTime() >= FRESHNESS_WINDOW_MS;
}

export async function runEnrichmentWaterfall(
  leadId: string,
  userId: string,
  options: { force?: boolean } = {}
): Promise<WaterfallEnrichResult> {
  const lead = await prisma.lead.findFirstOrThrow({
    where: {
      id: leadId,
      campaign: { createdById: userId },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      linkedinUrl: true,
      website: true,
      companyName: true,
      enrichmentData: true,
      title: true,
      seniority: true,
      department: true,
    },
  });

  const existingSnapshot: Record<string, unknown> = isPlainObject(lead.enrichmentData)
    ? lead.enrichmentData
    : {};
  const existingCompanySnapshot = isPlainObject(existingSnapshot.company)
    ? existingSnapshot.company
    : {};
  const existingPersonSnapshot = isPlainObject(existingSnapshot.person)
    ? existingSnapshot.person
    : {};
  const companyMeta = getMeta(existingCompanySnapshot);
  const personMeta = getMeta(existingPersonSnapshot);

  let domain: string | undefined;
  if (lead.website) {
    try {
      const raw = lead.website.startsWith("http")
        ? lead.website
        : `https://${lead.website}`;
      const hostname = new URL(raw).hostname.replace(/^www\./, "");
      domain = getDomain(hostname) ?? hostname;
    } catch {
      logger.warn(
        { leadId, website: lead.website },
        "[enrichment-waterfall] malformed website — skipping domain enrichment"
      );
    }
  }

  const runCompany = Boolean(domain) && shouldRunProvider(companyMeta, Boolean(options.force));
  const runPerson = shouldRunProvider(personMeta, Boolean(options.force));

  if (!runCompany && !runPerson) {
    logger.info({ leadId }, "[enrichment-waterfall] skipped — enriched recently");
    return {
      leadId,
      companyHit: false,
      personHit: false,
      fieldsAdded: [],
      fieldsAddedByProvider: { company: [], person: [] },
      changes: [],
      skipped: true,
      company: { provider: "company", status: "skipped", durationMs: 0, fieldsReceived: 0, fieldsAdded: 0 },
      person: { provider: "person", status: "skipped", durationMs: 0, fieldsReceived: 0, fieldsAdded: 0 },
    };
  }

  const enrichContext: SafeEnrichContext = { leadId, domain };

  const [companyOutcome, personOutcome] = await Promise.all([
    runCompany
      ? safeEnrich(
        "company",
        (_signal) => attemptWithRetry(() => enrichCompanyWaterfall(domain!)),
        enrichContext
      )
      : Promise.resolve(null),
    runPerson
      ? safeEnrich(
        "person",
        (_signal) =>
          attemptWithRetry(() =>
            enrichPersonWaterfall({
              email: lead.email ?? undefined,
              linkedinUrl: lead.linkedinUrl ?? undefined,
              firstName: lead.firstName ?? undefined,
              lastName: lead.lastName ?? undefined,
              domain,
            })
          ),
        enrichContext
      )
      : Promise.resolve(null),
  ]);

  logger.info(
    {
      leadId,
      companyDurationMs: companyOutcome?.durationMs ?? 0,
      personDurationMs: personOutcome?.durationMs ?? 0,
    },
    "[enrichment-waterfall] provider lookups complete"
  );

  const company = companyOutcome?.result as EnrichResultShape | null | undefined;
  const person = personOutcome?.result as
    | (EnrichResultShape & {
      email?: string;
      linkedinUrl?: string;
      firstName?: string;
      lastName?: string;
      title?: string;
      seniority?: string;
      department?: string;
    })
    | null
    | undefined;

  const companyProviderName = company?.provider ?? "company";
  const personProviderName = person?.provider ?? "person";
  const now = new Date().toISOString();

  const {
    fieldsAdded,
    fieldsAddedByProvider,
    changes,
    companyHit,
    personHit,
    companyFieldsReceived,
    personFieldsReceived,
  } = await runTransactionWithRetry(async (tx) => {
    const current = await tx.lead.findUnique({
      where: { id: leadId },
      select: {
        enrichmentData: true,
        email: true,
        linkedinUrl: true,
        firstName: true,
        lastName: true,
        title: true,
        seniority: true,
        department: true,
      },
    });

    if (!current) {
      logger.warn({ leadId }, "[enrichment-waterfall] Lead not found during atomic merge — skipping");
      return {
        fieldsAdded: [] as string[],
        fieldsAddedByProvider: { company: [] as string[], person: [] as string[] },
        changes: [] as FieldChange[],
        companyHit: false,
        personHit: false,
        companyFieldsReceived: 0,
        personFieldsReceived: 0,
      };
    }

    const existing: Record<string, unknown> = isPlainObject(current.enrichmentData)
      ? { ...current.enrichmentData }
      : {};
    existing.version = ENRICHMENT_SCHEMA_VERSION;

    const companyFieldsAdded = new Set<string>();
    const companyChanges: FieldChange[] = [];
    let companyHit = false;
    let companyFieldsReceived = 0;

    if (runCompany) {
      if (company && isProviderMap(company.providerMap)) {
        const providerMap = company.providerMap;
        companyFieldsReceived = Object.keys(providerMap).length;
        companyHit = companyFieldsReceived > 0;
        const existingCompany: Record<string, unknown> = isPlainObject(existing.company)
          ? existing.company
          : {};
        const existingMap = isProviderMap(existingCompany.providerMap)
          ? existingCompany.providerMap
          : {};
        const merged: Record<string, unknown> = { ...existingCompany };
        const mergedMap: ProviderMap = { ...existingMap };
        for (const [field, entry] of Object.entries(providerMap)) {
          const stampedEntry: ProviderEntry = { ...entry, retrievedAt: entry.retrievedAt ?? now };
          const existingConfidence = getConfidence(existingMap[field]);
          const newConfidence = getConfidence(stampedEntry);
          const shouldOverwrite =
            merged[field] == null ||
            (newConfidence !== undefined &&
              (existingConfidence === undefined || newConfidence > existingConfidence));
          if (shouldOverwrite) {
            const previousValue = merged[field];
            if (previousValue !== stampedEntry.value) {
              merged[field] = stampedEntry.value;
              companyFieldsAdded.add(field);
              if (previousValue != null) {
                const delta =
                  typeof previousValue === "number" && typeof stampedEntry.value === "number"
                    ? stampedEntry.value - previousValue
                    : undefined;
                companyChanges.push({
                  entity: "company",
                  field,
                  previousValue,
                  currentValue: stampedEntry.value,
                  delta,
                  provider: companyProviderName,
                  observedAt: now,
                });
              }
            }
            mergedMap[field] = stampedEntry;
          }
        }
        existing.company = {
          ...merged,
          providerMap: mergedMap,
          meta: {
            provider: companyProviderName,
            status: companyHit ? "success" : "empty",
            durationMs: companyOutcome?.durationMs ?? 0,
            attemptedAt: now,
            lastSuccessAt: companyHit ? now : companyMeta?.lastSuccessAt,
          } satisfies ProviderMeta,
        };
      } else if (company) {
        logger.warn({ leadId }, "[enrichment-waterfall] company provider returned malformed providerMap — skipping");
        const existingCompany: Record<string, unknown> = isPlainObject(existing.company)
          ? existing.company
          : {};
        existing.company = {
          ...existingCompany,
          meta: {
            provider: companyProviderName,
            status: "error",
            durationMs: companyOutcome?.durationMs ?? 0,
            attemptedAt: now,
            lastSuccessAt: companyMeta?.lastSuccessAt,
          } satisfies ProviderMeta,
        };
      } else if (companyOutcome) {
        const existingCompany: Record<string, unknown> = isPlainObject(existing.company)
          ? existing.company
          : {};
        existing.company = {
          ...existingCompany,
          meta: {
            provider: companyProviderName,
            status: companyOutcome.status,
            durationMs: companyOutcome.durationMs,
            attemptedAt: now,
            lastSuccessAt: companyMeta?.lastSuccessAt,
          } satisfies ProviderMeta,
        };
      }
    }

    const scalarUpdates: Record<string, unknown> = {};
    const personFieldsAdded = new Set<string>();
    const personChanges: FieldChange[] = [];
    let personHit = false;
    let personFieldsReceived = 0;

    if (runPerson) {
      if (person && isProviderMap(person.providerMap)) {
        const providerMap = person.providerMap;
        personFieldsReceived = Object.keys(providerMap).length;
        personHit = personFieldsReceived > 0;
        const existingPerson: Record<string, unknown> = isPlainObject(existing.person)
          ? existing.person
          : {};
        const existingMap = isProviderMap(existingPerson.providerMap)
          ? existingPerson.providerMap
          : {};
        const merged: Record<string, unknown> = { ...existingPerson };
        const mergedMap: ProviderMap = { ...existingMap };
        for (const [field, entry] of Object.entries(providerMap)) {
          const stampedEntry: ProviderEntry = { ...entry, retrievedAt: entry.retrievedAt ?? now };
          const existingConfidence = getConfidence(existingMap[field]);
          const newConfidence = getConfidence(stampedEntry);
          const shouldOverwrite =
            merged[field] == null ||
            (newConfidence !== undefined &&
              (existingConfidence === undefined || newConfidence > existingConfidence));
          if (shouldOverwrite) {
            const previousValue = merged[field];
            if (previousValue !== stampedEntry.value) {
              merged[field] = stampedEntry.value;
              personFieldsAdded.add(field);
              if (previousValue != null) {
                const delta =
                  typeof previousValue === "number" && typeof stampedEntry.value === "number"
                    ? stampedEntry.value - previousValue
                    : undefined;
                personChanges.push({
                  entity: "person",
                  field,
                  previousValue,
                  currentValue: stampedEntry.value,
                  delta,
                  provider: personProviderName,
                  observedAt: now,
                });
              }
            }
            mergedMap[field] = stampedEntry;
          }
        }
        existing.person = {
          ...merged,
          providerMap: mergedMap,
          meta: {
            provider: personProviderName,
            status: personHit ? "success" : "empty",
            durationMs: personOutcome?.durationMs ?? 0,
            attemptedAt: now,
            lastSuccessAt: personHit ? now : personMeta?.lastSuccessAt,
          } satisfies ProviderMeta,
        };

        if (!current.email && person.email) scalarUpdates.email = person.email;
        if (!current.linkedinUrl && person.linkedinUrl) scalarUpdates.linkedinUrl = person.linkedinUrl;
        if (!current.firstName && person.firstName) scalarUpdates.firstName = person.firstName;
        if (!current.lastName && person.lastName) scalarUpdates.lastName = person.lastName;

        const applyConfidenceField = (
          key: "title" | "seniority" | "department",
          currentValue: string | null,
          newValue: string | undefined
        ) => {
          if (!newValue) return;
          const newConfidence = getConfidence(providerMap[key]);
          const existingConfidence = getConfidence(existingMap[key]);
          if (!currentValue) {
            scalarUpdates[key] = newValue;
            return;
          }
          if (
            newConfidence !== undefined &&
            (existingConfidence === undefined || newConfidence > existingConfidence)
          ) {
            scalarUpdates[key] = newValue;
          }
        };

        applyConfidenceField("title", current.title, person.title);
        applyConfidenceField("seniority", current.seniority, person.seniority);
        applyConfidenceField("department", current.department, person.department);
      } else if (person) {
        logger.warn({ leadId }, "[enrichment-waterfall] person provider returned malformed providerMap — skipping");
        const existingPerson: Record<string, unknown> = isPlainObject(existing.person)
          ? existing.person
          : {};
        existing.person = {
          ...existingPerson,
          meta: {
            provider: personProviderName,
            status: "error",
            durationMs: personOutcome?.durationMs ?? 0,
            attemptedAt: now,
            lastSuccessAt: personMeta?.lastSuccessAt,
          } satisfies ProviderMeta,
        };
      } else if (personOutcome) {
        const existingPerson: Record<string, unknown> = isPlainObject(existing.person)
          ? existing.person
          : {};
        existing.person = {
          ...existingPerson,
          meta: {
            provider: personProviderName,
            status: personOutcome.status,
            durationMs: personOutcome.durationMs,
            attemptedAt: now,
            lastSuccessAt: personMeta?.lastSuccessAt,
          } satisfies ProviderMeta,
        };
      }
    }

    const fieldsAddedByProvider = {
      company: Array.from(companyFieldsAdded),
      person: Array.from(personFieldsAdded),
    };
    const fieldsAdded = [
      ...fieldsAddedByProvider.company.map((f) => `company.${f}`),
      ...fieldsAddedByProvider.person.map((f) => `person.${f}`),
    ];
    const changes = [...companyChanges, ...personChanges];
    for (const change of changes) {
      logger.info(
        { leadId, entity: change.entity, field: change.field, delta: change.delta },
        "[enrichment-waterfall] field_change_detected_total"
      );
    }
    const hasScalarUpdates = Object.keys(scalarUpdates).length > 0;
    const hasEnrichmentUpdates = fieldsAdded.length > 0;
    const hasMetaUpdates = runCompany || runPerson;

    const updateData: Prisma.LeadUpdateInput = { ...scalarUpdates };
    if (hasScalarUpdates || hasEnrichmentUpdates) {
      updateData.lastEnrichedAt = new Date();
    }
    if (hasEnrichmentUpdates || hasMetaUpdates) {
      updateData.enrichmentData = existing as Prisma.InputJsonValue;
    }

    if (Object.keys(updateData).length > 0) {
      await tx.lead.update({
        where: { id: leadId },
        data: updateData,
      });
    }

    return {
      fieldsAdded,
      fieldsAddedByProvider,
      changes,
      companyHit,
      personHit,
      companyFieldsReceived,
      personFieldsReceived,
    };
  });

  const companyStatus = resolveProviderStatus(
    companyProviderName,
    leadId,
    runCompany,
    companyOutcome,
    companyHit,
    companyFieldsReceived,
    fieldsAddedByProvider.company.length
  );
  const personStatus = resolveProviderStatus(
    personProviderName,
    leadId,
    runPerson,
    personOutcome,
    personHit,
    personFieldsReceived,
    fieldsAddedByProvider.person.length
  );

  logger.info(
    {
      leadId,
      companyHit,
      personHit,
      fieldsAdded,
      changesDetected: changes.length,
      company: companyStatus,
      person: personStatus,
    },
    "[enrichment-waterfall] done"
  );

  return {
    leadId,
    companyHit,
    personHit,
    fieldsAdded,
    fieldsAddedByProvider,
    changes,
    skipped: false,
    company: companyStatus,
    person: personStatus,
  };
}