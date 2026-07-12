import { Prisma, SignalType } from "@prisma/client";
import pLimit from "p-limit";
import { createHash } from "crypto";
import { prisma } from "../../lib/prisma";
import { redis } from "../../lib/ioredis";
import { callGemini, extractJSON, MODELS } from "./gemini.client";
import { BreakdownScores, LEAD_SCORING_SYSTEM_PROMPT } from "./lead-scoring.agent";
import { logger } from "../../lib/logger";
import { enqueueEnrichmentBatches } from "./email-enrichment.queue";
import { EMAIL_SOURCE, EMAIL_STATUS } from "./email-enrichment.agent";
import { emitCampaignEvent } from "../../lib/campaign-events";
import { initializeLeadSequence } from "./linkedin-outreach.agent";
import { assertPauseGuard } from "./ochestration.graph";
import { ApiKeyVault } from "../../lib/key-manager";

const APOLLO_FETCH_MULTIPLIER = 3;
const APOLLO_MAX_PER_PAGE = 100;
const APOLLO_MAX_TOTAL_CONTACTS = 500;
const APOLLO_MIN_ACCEPTABLE_RESULTS = 5;
const APOLLO_MAX_RETRIES = 3;
const APOLLO_RETRY_BASE_MS = 2_000;
const APOLLO_PERSIST_MULTIPLIER = 2;

const DEFAULT_QUALIFICATION_THRESHOLD = 0.5;
const EXTERNAL_FETCH_TIMEOUT_MS = 10_000;
const APOLLO_SEARCH_TIMEOUT_MS = 120_000;

const SCORING_FAILURE_RATE_THRESHOLD = 0.5;
const ENRICHMENT_MISS_RATE_WARNING_THRESHOLD = 0.5;

const VALID_SIGNAL_TYPES = new Set<string>(Object.values(SignalType));

const apolloResearchVault = new ApiKeyVault("apollo-research", "APOLLO_API_KEYS");
const placesVault = new ApiKeyVault("google-places", "GOOGLE_PLACES_API_KEYS");

const VALID_EMPLOYEE_RANGES = new Set([
  "1,10", "11,50", "51,200", "201,500", "501,1000", "1001,5000",
]);

const VALID_FUNDING_STAGES = new Set([
  "seed", "series_a", "series_b", "series_c", "series_d",
  "series_e", "private_equity", "ipo",
]);

const VALID_SENIORITY = new Set([
  "owner", "founder", "c_suite", "vp", "director", "manager", "senior",
]);

function sanitizeApolloFilters(filters: ApolloFilters): ApolloFilters {
  return {
    ...filters,
    employee_ranges: (filters.employee_ranges ?? []).filter((r) =>
      VALID_EMPLOYEE_RANGES.has(r)
    ),
    funding_stages: (filters.funding_stages ?? []).filter((s) =>
      VALID_FUNDING_STAGES.has(s)
    ),
    seniority: (filters.seniority ?? []).filter((s) =>
      VALID_SENIORITY.has(s)
    ),
    technologies: (filters.technologies ?? []).filter((t) =>
      /^[a-z0-9_]{2,64}$/.test(t)
    ),
  };
}

const LEAD_SCORE_TIMEOUT_MS = 30_000;
const PLACES_CACHE_TTL_S = 60 * 60 * 24 * 7;
const SERPER_CACHE_TTL_S = 60 * 60 * 24 * 7;

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T> =>
    Promise.race([
        p,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`Operation timed out after ${ms}ms`)), ms)
        ),
    ]);

async function withRetry<T>(fn: () => Promise<T>, retries = 2, baseDelayMs = 1_000): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i <= retries; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (i < retries) {
                await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
            }
        }
    }
    throw lastErr;
}


interface ApolloContact {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  title?: string;
  linkedin_url?: string;
  organization?: {
    name?: string;
    website_url?: string;
    primary_domain?: string;
  };
}

export interface ApolloFilters {
  titles?: string[];
  seniority?: string[];
  industry_tags?: string[];
  employee_ranges?: string[];
  funding_stages?: string[];
  technologies?: string[];
}

interface ApolloPeopleResponse {
  people?: ApolloContact[];
  pagination?: {
    page: number;
    per_page: number;
    total_entries: number;
    total_pages: number;
  };
}

interface GooglePlaceResult {
  name: string;
  formatted_address?: string;
  rating?: number;
  website?: string;
  types?: string[];
  business_status?: string;
}

interface SerperResult {
  title: string;
  link: string;
  snippet: string;
}

interface ResearchScoringResult {
  qualificationScore: number;
  qualificationReason: string;
  breakdownScores: BreakdownScores;
  evidenceTriggers: string[];
  recommendedAction: "HIGH_PRIORITY" | "STANDARD" | "NURTURE" | "DISQUALIFY";
  signals: Array<{ type: string; value: string; confidence: number; explanation: string }>;
}

interface ScoredLead {
  companyName: string;
  website?: string;
  linkedinUrl?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  title?: string;
  qualificationScore: number;
  qualificationReason: string;
  breakdownScores: BreakdownScores;
  recommendedAction: string;
  enrichmentData: Record<string, unknown>;
  signals: Array<{
    type: string;
    value: string;
    confidence: number;
    source: string;
    explanation: string;
  }>;
  apolloId: string;
}

interface DeduplicationSets {
  suppressedEmails: Set<string>;
  suppressedDomains: Set<string>;
  existingEmailsInCampaign: Set<string>;
  existingExternalIdsInCampaign: Set<string>;
}

export function assertEnv(): void {
  const missing = (
    ["APOLLO_API_KEYS", "GEMINI_API_KEY", "GOOGLE_PLACES_API_KEYS", "SERPER_API_KEYS"] as const
  ).filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(
      `[research.agent] Missing required environment variables: ${missing.join(", ")}. ` +
      "Check your .env / deployment config before running the research agent."
    );
  }
}

const RESEARCH_SCORING_SYSTEM_PROMPT = `${LEAD_SCORING_SYSTEM_PROMPT}

Additionally extract signals observed in the web data. Append a "signals" array to the JSON:
  "signals": [
    { "type": string, "value": string, "confidence": number (0–1), "explanation": string }
  ]

Signal types: HIRING_SIGNAL, FUNDING_SIGNAL, GROWTH_SIGNAL, TECH_SIGNAL, INTENT_SIGNAL, RISK_SIGNAL, WEBSITE_COPY.`;

function validateScoringResult(raw: unknown): ResearchScoringResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("Scoring result is not an object");
  }

  const r = raw as Record<string, unknown>;

  const rawScore = typeof r.qualificationScore === "number" ? r.qualificationScore : NaN;
  const normalised = rawScore > 1 ? rawScore / 100 : rawScore;
  const qualificationScore = isNaN(rawScore) ? 0 : Math.min(1, Math.max(0, normalised));

  const qualificationReason =
    typeof r.qualificationReason === "string" ? r.qualificationReason : "No reason provided";

  const breakdownScores =
    r.breakdownScores && typeof r.breakdownScores === "object"
      ? (r.breakdownScores as BreakdownScores)
      : ({} as BreakdownScores);

  const evidenceTriggers = Array.isArray(r.evidenceTriggers)
    ? (r.evidenceTriggers as string[]).filter((t) => typeof t === "string")
    : [];

  const validActions = ["HIGH_PRIORITY", "STANDARD", "NURTURE", "DISQUALIFY"] as const;
  const recommendedAction = validActions.includes(
    r.recommendedAction as (typeof validActions)[number]
  )
    ? (r.recommendedAction as ResearchScoringResult["recommendedAction"])
    : "STANDARD";

  const signals = Array.isArray(r.signals)
    ? (r.signals as unknown[])
      .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
      .map((s) => ({
        type: typeof s.type === "string" ? s.type : "UNKNOWN",
        value: typeof s.value === "string" ? s.value : "",
        confidence:
          typeof s.confidence === "number" ? Math.min(1, Math.max(0, s.confidence)) : 0,
        explanation: typeof s.explanation === "string" ? s.explanation : "",
      }))
    : [];

  return {
    qualificationScore,
    qualificationReason,
    breakdownScores,
    evidenceTriggers,
    recommendedAction,
    signals,
  };
}

function resolveQualificationThreshold(raw: number | null | undefined): number {
  if (raw === null || raw === undefined) return DEFAULT_QUALIFICATION_THRESHOLD;
  if (!isFinite(raw) || raw < 0 || raw > 1) {
    logger.warn(
      { raw },
      "[research.agent] qualificationThreshold out of range [0,1] — falling back to default"
    );
    return DEFAULT_QUALIFICATION_THRESHOLD;
  }
  return raw;
}

function logDroppedSignals(context: Record<string, unknown>, total: number, valid: number, dropped: string[]): void {
  if (valid === total) return;
  logger.warn(
    { ...context, total, valid, droppedTypes: dropped },
    "[research.agent] Dropped signals with unrecognized type — check SignalType enum vs prompt"
  );
}

function extractDomain(url?: string | null): string | null {
  if (!url) return null;
  try {
    const hostname = new URL(url.startsWith("http") ? url : `https://${url}`).hostname;
    return hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

export async function extractApolloFilters(
  icpDescription: string,
  targetIndustry: string | undefined,
  targetRegion: string | undefined,
  relaxed: boolean
): Promise<ApolloFilters> {
  const { text } = await callGemini({
    agentName: "research.apollo-filter",
    model: MODELS.RESEARCH,
    systemPrompt: relaxed
      ? `You extract Apollo.io API search parameters from an ICP description.
This is a RELAXED fallback — return only job titles. Drop employee ranges, seniority, and industry tags entirely.
Return ONLY a JSON object: { "titles": string[] }
Keep titles broad (e.g. ["CEO", "Founder", "Director of Sales"] not ultra-specific).`
      : `You extract Apollo.io API search parameters from an ICP description.
Return ONLY a JSON object with these optional fields:
{
  "titles": string[],
  "seniority": string[],
  "industry_tags": string[],
  "employee_ranges": string[],
  "funding_stages": string[],
  "technologies": string[]
}
Seniority options: owner, founder, c_suite, vp, director, manager, senior.
Employee ranges — use EXACTLY these comma-separated strings (no underscores):
  "1,10" | "11,50" | "51,200" | "201,500" | "501,1000" | "1001,5000"
industry_tags: plain-text industry names (e.g. "SaaS", "FinTech", "B2B Software").
  These are sent as keyword search terms, not numeric IDs.
Funding stage options (use when ICP implies growth/scale): seed, series_a, series_b, series_c, series_d.
Technologies: Apollo technology UIDs only when the ICP explicitly mentions specific tools
  (e.g. HubSpot → "hubspot", Salesforce → "salesforce_crm"). Leave empty if unsure.`,
    userPrompt: `ICP: ${icpDescription}\nIndustry: ${targetIndustry ?? "any"}\nRegion: ${targetRegion ?? "any"
      }`,
    metadata: { source: "apollo-filter", relaxed },
    temperature: 0.2,
    responseMimeType: "application/json",
  });

  return sanitizeApolloFilters(extractJSON<ApolloFilters>(text));
}

async function callApolloApi(
  filters: ApolloFilters,
  targetRegion: string | undefined,
  limit: number
): Promise<ApolloContact[]> {
  const keywordParts = filters.industry_tags?.filter(Boolean) ?? [];

  const baseBody: Record<string, unknown> = {
    ...(filters.titles?.length && { person_titles: filters.titles }),
    ...(filters.seniority?.length && { person_seniorities: filters.seniority }),
    ...(filters.employee_ranges?.length && {
      organization_num_employees_ranges: filters.employee_ranges,
    }),
    ...(keywordParts.length > 0 && { q_keywords: keywordParts.join(" ") }),
    ...(filters.funding_stages?.length && {
      organization_latest_funding_stage_cd: filters.funding_stages,
    }),
    ...(filters.technologies?.length && {
      currently_using_any_of_technology_uids: filters.technologies,
    }),
    ...(targetRegion && { person_locations: [targetRegion] }),
  };

  const allContacts: ApolloContact[] = [];
  let page = 1;
  let totalPages: number | null = null;

  while (allContacts.length < limit) {
    if (totalPages !== null && page > totalPages) break;

    const perPage = Math.min(APOLLO_MAX_PER_PAGE, limit - allContacts.length);
    const body = { ...baseBody, page, per_page: perPage };

    const pageContacts = await fetchApolloPage(body, page);

    if (totalPages === null && pageContacts.pagination) {
      totalPages = pageContacts.pagination.total_pages ?? null;
    }

    allContacts.push(...(pageContacts.people ?? []));

    if ((pageContacts.people ?? []).length < perPage) break;

    page++;
  }

  return allContacts;
}

async function fetchApolloPage(
  body: Record<string, unknown>,
  page: number
): Promise<ApolloPeopleResponse> {
  let lastError: Error | null = null;

  let apolloKey: string;
  try {
    apolloKey = await apolloResearchVault.acquireKey();
  } catch {
    return { people: [], pagination: undefined };
  }

  for (let attempt = 1; attempt <= APOLLO_MAX_RETRIES; attempt++) {
    let res: Response;
    try {
      res = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
          "X-Api-Key": apolloKey,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < APOLLO_MAX_RETRIES) {
        const backoffMs = APOLLO_RETRY_BASE_MS * Math.pow(2, attempt - 1);
        logger.warn(
          { attempt, backoffMs, err: lastError.message },
          "[research.agent] Apollo network error — retrying after backoff"
        );
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      throw new Error(
        `Apollo API network error after ${APOLLO_MAX_RETRIES} attempts: ${lastError.message}`
      );
    }

    if (res.ok) {
      return res.json() as Promise<ApolloPeopleResponse>;
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt < APOLLO_MAX_RETRIES) {
        const backoffMs = APOLLO_RETRY_BASE_MS * Math.pow(2, attempt - 1);
        logger.warn(
          { attempt, backoffMs, status: res.status },
          "[research.agent] Apollo transient error — retrying after backoff"
        );
        await new Promise((r) => setTimeout(r, backoffMs));
        continue;
      }
      if (res.status === 429) {
        await apolloResearchVault.reportFailure(apolloKey, 429);
        try { apolloKey = await apolloResearchVault.acquireKey(); } catch { }
        throw new Error(
          `Apollo API quota exhausted (HTTP 429) after ${APOLLO_MAX_RETRIES} attempts. ` +
          "Check your Apollo plan limits or retry the campaign later."
        );
      }
      throw new Error(
        `Apollo API server error (HTTP ${res.status}) after ${APOLLO_MAX_RETRIES} attempts. ` +
        "Check Apollo API status and retry the campaign later."
      );
    }

    if (res.status === 403 || res.status === 401 || res.status === 402) {
      await apolloResearchVault.reportFailure(apolloKey, res.status);
      try {
        apolloKey = await apolloResearchVault.acquireKey();
        continue;
      } catch {
        throw new Error(
          `Apollo API access denied (HTTP ${res.status}) — all keys exhausted. ` +
          "Check APOLLO_API_KEYS configuration."
        );
      }
    }

    if (res.status === 422) {
      const responseBody = await res.text().catch(() => "(unreadable)");
      let parsed: { error?: string; error_code?: string } = {};
      try {
        parsed = JSON.parse(responseBody);
      } catch {
        logger.warn(
          { responseBody: responseBody.slice(0, 200) },
          "[research.agent] Apollo 422 response was not valid JSON — treating as payload error"
        );
      }

      if (
        parsed.error_code === "INVALID_API_KEY_LOCATION" ||
        parsed.error_code === "INVALID_API_KEY"
      ) {
        throw new Error(
          `Apollo API key configuration error (${parsed.error_code}): ${parsed.error ?? responseBody
          }. Ensure APOLLO_API_KEY is set and passed in the X-Api-Key header.`
        );
      }

      throw new Error(
        `Apollo rejected the search filter payload (HTTP 422). ` +
        `Common causes: employee_ranges must use comma format ("11,50" not "11_50"), ` +
        `funding_stages must be valid Apollo slugs, technology UIDs must exist in Apollo's catalog. ` +
        `Apollo response: ${responseBody.slice(0, 300)}`
      );
    }

    throw new Error(
      `Apollo API returned unexpected status ${res.status} on page ${page}. ` +
      "Check Apollo API status and re-run the campaign."
    );
  }

  throw lastError ?? new Error("Apollo fetch failed after retries");
}

async function searchApollo(params: {
  icpDescription: string;
  targetIndustry?: string;
  targetRegion?: string;
  limit: number;
}): Promise<ApolloContact[]> {
  const { icpDescription, targetIndustry, targetRegion, limit } = params;

  const primaryFilters = await extractApolloFilters(
    icpDescription,
    targetIndustry,
    targetRegion,
    false
  );
  logger.info({ filters: primaryFilters }, "[research.agent] Apollo primary filters extracted");

  const primaryResults = await callApolloApi(primaryFilters, targetRegion, limit);
  logger.info(
    { count: primaryResults.length, threshold: APOLLO_MIN_ACCEPTABLE_RESULTS },
    "[research.agent] Apollo primary query returned contacts"
  );

  if (primaryResults.length < APOLLO_MIN_ACCEPTABLE_RESULTS) {
    logger.warn(
      { count: primaryResults.length },
      "[research.agent] Too few contacts from primary query — retrying with relaxed filters"
    );

    const relaxedFilters = await extractApolloFilters(
      icpDescription,
      targetIndustry,
      targetRegion,
      true
    );
    logger.info({ filters: relaxedFilters }, "[research.agent] Apollo relaxed filters extracted");

    const relaxedResults = await callApolloApi(relaxedFilters, undefined, limit);
    logger.info(
      { count: relaxedResults.length },
      "[research.agent] Apollo relaxed query returned contacts (region constraint dropped)"
    );

    const primaryIds = new Set(primaryResults.map((c) => c.id));
    return [
      ...primaryResults,
      ...relaxedResults.filter((c) => !primaryIds.has(c.id)),
    ].slice(0, limit);
  }

  return primaryResults;
}

interface ResearchRunLimiters {
  places: ReturnType<typeof pLimit>;
  serper: ReturnType<typeof pLimit>;
  scoring: ReturnType<typeof pLimit>;
  persist: ReturnType<typeof pLimit>;
}

export function createResearchRunLimiters(): ResearchRunLimiters {
  return {
    places: pLimit(3),
    serper: pLimit(5),
    scoring: pLimit(5),
    persist: pLimit(5),
  };
}

class QuotaExhaustedError extends Error {
  constructor(service: string, status: number) {
    super(`[research.agent] ${service} quota or auth error (HTTP ${status}) — halt pipeline and check API key/quota.`);
    this.name = "QuotaExhaustedError";
  }
}

async function enrichWithGooglePlaces(
  companyName: string,
  expectedDomain: string | null | undefined,
  region: string | undefined,
  limiters: ResearchRunLimiters
): Promise<GooglePlaceResult | null> {
  const cacheKey = `places:${createHash("md5").update(`${companyName}:${expectedDomain ?? ""}:${region ?? ""}`).digest("hex")}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as GooglePlaceResult;
  } catch { }

  return limiters.places(async () => {
    let placesKey: string;
    try {
      placesKey = await placesVault.acquireKey();
    } catch {
      return null;
    }

    const query = `${companyName}${region ? ` ${region}` : ""}`;
    const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
    url.searchParams.set("query", query);
    url.searchParams.set("key", placesKey);

    let res: Response;
    try {
      res = await fetch(url.toString(), { signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS) });
    } catch (err) {
      logger.warn({ err, companyName }, "[research.agent] Google Places network error");
      return null;
    }

    if (res.status === 401 || res.status === 403) {
      await placesVault.reportFailure(placesKey, res.status);
      throw new QuotaExhaustedError("Google Places", res.status);
    }
    if (res.status === 429) {
      await placesVault.reportFailure(placesKey, 429);
      throw new QuotaExhaustedError("Google Places", 429);
    }
    if (!res.ok) {
      logger.warn({ status: res.status, companyName }, "[research.agent] Google Places non-ok — skipping company");
      return null;
    }

    let data: { results?: GooglePlaceResult[]; status?: string };
    try {
      data = await res.json() as { results?: GooglePlaceResult[]; status?: string };
    } catch {
      return null;
    }

    if (data.status === "REQUEST_DENIED" || data.status === "INVALID_REQUEST") {
      throw new QuotaExhaustedError("Google Places", res.status);
    }

    const results = data.results ?? [];
    if (results.length === 0) return null;

    const normalizedExpected = expectedDomain?.toLowerCase() ?? null;
    if (normalizedExpected) {
      const matched = results.find((r) => extractDomain(r.website) === normalizedExpected);
      if (matched) {
        try { await redis.setex(cacheKey, PLACES_CACHE_TTL_S, JSON.stringify(matched)); } catch { }
        return matched;
      }
    }

    const result = results[0];
    try { await redis.setex(cacheKey, PLACES_CACHE_TTL_S, JSON.stringify(result)); } catch { }
    return result;
  });
}

async function searchWeb(query: string, limiters: ResearchRunLimiters): Promise<SerperResult[]> {
  const cacheKey = `serper:${createHash("md5").update(query).digest("hex")}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) return JSON.parse(cached) as SerperResult[];
  } catch { }

  return limiters.serper(async () => {
    let res: Response;
    try {
      res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "X-API-KEY": process.env.SERPER_API_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: query, num: 10 }),
        signal: AbortSignal.timeout(EXTERNAL_FETCH_TIMEOUT_MS),
      });
    } catch (err) {
      logger.warn({ err, query }, "[research.agent] Serper network error — skipping query");
      return [];
    }

    if (res.status === 401 || res.status === 403) {
      throw new QuotaExhaustedError("Serper", res.status);
    }
    if (res.status === 429) {
      throw new QuotaExhaustedError("Serper", 429);
    }
    if (!res.ok) {
      logger.warn({ status: res.status, query }, "[research.agent] Serper non-ok — skipping query");
      return [];
    }

    let data: { organic?: SerperResult[] };
    try {
      data = await res.json() as { organic?: SerperResult[] };
    } catch {
      return [];
    }

    const results = data.organic ?? [];
    try { await redis.setex(cacheKey, SERPER_CACHE_TTL_S, JSON.stringify(results)); } catch { }
    return results;
  });
}

const CURRENT_YEAR = new Date().getFullYear();

async function scoreAndQualifyLead(params: {
  contact: ApolloContact;
  placeData: GooglePlaceResult | null;
  companyWebResults: SerperResult[];
  icpWebContext: SerperResult[];
  icpDescription: string;
  campaignId: string;
}): Promise<ScoredLead> {
  const { contact, placeData, companyWebResults, icpWebContext, icpDescription, campaignId } =
    params;
  const companyName = contact.organization?.name ?? "Unknown";

  const { text } = await callGemini({
    agentName: "research.lead-scorer",
    model: MODELS.RESEARCH,
    systemPrompt: RESEARCH_SCORING_SYSTEM_PROMPT,
    userPrompt: `ICP: ${icpDescription}

Company: ${companyName}
Contact: ${contact.first_name ?? ""} ${contact.last_name ?? ""} — ${contact.title ?? "unknown title"
      }
Website: ${contact.organization?.website_url ?? "none"}
LinkedIn: ${contact.linkedin_url ?? "none"}
Google Places: ${placeData
        ? JSON.stringify({
          rating: placeData.rating,
          types: placeData.types,
          status: placeData.business_status,
        })
        : "not found"
      }
ICP Market Context (top 3 results for this target segment):
${icpWebContext
        .slice(0, 3)
        .map((r, i) => `${i + 1}. ${r.title}: ${r.snippet}`)
        .join("\n")}
Company Web Signals (top 5):
${companyWebResults
        .slice(0, 5)
        .map((r, i) => `${i + 1}. ${r.title}: ${r.snippet}`)
        .join("\n")}`,
    metadata: { campaignId, companyName },
    temperature: 0.3,
    responseMimeType: "application/json",
  });

  let scored: ResearchScoringResult;
  try {
    const raw = extractJSON<unknown>(text);
    scored = validateScoringResult(raw);
  } catch (firstParseErr) {
    logger.warn({ firstParseErr, companyName }, "[research.agent] Scoring parse failed — attempting self-correction");
    try {
      const { text: correctedText } = await callGemini({
        agentName: "research.lead-scorer-repair",
        model: MODELS.RESEARCH,
        systemPrompt: "You are a JSON repair assistant. The previous model output could not be parsed as valid JSON. Return ONLY a valid JSON object matching the required schema, with no markdown, no explanation, no code fences.",
        userPrompt: `Original malformed output:\n${text.slice(0, 2000)}\n\nParse error: ${firstParseErr instanceof Error ? firstParseErr.message : String(firstParseErr)}\n\nReturn the corrected JSON object only.`,
        metadata: { campaignId, companyName, repair: true },
        temperature: 0.0,
        responseMimeType: "application/json",
      });
      const raw = extractJSON<unknown>(correctedText);
      scored = validateScoringResult(raw);
    } catch (repairErr) {
      logger.error({ repairErr, companyName }, "[research.agent] Self-correction failed — marking lead as DISQUALIFY");
      scored = {
        qualificationScore: 0,
        qualificationReason: "Scoring output could not be parsed after self-correction attempt",
        breakdownScores: {} as BreakdownScores,
        evidenceTriggers: [],
        recommendedAction: "DISQUALIFY",
        signals: [],
      };
    }
  }

  const reasonWithTriggers = [
    scored.qualificationReason,
    scored.evidenceTriggers.length ? `Evidence: ${scored.evidenceTriggers.join(" | ")}` : null,
  ]
    .filter(Boolean)
    .join(" — ");

  return {
    companyName,
    website: contact.organization?.website_url,
    linkedinUrl: contact.linkedin_url,
    firstName: contact.first_name,
    lastName: contact.last_name,
    email: contact.email,
    title: contact.title,
    qualificationScore: scored.qualificationScore,
    qualificationReason: reasonWithTriggers,
    breakdownScores: scored.breakdownScores,
    recommendedAction: scored.recommendedAction,
    enrichmentData: {
      apolloId: contact.id,
      domain: contact.organization?.primary_domain,
      googlePlaces: placeData,
      webSignals: companyWebResults.slice(0, 5),
      icpMarketContext: icpWebContext.slice(0, 3),
    },
    signals: scored.signals.map((s) => ({
      ...s,
      source: placeData ? "google-places+serper" : "serper",
    })),
    apolloId: contact.id,
  };
}

async function loadDeduplicationSets(
  campaignId: string,
  userId: string,
  emails: string[],
  domains: string[],
  apolloIds: string[]
): Promise<DeduplicationSets> {
  const emailDomains = emails.map((e) => e.split("@")[1]).filter(Boolean) as string[];
  const allDomains = [...new Set([...emailDomains, ...domains])];

  const suppressionRows = await prisma.suppression.findMany({
    where: {
      userId,
      OR: [
        ...(emails.length > 0 ? [{ email: { in: emails } }] : []),
        ...(allDomains.length > 0 ? [{ domain: { in: allDomains } }] : []),
      ],
    },
    select: { email: true, domain: true },
  });

  const suppressedEmails = new Set(
    suppressionRows.map((s) => s.email).filter(Boolean) as string[]
  );
  const suppressedDomains = new Set(
    suppressionRows.map((s) => s.domain).filter(Boolean) as string[]
  );

  const existingLeads = await prisma.lead.findMany({
    where: {
      campaignId,
      deletedAt: null,
      OR: [
        ...(emails.length > 0 ? [{ email: { in: emails } }] : []),
        ...(apolloIds.length > 0 ? [{ externalId: { in: apolloIds } }] : []),
      ],
    },
    select: { email: true, externalId: true },
  });

  const existingEmailsInCampaign = new Set(
    existingLeads.map((l) => l.email).filter(Boolean) as string[]
  );
  const existingExternalIdsInCampaign = new Set(
    existingLeads.map((l) => l.externalId).filter(Boolean) as string[]
  );

  return {
    suppressedEmails,
    suppressedDomains,
    existingEmailsInCampaign,
    existingExternalIdsInCampaign,
  };
}

function isDuplicate(
  contact: ApolloContact,
  sets: DeduplicationSets,
  seenEmailsInBatch: Set<string>,
  seenApolloIdsInBatch: Set<string>
): { duplicate: boolean; reason: string } {
  const email = contact.email?.toLowerCase();
  const apolloId = contact.id;
  const orgDomain = contact.organization?.primary_domain?.toLowerCase();

  if (seenApolloIdsInBatch.has(apolloId))
    return { duplicate: true, reason: "intra-batch duplicate apolloId" };
  if (email && seenEmailsInBatch.has(email))
    return { duplicate: true, reason: "intra-batch duplicate email" };
  if (email && sets.suppressedEmails.has(email))
    return { duplicate: true, reason: "suppressed email" };
  if (email && sets.suppressedDomains.has(email.split("@")[1]))
    return { duplicate: true, reason: "suppressed domain" };
  if (orgDomain && sets.suppressedDomains.has(orgDomain))
    return { duplicate: true, reason: "suppressed domain" };
  if (email && sets.existingEmailsInCampaign.has(email))
    return { duplicate: true, reason: "email already in campaign" };
  if (sets.existingExternalIdsInCampaign.has(apolloId))
    return { duplicate: true, reason: "apolloId already in campaign" };

  return { duplicate: false, reason: "" };
}

export async function runResearchAgent(campaignId: string, leadId?: string): Promise<void> {
  assertEnv();

  const limiters = createResearchRunLimiters();

  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
  });
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const sequenceStepCount = await prisma.sequenceStep.count({
    where: { campaignId },
  });

  if (leadId) {
    logger.info({ campaignId, leadId }, "[research.agent] Running single lead research/enrichment");

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: { signals: true },
    });
    if (!lead) throw new Error(`Lead ${leadId} not found`);

    const icpWebQuery = `${campaign.icpDescription} companies ${campaign.targetRegion ?? ""} ${campaign.targetIndustry ?? ""}`.trim();

    let resolvedWebsite = lead.website;
    let resolvedDomain = lead.domain;
    let resolvedLinkedinUrl = lead.linkedinUrl;

    if (!resolvedWebsite && lead.companyName) {
      const websiteResults = await searchWeb(`"${lead.companyName}" official website`, limiters).catch(() => [] as SerperResult[]);
      const firstUrl = websiteResults.find((r) => r.link && !r.link.includes("linkedin.com"))?.link ?? null;
      if (firstUrl) {
        try {
          const parsed = new URL(firstUrl.startsWith("http") ? firstUrl : `https://${firstUrl}`);
          resolvedWebsite = parsed.origin;
          resolvedDomain = parsed.hostname.replace(/^www\./, "").toLowerCase();
          await prisma.lead.update({
            where: { id: leadId },
            data: { website: resolvedWebsite, domain: resolvedDomain },
          });
        } catch { }
      }
    }

    if (!resolvedLinkedinUrl && lead.firstName && lead.lastName && lead.companyName) {
      const liResults = await searchWeb(
        `site:linkedin.com/in/ "${lead.firstName} ${lead.lastName}" "${lead.companyName}"`,
        limiters
      ).catch(() => [] as SerperResult[]);
      const liUrl = liResults.find((r) => r.link?.includes("linkedin.com/in/"))?.link ?? null;
      if (liUrl) {
        resolvedLinkedinUrl = liUrl.replace(/\/(en|no|de|fr|es|pt|nl|it|sv|da|fi|nb|ru|zh|ja|ko|ar|he|tr|pl|cs|hu|ro|uk|bg|sk|hr|sl|et|lv|lt|sr|mk|sq|bs|ca|gl|eu)\/?$/, "").replace(/\/$/, "");
        await prisma.lead.update({ where: { id: leadId }, data: { linkedinUrl: resolvedLinkedinUrl } });
      }
    }

    const singleLeadWebQuery = resolvedDomain
      ? `"${lead.companyName}" "${resolvedDomain}" funding hiring news ${CURRENT_YEAR}`
      : `${lead.companyName} funding hiring news ${CURRENT_YEAR}`;

    const [rawPlaceData, companyWebResults, icpWebResults] = await Promise.all([
      lead.companyName
        ? enrichWithGooglePlaces(lead.companyName, resolvedDomain ?? undefined, campaign.targetRegion ?? undefined, limiters)
        : Promise.resolve(null),
      lead.companyName
        ? searchWeb(singleLeadWebQuery, limiters)
        : Promise.resolve([]),
      searchWeb(icpWebQuery, limiters),
    ]);

    const placeData = (() => {
      if (!rawPlaceData) return null;
      if (!resolvedDomain) return rawPlaceData;
      const placeDomain = extractDomain(rawPlaceData.website);
      return placeDomain && placeDomain !== resolvedDomain ? null : rawPlaceData;
    })();

    const contact: ApolloContact = {
      id: lead.externalId ?? lead.id,
      first_name: lead.firstName ?? undefined,
      last_name: lead.lastName ?? undefined,
      email: lead.email ?? undefined,
      title: lead.title ?? undefined,
      linkedin_url: resolvedLinkedinUrl ?? undefined,
      organization: {
        name: lead.companyName,
        website_url: resolvedWebsite ?? undefined,
        primary_domain: resolvedDomain ?? undefined,
      },
    };

    const scored = await scoreAndQualifyLead({
      contact,
      placeData,
      companyWebResults,
      icpWebContext: icpWebResults,
      icpDescription: campaign.icpDescription,
      campaignId,
    });

    const emailStatus = scored.email ? EMAIL_STATUS.FOUND : lead.emailStatus;
    const emailSource = scored.email ? EMAIL_SOURCE.APOLLO_SEARCH : lead.emailSource;

    await prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id: leadId },
        data: {
          qualificationScore: scored.qualificationScore,
          qualificationReason: scored.qualificationReason,
          breakdownScores: scored.breakdownScores as unknown as Prisma.InputJsonValue,
          recommendedAction: scored.recommendedAction,
          enrichmentData: scored.enrichmentData as Prisma.InputJsonValue,
          ...(scored.email && { email: scored.email, emailStatus, emailSource }),
        },
      });

      const validSignals = scored.signals.filter((s) => VALID_SIGNAL_TYPES.has(s.type));
      logDroppedSignals(
        { leadId },
        scored.signals.length,
        validSignals.length,
        scored.signals.filter((s) => !VALID_SIGNAL_TYPES.has(s.type)).map((s) => s.type)
      );
      if (validSignals.length > 0) {
        await tx.leadSignal.createMany({
          data: validSignals.map((s) => ({
            leadId,
            signalType: s.type as SignalType,
            value: s.value,
            confidence: s.confidence,
            source: s.source,
            explanation: s.explanation,
          })),
          skipDuplicates: true,
        });
      }
    });

    if (campaign.linkedInAccountId || sequenceStepCount > 0) {
      try {
        await initializeLeadSequence(leadId, campaignId);
      } catch (err) {
        logger.error(
          { err, leadId, campaignId },
          "[research.agent] Lead enriched but sequence initialization failed — needs manual retry"
        );
      }
    }

    const hasEmail = !!(scored.email || lead.email);
    if (!hasEmail) {
      enqueueEnrichmentBatches([leadId], campaignId).catch((err) =>
        logger.warn({ err, leadId, campaignId }, "[research.agent] Enrichment waterfall enqueue failed for single lead")
      );
    }

    logger.info({ leadId, campaignId }, "[research.agent] Single lead research/enrichment complete");
    return;
  }

  const allowedStatuses = ["RESEARCHING", "QUEUED", "SENDING", "GENERATING"];
  if (!allowedStatuses.includes(campaign.status)) {
    logger.warn(
      { campaignId, status: campaign.status },
      "[research.agent] Campaign status is not allowed for research — aborting"
    );
    return;
  }

  logger.info({ campaignId, campaignName: campaign.name }, "[research.agent] Starting research");

  const apolloLimit = Math.min(
    Math.max(150, campaign.dailySendLimit * 4),
    APOLLO_MAX_TOTAL_CONTACTS
  );

  const icpWebQuery =
    `${campaign.icpDescription} companies ${campaign.targetRegion ?? ""} ${campaign.targetIndustry ?? ""
      }`.trim();

  emitCampaignEvent({
    campaignId,
    type: "active",
    jobName: "run-research",
    label: "Research Agent",
    detail: "Searching Apollo & ICP context…",
    progress: 0,
  });

  let apolloContacts: ApolloContact[];
  let icpWebResults: SerperResult[];
  try {
    [apolloContacts, icpWebResults] = await Promise.race([
      Promise.all([
        searchApollo({
          icpDescription: campaign.icpDescription,
          targetIndustry: campaign.targetIndustry ?? undefined,
          targetRegion: campaign.targetRegion ?? undefined,
          limit: apolloLimit,
        }),
        searchWeb(icpWebQuery, limiters),
      ]),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`[research.agent] searchApollo+searchWeb timed out after ${APOLLO_SEARCH_TIMEOUT_MS / 1000}s — check Gemini/Apollo API health`)),
          APOLLO_SEARCH_TIMEOUT_MS
        )
      ),
    ]);
  } catch (err) {
    logger.error({ err, campaignId }, "[research.agent] Initial Apollo/web search failed");
    throw err;
  }

  logger.info({ count: apolloContacts.length }, "[research.agent] Apollo returned contacts");
  logger.info({ count: icpWebResults.length }, "[research.agent] ICP web context fetched");

  emitCampaignEvent({
    campaignId,
    type: "progress",
    jobName: "run-research",
    label: "Research Agent",
    detail: `Found ${apolloContacts.length} contacts from Apollo · scoring against ICP`,
    progress: 5,
  });

  if (apolloContacts.length === 0) {
    throw new Error(
      "Apollo returned zero contacts for the given ICP and filters. " +
      "Broaden the ICP description, remove restrictive employee ranges, or widen the target region."
    );
  }

  const contactsWithEmail = apolloContacts.filter((c) => c.email);
  const allEmails = contactsWithEmail.map((c) => c.email!.toLowerCase());
  const allApolloIds = apolloContacts.map((c) => c.id);
  const allOrgDomains = [
    ...new Set(
      apolloContacts
        .map((c) => c.organization?.primary_domain?.toLowerCase())
        .filter((d): d is string => !!d)
    ),
  ];

  const dedupSets = await loadDeduplicationSets(
    campaignId,
    campaign.createdById,
    allEmails,
    allOrgDomains,
    allApolloIds
  );

  const seenEmailsInBatch = new Set<string>();
  const seenApolloIdsInBatch = new Set<string>();
  let suppressedCount = 0;
  let crossRunDuplicateCount = 0;
  let intraBatchDuplicateCount = 0;
  const contactsToProcess: ApolloContact[] = [];

  for (const contact of apolloContacts) {
    const email = contact.email?.toLowerCase();
    const { duplicate, reason } = isDuplicate(
      contact,
      dedupSets,
      seenEmailsInBatch,
      seenApolloIdsInBatch
    );

    if (duplicate) {
      if (reason.startsWith("intra-batch")) intraBatchDuplicateCount++;
      else if (reason.includes("suppressed")) suppressedCount++;
      else crossRunDuplicateCount++;
      logger.debug(
        { contactId: contact.id, email, reason },
        "[research.agent] Contact skipped"
      );
      continue;
    }

    if (email) seenEmailsInBatch.add(email);
    seenApolloIdsInBatch.add(contact.id);
    contactsToProcess.push(contact);
  }

  logger.info(
    {
      total: apolloContacts.length,
      toProcess: contactsToProcess.length,
      suppressed: suppressedCount,
      crossRunDuplicates: crossRunDuplicateCount,
      intraBatchDuplicates: intraBatchDuplicateCount,
    },
    "[research.agent] Contacts after deduplication"
  );

  const CHUNK_SIZE = 5;
  const qualificationThreshold = resolveQualificationThreshold(campaign.qualificationThreshold);
  const persistCap = Math.max(1, campaign.dailySendLimit) * APOLLO_PERSIST_MULTIPLIER;

  let scoredCount = 0;
  let scoringFailureCount = 0;
  let placesEnrichmentMisses = 0;
  let webEnrichmentMisses = 0;
  const scoringTotal = contactsToProcess.length;

  let persistedCount = 0;
  let newlyCreatedCount = 0;
  let updatedCount = 0;
  let persistFailedCount = 0;
  let sequenceInitFailedCount = 0;
  const leadsNeedingEnrichment: string[] = [];

  for (let chunkStart = 0; chunkStart < contactsToProcess.length; chunkStart += CHUNK_SIZE) {
    if (persistedCount >= persistCap) break;

    if (chunkStart > 0 && chunkStart % (CHUNK_SIZE * 2) === 0) {
      await assertPauseGuard(campaignId);
    }

    const chunk = contactsToProcess.slice(chunkStart, chunkStart + CHUNK_SIZE);

    const chunkResults = await Promise.allSettled(
      chunk.map((contact) =>
        limiters.scoring(async () => {
          const companyName = contact.organization?.name ?? "";
          const contactDomain = contact.organization?.primary_domain?.toLowerCase() ?? null;

          const webQuery = contactDomain
            ? `"${companyName}" "${contactDomain}" funding hiring news ${CURRENT_YEAR}`
            : `${companyName} funding hiring news ${CURRENT_YEAR}`;

          const [rawPlaceData, companyWebResults] = await Promise.all([
            companyName
              ? enrichWithGooglePlaces(
                companyName,
                contactDomain ?? undefined,
                campaign.targetRegion ?? undefined,
                limiters
              ).catch(() => null)
              : Promise.resolve(null),
            companyName
              ? searchWeb(webQuery, limiters).catch(() => [] as SerperResult[])
              : Promise.resolve([]),
          ]);

          const placeData = (() => {
            if (!rawPlaceData) return null;
            if (!contactDomain) return rawPlaceData;
            const placeDomain = extractDomain(rawPlaceData.website);
            return placeDomain && placeDomain !== contactDomain ? null : rawPlaceData;
          })();

          if (!placeData) placesEnrichmentMisses++;
          if (companyWebResults.length === 0) webEnrichmentMisses++;

          return withRetry(() =>
            withTimeout(
              scoreAndQualifyLead({
                contact,
                placeData,
                companyWebResults,
                icpWebContext: icpWebResults,
                icpDescription: campaign.icpDescription,
                campaignId,
              }),
              LEAD_SCORE_TIMEOUT_MS
            )
          );
        })
      )
    );

    const chunkScored: ScoredLead[] = [];
    for (const r of chunkResults) {
      scoredCount++;
      if (r.status === "fulfilled") {
        chunkScored.push(r.value);
      } else {
        scoringFailureCount++;
        if (r.reason instanceof QuotaExhaustedError) throw r.reason;
        logger.error({ err: r.reason }, "[research.agent] Failed to score contact");
      }
    }

    const failureRate = scoringFailureCount / scoredCount;
    if (scoringFailureCount >= CHUNK_SIZE && failureRate > SCORING_FAILURE_RATE_THRESHOLD) {
      logger.warn(
        { campaignId, failureRate: `${(failureRate * 100).toFixed(1)}%`, scoredCount },
        "[research.agent] High scoring failure rate detected — proceeding with remaining contacts"
      );
    }

    emitCampaignEvent({
      campaignId,
      type: "progress",
      jobName: "run-research",
      label: "Research Agent",
      progress: Math.round((scoredCount / scoringTotal) * 80),
      detail: `Scored ${scoredCount}/${scoringTotal} · ${chunkScored.length} qualified`,
      count: persistedCount,
    });

    const chunkQualified = chunkScored
      .filter((l) => l.qualificationScore >= qualificationThreshold && persistedCount < persistCap)
      .sort((a, b) => b.qualificationScore - a.qualificationScore);

    const persistResults = await Promise.allSettled(
      chunkQualified.map((lead) =>
        limiters.persist(async () => {
          const emailStatus = lead.email ? EMAIL_STATUS.FOUND : EMAIL_STATUS.NOT_ATTEMPTED;
          const emailSource = lead.email ? EMAIL_SOURCE.APOLLO_SEARCH : null;

          const { record, wasCreated } = await prisma.$transaction(async (tx) => {
            const existingLead = await tx.lead.findUnique({
              where: { campaignId_externalId: { campaignId, externalId: lead.apolloId } },
              select: { id: true },
            });

            const createdNew = !existingLead;

            const recordResult = existingLead
              ? await tx.lead.update({
                  where: { campaignId_externalId: { campaignId, externalId: lead.apolloId } },
                  data: {
                    qualificationScore: lead.qualificationScore,
                    qualificationReason: lead.qualificationReason,
                    breakdownScores: lead.breakdownScores as unknown as Prisma.InputJsonValue,
                    recommendedAction: lead.recommendedAction,
                    enrichmentData: lead.enrichmentData as Prisma.InputJsonValue,
                    sequenceInitError: null,
                    ...(lead.email && { email: lead.email, emailStatus, emailSource }),
                  },
                })
              : await tx.lead.create({
                  data: {
                    campaignId,
                    companyName: lead.companyName,
                    website: lead.website,
                    linkedinUrl: lead.linkedinUrl,
                    firstName: lead.firstName,
                    lastName: lead.lastName,
                    email: lead.email,
                    title: lead.title,
                    qualificationScore: lead.qualificationScore,
                    qualificationReason: lead.qualificationReason,
                    breakdownScores: lead.breakdownScores as unknown as Prisma.InputJsonValue,
                    recommendedAction: lead.recommendedAction,
                    enrichmentData: lead.enrichmentData as Prisma.InputJsonValue,
                    source: "apollo",
                    externalId: lead.apolloId,
                    emailStatus,
                    emailSource,
                    emailVerified: false,
                  },
                });

            const validSignals = lead.signals.filter((s) => VALID_SIGNAL_TYPES.has(s.type));
            logDroppedSignals(
              { leadApolloId: lead.apolloId },
              lead.signals.length,
              validSignals.length,
              lead.signals.filter((s) => !VALID_SIGNAL_TYPES.has(s.type)).map((s) => s.type)
            );
            if (validSignals.length > 0) {
              await tx.leadSignal.createMany({
                data: validSignals.map((s) => ({
                  leadId: recordResult.id,
                  signalType: s.type as SignalType,
                  value: s.value,
                  confidence: s.confidence,
                  source: s.source,
                  explanation: s.explanation,
                })),
                skipDuplicates: true,
              });
            }

            return { record: recordResult, wasCreated: createdNew };
          });

          if (campaign.linkedInAccountId || sequenceStepCount > 0) {
            try {
              await initializeLeadSequence(record.id, campaignId);
              if ((await prisma.lead.findUnique({ where: { id: record.id }, select: { sequenceInitError: true } }))?.sequenceInitError) {
                await prisma.lead.update({ where: { id: record.id }, data: { sequenceInitError: null } });
              }
            } catch (seqErr) {
              sequenceInitFailedCount++;
              const errMsg = seqErr instanceof Error ? seqErr.message : String(seqErr);
              logger.error({ err: seqErr, leadId: record.id, campaignId }, "[research.agent] Sequence initialization failed");
              await prisma.lead.update({
                where: { id: record.id },
                data: { sequenceInitError: errMsg.slice(0, 500) },
              }).catch((dbErr) => logger.error({ dbErr, leadId: record.id }, "[research.agent] Failed to write sequenceInitError"));
            }
          }

          if (!lead.email) leadsNeedingEnrichment.push(record.id);

          return { wasCreated, companyName: record.companyName };
        })
      )
    );

    const chunkNewCompanies: string[] = [];
    for (const r of persistResults) {
      if (r.status === "fulfilled") {
        persistedCount++;
        if (r.value.wasCreated) {
          newlyCreatedCount++;
          if (r.value.companyName) chunkNewCompanies.push(r.value.companyName);
        } else {
          updatedCount++;
        }
      } else {
        persistFailedCount++;
        logger.error({ err: r.reason }, "[research.agent] Failed to persist lead");
      }
    }

    if (chunkNewCompanies.length > 0) {
      const sample = chunkNewCompanies.slice(0, 3).join(" · ");
      const overflow = chunkNewCompanies.length > 3 ? ` +${chunkNewCompanies.length - 3}` : "";
      emitCampaignEvent({
        campaignId,
        type: "progress",
        jobName: "run-research",
        label: "Research Agent",
        progress: Math.round(80 + (persistedCount / persistCap) * 20),
        detail: `Discovered ${sample}${overflow}`,
        count: persistedCount,
      });
    }
  }

  if (scoringTotal > 0) {
    const placesMissRate = placesEnrichmentMisses / scoringTotal;
    const webMissRate = webEnrichmentMisses / scoringTotal;
    logger.info(
      {
        scoringTotal,
        placesEnrichmentMisses,
        placesEnrichmentMissRate: Number(placesMissRate.toFixed(2)),
        webEnrichmentMisses,
        webEnrichmentMissRate: Number(webMissRate.toFixed(2)),
      },
      "[research.agent] Enrichment coverage for this run"
    );
    if (placesMissRate > ENRICHMENT_MISS_RATE_WARNING_THRESHOLD) {
      logger.warn(
        { placesEnrichmentMisses, scoringTotal },
        "[research.agent] Google Places enrichment missing for majority of contacts — check GOOGLE_PLACES_API_KEY / quota"
      );
    }
    if (webMissRate > ENRICHMENT_MISS_RATE_WARNING_THRESHOLD) {
      logger.warn(
        { webEnrichmentMisses, scoringTotal },
        "[research.agent] Serper web enrichment missing for majority of contacts — check SERPER_API_KEY / quota"
      );
    }
  }

  const qualificationRate = scoredCount > 0
    ? ((persistedCount / scoredCount) * 100).toFixed(1)
    : "0.0";
  logger.info(
    { qualificationRate: `${qualificationRate}%`, scored: scoredCount, persisted: persistedCount },
    "[research.agent] Qualification and persistence rate"
  );


  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "GENERATING" },
  });

  logger.info(
    {
      persisted: persistedCount,
      newlyCreated: newlyCreatedCount,
      updated: updatedCount,
      failed: persistFailedCount,
      sequenceInitFailed: sequenceInitFailedCount,
      enrichmentLeads: leadsNeedingEnrichment.length,
      total: scoredCount,
    },
    "[research.agent] Lead persistence complete"
  );

  emitCampaignEvent({
    campaignId,
    type: "completed",
    jobName: "run-research",
    label: "Research Agent",
    detail: `${persistedCount} leads persisted (${newlyCreatedCount} new)`,
  });

  logger.info({ campaignId }, "[research.agent] Done. Returning control to orchestrator.");

  if (leadsNeedingEnrichment.length > 0) {
    enqueueEnrichmentBatches(leadsNeedingEnrichment, campaignId).then((n) => {
      logger.info({ campaignId, enrichmentBatches: n }, "[research.agent] Enrichment batches queued");
    }).catch((err) => {
      logger.warn({ campaignId, err }, "[research.agent] Enrichment batch enqueue failed — leads will be enriched on next scheduled run");
    });
  }
}