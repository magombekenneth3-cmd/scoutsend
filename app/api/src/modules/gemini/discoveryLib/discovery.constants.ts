export const APOLLO_SEARCH_PER_PAGE = 25;
export const APOLLO_MAX_PAGES = 4;
export const APOLLO_PAGE_CONCURRENCY = 2;
export const APOLLO_INTERPAGE_DELAY_MS = 2_000;
export const APOLLO_FAILED_PAGE_RETRY_DELAY_MS = 3_000;
export const APOLLO_CONFIDENCE = 0.82;

export const BUILTWITH_MIN_TECH_COUNT = 2;
export const BUILTWITH_CONCURRENCY = 3;
export const BUILTWITH_CONFIDENCE = 0.9;

export const FALLBACK_CONCURRENCY = 3;
export const MIN_DISCOVERY_CONFIDENCE = 0.6;
export const EXTERNAL_FETCH_TIMEOUT_MS = 12_000;
export const GEMINI_FALLBACK_COMPANY_COUNT = 15;
export const SCORE_BATCH_SIZE = 20;

export const DISCOVERY_GATE_FLOOR = 0.40;

export const RETRY_MAX_ATTEMPTS = 4;
export const RETRY_BASE_DELAY_MS = 500;

export const ATS_ROLE_TITLES_COUNT = 5;
export const ATS_QUERIES_PER_RUN = 3;
export const ATS_NON_CONFIRMED_CONFIDENCE_CAP = 0.70;
export const DEFAULT_SOURCE_WEIGHT = 0.65;

export const CACHE_TTL_TITLE_INFERENCE_S = 60 * 60 * 6;
export const CACHE_TTL_ATS_INGREDIENTS_S = 60 * 60 * 6;
export const CACHE_TTL_BUILTWITH_S = 60 * 60 * 24;
export const CACHE_NULL_SENTINEL = "__null__";

export const CB_FAILURE_THRESHOLD = 5;
export const CB_RESET_MS = 60_000;
export const CB_TTL_S = 300;

export const CHECKPOINT_TTL_S = 60 * 60 * 4;
export const CHECKPOINT_LEAD_INTERVAL = 100;
export const CHECKPOINT_TIME_INTERVAL_MS = 30_000;

export const INSERT_CHUNK_SIZE = 100;

export const QUALIFICATION_WEIGHT = 0.70;
export const DISCOVERY_CONFIDENCE_WEIGHT = 0.20;
export const SOURCE_WEIGHT_CONTRIBUTION = 0.10;

export const SOURCE_WEIGHTS: Readonly<Record<string, number>> = {
    apollo_search: 1.00,
    job_posting: 0.92,
    funding_news: 0.88,
    web_intelligence: 0.75,
    gemini_fallback: 0.60,
};

export const ATS_DOMAINS: Readonly<Set<string>> = new Set([
    "lever.co",
    "greenhouse.io",
    "jobs.ashbyhq.com",
    "myworkdayjobs.com",
    "smartrecruiters.com",
    "bamboohr.com",
    "jobvite.com",
    "teamtailor.com",
    "recruitee.com",
    "workable.com",
]);

export const ATS_SITE_CLAUSE =
    "(site:lever.co OR site:greenhouse.io OR site:jobs.ashbyhq.com OR " +
    "site:myworkdayjobs.com OR site:smartrecruiters.com OR site:bamboohr.com OR " +
    "site:jobvite.com OR site:teamtailor.com OR site:recruitee.com OR site:workable.com)";
