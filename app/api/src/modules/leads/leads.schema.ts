import { z } from "zod";

export const LEAD_SOURCES = [
  "apollo",
  "csv_import",
  "manual",
  "crunchbase",
  "linkedin",
  "g2",
  "capterra",
  "wellfound",
  "product_hunt",
  "github",
  "builtwith",
  "tech_detection",
  "google_maps",
  "yelp",
  "reddit",
  "hacker_news",
  "stack_overflow",
  "indie_hackers",
  "indeed",
  "job_intel",
  "web_intelligence",
  "funding_news",
] as const;

export type LeadSource = (typeof LEAD_SOURCES)[number];

function coerceUrl(val: string | null | undefined): string | undefined {
  if (!val) return undefined;
  if (/^https?:\/\//i.test(val)) return val;
  return `https://${val}`;
}

const urlField = z
  .string()
  .optional()
  .transform((v) => coerceUrl(v));

const nullableUrlField = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v ? coerceUrl(v) : null));

export const createLeadSchema = z.object({
  companyName: z.string().min(1),
  website: urlField,
  linkedinUrl: urlField,
  email: z.string().email().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  title: z.string().optional(),
  campaignId: z.string().min(1),
  source: z.enum(LEAD_SOURCES).optional(),
  externalId: z.string().optional(),
});

export const updateLeadSchema = z
  .object({
    companyName: z.string().min(1),
    website: nullableUrlField,
    linkedinUrl: nullableUrlField,
    email: z.string().email().nullable(),
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    title: z.string().nullable(),
    qualificationScore: z.number().min(0).max(100).nullable(),
    qualificationReason: z.string().nullable(),
    enrichmentData: z.record(z.string(), z.unknown()).nullable(),
    source: z.enum(LEAD_SOURCES).nullable(),
    externalId: z.string().nullable(),
  })
  .partial();

export const getLeadsQuerySchema = z.object({
  campaignId: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().optional(),
  source: z.enum(LEAD_SOURCES).optional(),
  competitorSignal: z
    .string()
    .optional()
    .transform((v) => (v === "true" ? true : v === "false" ? false : undefined)),
});