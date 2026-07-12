import { callGemini, extractJSON, MODELS } from "@/app/api/src/modules/gemini/gemini.client";
import { logger } from "@/app/api/src/lib/logger";

export interface CompanySignals {
    valueProposition: string;
    targetCustomer: string;
    businessModel: "SaaS" | "Services" | "Marketplace" | "Other";
    techStack: string[];
    verticals: string[];
    keywords: string[];
    apolloTitles: string[];
    apolloIndustries: string[];
    employeeRanges: string[];
}

export interface ICPProfile {
    apolloIndustries: string[];
    employeeRanges: string[];
    keywords: string[];
    apolloTitles: string[];
    queryVariants: string[];
    excludeKeywords: string[];
}

const APOLLO_INDUSTRY_HINT = `"Computer Software","Information Technology and Services","Marketing and Advertising","Financial Services","Hospital & Health Care","Real Estate","Retail","Staffing and Recruiting","Management Consulting","Internet"`;
const EMPLOYEE_RANGE_HINT = `"1,10","11,50","51,200","201,500","501,1000","1001,5000"`;

const VALID_BUSINESS_MODELS = new Set(["SaaS", "Services", "Marketplace", "Other"]);

export const APOLLO_INDUSTRIES_ALLOWED = new Set([
    "Computer Software",
    "Information Technology and Services",
    "Marketing and Advertising",
    "Financial Services",
    "Hospital & Health Care",
    "Real Estate",
    "Retail",
    "Staffing and Recruiting",
    "Management Consulting",
    "Internet",
]);

export const APOLLO_EMPLOYEE_RANGES_ALLOWED = new Set([
    "1,10",
    "11,50",
    "51,200",
    "201,500",
    "501,1000",
    "1001,5000",
]);

const APOLLO_ENRICH_MAX_RETRIES = 3;
const APOLLO_ENRICH_RETRY_BASE = 1_500;
const APOLLO_ENRICH_RETRY_JITTER_MS = 400;

function toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((v): v is string => typeof v === "string" && v.length > 0);
}

function filterAgainstAllowlist(
    values: string[],
    allowed: Set<string>,
    fieldName: string,
    context: Record<string, unknown>,
): string[] {
    const valid: string[] = [];
    const rejected: string[] = [];

    for (const v of values) {
        if (allowed.has(v)) {
            valid.push(v);
        } else {
            rejected.push(v);
        }
    }

    if (rejected.length > 0) {
        logger.warn(
            { ...context, field: fieldName, rejected },
            "[lookalike.signals] Dropped values outside Apollo allowlist",
        );
    }

    return valid;
}

function validateCompanySignals(raw: unknown, context: Record<string, unknown>): CompanySignals {
    if (!raw || typeof raw !== "object") {
        logger.warn({ ...context, raw }, "[lookalike.signals] Gemini returned non-object — using empty defaults");
        raw = {};
    }

    const candidate = raw as Record<string, unknown>;
    const warnings: string[] = [];

    const valueProposition = typeof candidate.valueProposition === "string" ? candidate.valueProposition : "";
    if (!valueProposition) warnings.push("valueProposition missing or not a string");

    const targetCustomer = typeof candidate.targetCustomer === "string" ? candidate.targetCustomer : "";
    if (!targetCustomer) warnings.push("targetCustomer missing or not a string");

    let businessModel: CompanySignals["businessModel"] = "Other";
    if (typeof candidate.businessModel === "string" && VALID_BUSINESS_MODELS.has(candidate.businessModel)) {
        businessModel = candidate.businessModel as CompanySignals["businessModel"];
    } else {
        warnings.push(`businessModel invalid (${JSON.stringify(candidate.businessModel)}) — defaulted to "Other"`);
    }

    const signals: CompanySignals = {
        valueProposition,
        targetCustomer,
        businessModel,
        techStack: toStringArray(candidate.techStack),
        verticals: toStringArray(candidate.verticals),
        keywords: toStringArray(candidate.keywords),
        apolloTitles: toStringArray(candidate.apolloTitles),
        apolloIndustries: filterAgainstAllowlist(
            toStringArray(candidate.apolloIndustries),
            APOLLO_INDUSTRIES_ALLOWED,
            "apolloIndustries",
            context,
        ),
        employeeRanges: filterAgainstAllowlist(
            toStringArray(candidate.employeeRanges),
            APOLLO_EMPLOYEE_RANGES_ALLOWED,
            "employeeRanges",
            context,
        ),
    };

    if (warnings.length > 0) {
        logger.warn({ ...context, warnings }, "[lookalike.signals] CompanySignals validation applied defaults");
    }

    return signals;
}

function validateICPProfile(raw: unknown, context: Record<string, unknown>): ICPProfile {
    if (!raw || typeof raw !== "object") {
        logger.warn({ ...context, raw }, "[lookalike.icp] Gemini returned non-object — using empty defaults");
        raw = {};
    }

    const candidate = raw as Record<string, unknown>;
    const warnings: string[] = [];

    const apolloIndustries = filterAgainstAllowlist(
        toStringArray(candidate.apolloIndustries),
        APOLLO_INDUSTRIES_ALLOWED,
        "apolloIndustries",
        context,
    );
    if (apolloIndustries.length === 0) warnings.push("apolloIndustries empty or all values outside allowlist");

    const employeeRanges = filterAgainstAllowlist(
        toStringArray(candidate.employeeRanges),
        APOLLO_EMPLOYEE_RANGES_ALLOWED,
        "employeeRanges",
        context,
    );
    if (employeeRanges.length === 0) warnings.push("employeeRanges empty or all values outside allowlist");

    const queryVariants = toStringArray(candidate.queryVariants);
    if (queryVariants.length === 0) warnings.push("queryVariants empty — Apollo search will have nothing to run");

    const profile: ICPProfile = {
        apolloIndustries,
        employeeRanges,
        keywords: toStringArray(candidate.keywords),
        apolloTitles: toStringArray(candidate.apolloTitles),
        queryVariants,
        excludeKeywords: toStringArray(candidate.excludeKeywords),
    };

    if (warnings.length > 0) {
        logger.warn({ ...context, warnings }, "[lookalike.icp] ICPProfile validation applied defaults");
    }

    return profile;
}

export async function extractSignals(
    url: string,
    scrapedText: string
): Promise<CompanySignals> {
    const { text } = await callGemini({
        agentName: "lookalike.signal-extractor",
        model: MODELS.RESEARCH,
        systemPrompt: `Extract B2B targeting signals from a company website. Return ONLY valid JSON with no markdown or preamble. Apollo industry values (pick from): ${APOLLO_INDUSTRY_HINT}. Apollo employee ranges (pick from): ${EMPLOYEE_RANGE_HINT}.`,
        userPrompt: `URL: ${url}
Content:
${scrapedText}

JSON schema:
{
  "valueProposition": string,
  "targetCustomer": string,
  "businessModel": "SaaS"|"Services"|"Marketplace"|"Other",
  "techStack": string[],
  "verticals": string[],
  "keywords": string[],
  "apolloTitles": string[],
  "apolloIndustries": string[],
  "employeeRanges": string[]
}`,
        temperature: 0.2,
        metadata: { url },
    });

    const parsed = extractJSON<unknown>(text);
    return validateCompanySignals(parsed, { url, source: "website-extraction" });
}

// ─── Apollo organisation-level enrichment ────────────────────────────────────

interface ApolloEnrichOrg {
    name?: string;
    website_url?: string;
    industry?: string;
    industries?: string[];
    keywords?: string[];
    estimated_num_employees?: number;
    short_description?: string;
    long_description?: string;
    technology_names?: string[];
    primary_domain?: string;
}

async function fetchApolloEnrichment(domain: string, apiKey: string): Promise<ApolloEnrichOrg | null> {
    let lastErr: Error | null = null;

    for (let attempt = 1; attempt <= APOLLO_ENRICH_MAX_RETRIES; attempt++) {
        let res: Response;
        try {
            res = await fetch(
                `https://api.apollo.io/api/v1/organizations/enrich?domain=${encodeURIComponent(domain)}`,
                {
                    headers: { "X-Api-Key": apiKey, "Cache-Control": "no-cache" },
                    signal: AbortSignal.timeout(8_000),
                }
            );
        } catch (err) {
            lastErr = err instanceof Error ? err : new Error(String(err));
            if (attempt < APOLLO_ENRICH_MAX_RETRIES) {
                const delay = APOLLO_ENRICH_RETRY_BASE * 2 ** (attempt - 1) + Math.random() * APOLLO_ENRICH_RETRY_JITTER_MS;
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            logger.warn({ domain, err: lastErr }, "[lookalike.enrich] Apollo enrich request failed after retries");
            return null;
        }

        if (res.status === 404 || res.status === 422) {
            logger.info({ domain }, "[lookalike.enrich] No Apollo record for domain");
            return null;
        }

        if (res.status === 429 || res.status >= 500) {
            if (attempt < APOLLO_ENRICH_MAX_RETRIES) {
                logger.warn(
                    { domain, status: res.status, attempt },
                    "[lookalike.enrich] Transient Apollo enrich error — retrying"
                );
                const delay = APOLLO_ENRICH_RETRY_BASE * 2 ** (attempt - 1) + Math.random() * APOLLO_ENRICH_RETRY_JITTER_MS;
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            logger.warn({ domain, status: res.status }, "[lookalike.enrich] Apollo enrich non-OK after retries");
            return null;
        }

        if (!res.ok) {
            logger.warn({ domain, status: res.status }, "[lookalike.enrich] Apollo enrich non-OK");
            return null;
        }

        const json = (await res.json()) as { organization?: ApolloEnrichOrg };
        return json.organization ?? null;
    }

    logger.warn({ domain, err: lastErr }, "[lookalike.enrich] Apollo enrich failed after retries");
    return null;
}

export async function enrichCompanyViaApollo(
    domain: string,
    metadata: { campaignId?: string; url?: string } = {}
): Promise<CompanySignals | null> {
    const apiKey = process.env.APOLLO_API_KEY;
    if (!apiKey) {
        logger.warn("[lookalike.enrich] APOLLO_API_KEY not set — skipping Apollo enrichment");
        return null;
    }

    const org = await fetchApolloEnrichment(domain, apiKey);

    if (!org || (!org.name && !org.short_description && !org.long_description)) {
        logger.info({ domain }, "[lookalike.enrich] Apollo returned empty record");
        return null;
    }

    const firmographic = JSON.stringify({
        name: org.name,
        domain: org.primary_domain ?? domain,
        industry: org.industry,
        industries: org.industries,
        keywords: org.keywords,
        employees: org.estimated_num_employees,
        summary: org.short_description ?? org.long_description,
        tech: org.technology_names,
    });

    try {
        const { text } = await callGemini({
            agentName: "lookalike.apollo-enrich",
            model: MODELS.RESEARCH,
            systemPrompt: `Convert Apollo firmographic data into B2B targeting signals. Return ONLY valid JSON with no markdown or preamble. Apollo industry values (pick from): ${APOLLO_INDUSTRY_HINT}. Apollo employee ranges (pick from): ${EMPLOYEE_RANGE_HINT}.`,
            userPrompt: `Apollo data for ${domain}:\n${firmographic}\n\nJSON schema:\n{\n  "valueProposition": string,\n  "targetCustomer": string,\n  "businessModel": "SaaS"|"Services"|"Marketplace"|"Other",\n  "techStack": string[],\n  "verticals": string[],\n  "keywords": string[],\n  "apolloTitles": string[],\n  "apolloIndustries": string[],\n  "employeeRanges": string[]\n}`,
            temperature: 0.15,
            metadata: { ...metadata, domain, source: "apollo-enrich" },
        });

        const parsed = extractJSON<unknown>(text);
        const signals = validateCompanySignals(parsed, { ...metadata, domain, source: "apollo-enrich" });
        logger.info({ domain }, "[lookalike.enrich] Apollo enrichment succeeded");
        return signals;
    } catch (err) {
        logger.warn({ domain, err }, "[lookalike.enrich] Gemini formatting of Apollo data failed");
        return null;
    }
}

export async function extractSignalsViaParametricKnowledge(
    url: string,
    metadata: { campaignId?: string } = {}
): Promise<CompanySignals | null> {
    try {
        const { text } = await callGemini({
            agentName: "lookalike.parametric-fallback",
            model: MODELS.RESEARCH,
            systemPrompt: `You are a B2B sales research expert with deep knowledge of technology companies. Extract B2B targeting signals for a company URL using your training knowledge. Return ONLY valid JSON with no markdown or preamble. Apollo industry values (pick from): ${APOLLO_INDUSTRY_HINT}. Apollo employee ranges (pick from): ${EMPLOYEE_RANGE_HINT}. IMPORTANT: If you do not recognise the company or cannot confidently infer its signals, return null instead of a JSON object.`,
            userPrompt: `Company URL: ${url}\n\nUsing your knowledge of this company, return the following JSON schema (or null if you do not recognise this company):\n{\n  "valueProposition": string,\n  "targetCustomer": string,\n  "businessModel": "SaaS"|"Services"|"Marketplace"|"Other",\n  "techStack": string[],\n  "verticals": string[],\n  "keywords": string[],\n  "apolloTitles": string[],\n  "apolloIndustries": string[],\n  "employeeRanges": string[]\n}`,
            temperature: 0.2,
            metadata: { ...metadata, url, source: "parametric-fallback" },
        });

        const trimmed = text.trim();
        if (trimmed === "null" || trimmed === "") {
            logger.info({ url }, "[lookalike.parametric] Gemini does not recognise this company");
            return null;
        }

        const parsed = extractJSON<unknown>(text);
        if (parsed === null) {
            logger.info({ url }, "[lookalike.parametric] Gemini does not recognise this company");
            return null;
        }

        const signals = validateCompanySignals(parsed, { ...metadata, url, source: "parametric-fallback" });
        logger.info({ url }, "[lookalike.parametric] Parametric fallback succeeded");
        return signals;
    } catch (err) {
        logger.warn({ url, err }, "[lookalike.parametric] Parametric fallback failed");
        return null;
    }
}

export async function synthesiseICP(signals: CompanySignals[]): Promise<ICPProfile> {
    const { text } = await callGemini({
        agentName: "lookalike.icp-synthesiser",
        model: MODELS.RESEARCH,
        systemPrompt: `You are a B2B sales targeting expert. Given signals from a user's best clients, synthesise a unified ICP for Apollo search. Return ONLY valid JSON with no markdown or preamble.`,
        userPrompt: `Client signals (${signals.length} companies):
${JSON.stringify(signals, null, 2)}

JSON schema:
{
  "apolloIndustries": string[],
  "employeeRanges": string[],
  "keywords": string[],
  "apolloTitles": string[],
  "queryVariants": string[],
  "excludeKeywords": string[]
}

queryVariants rules — each from a different angle, max 5:
1. Core product or service category
2. Target buyer type
3. Tech or methodology angle
4. Problem the client solves
5. Business model or revenue motion`,
        temperature: 0.3,
        metadata: { signalCount: signals.length },
    });

    const parsed = extractJSON<unknown>(text);
    return validateICPProfile(parsed, { signalCount: signals.length, source: "icp-synthesis" });
}