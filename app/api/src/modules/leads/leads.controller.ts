import { createHash } from "crypto";
import { Response, NextFunction } from "express";
import { z } from "zod";
import { parse as parseCsv } from "csv-parse/sync";
import { Prisma } from "@prisma/client";
import { AuthenticatedRequest } from "../auth/auth.types";
import * as LeadService from "./leads.service";
import { createLeadSchema, updateLeadSchema, getLeadsQuerySchema } from "./leads.schema";
import { logAudit } from "../audit/audit.service";
import { AUDIT_EVENTS } from "../../lib/constants";
import { assertCampaignAccess } from "../../lib/ownership";
import { ValidationError } from "../../lib/errors";
import { HttpError } from "../../lib/errors/http-error";
import { prisma } from "../../lib/prisma";
import { leadScoringQueue, realtimeQueue } from "../gemini/campaign.queue";
import { logger } from "../../lib/logger";
import { emailEnrichmentQueue } from "../gemini/email-enrichment.queue";
import { runEnrichmentWaterfall } from "../gemini/enrichment-waterfall.agent";
import { generateLeadResearchCard } from "../gemini/lead-research.agent";
import { generateDiscoveryScript } from "../gemini/discovery-script.agent";
import { generateSingleOutreachMessage } from "../gemini/generate.agent";
import { getRecentLeadJourney, summarizeLeadJourney } from "../../lib/leads/lead-journey.service";
import { CacheService } from "../../lib/cache";
import { initializeLeadSequence } from "../gemini/linkedin-outreach.agent";
import { batchApproveMessages } from "../messages/message.service";
import { revokeConsent } from "../consents/consents.service";
import { runBatchLeadScoringAgent } from "../gemini/lead-scoring.agent";
import { extractDomain } from "../../lib/company/company.upsert";
import { fetchCompanyNameFromWebsite } from "../../lib/website-email-discovery";
import pLimit from "p-limit";

const EU_COUNTRY_CODES = new Set([
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI",
  "FR", "GR", "HR", "HU", "IE", "IT", "LT", "LU", "LV", "MT",
  "NL", "PL", "PT", "RO", "SE", "SI", "SK",
  "IS", "LI", "NO",
  "GB",
]);

const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  "GERMANY": "DE", "FRANCE": "FR", "SPAIN": "ES", "ITALY": "IT",
  "NETHERLANDS": "NL", "BELGIUM": "BE", "AUSTRIA": "AT", "SWEDEN": "SE",
  "DENMARK": "DK", "FINLAND": "FI", "IRELAND": "IE", "PORTUGAL": "PT",
  "POLAND": "PL", "GREECE": "GR", "CZECH REPUBLIC": "CZ", "CZECHIA": "CZ",
  "HUNGARY": "HU", "ROMANIA": "RO", "BULGARIA": "BG", "CROATIA": "HR",
  "SLOVAKIA": "SK", "SLOVENIA": "SI", "ESTONIA": "EE", "LATVIA": "LV",
  "LITHUANIA": "LT", "LUXEMBOURG": "LU", "MALTA": "MT", "CYPRUS": "CY",
  "ICELAND": "IS", "LIECHTENSTEIN": "LI", "NORWAY": "NO",
  "UNITED KINGDOM": "GB", "GREAT BRITAIN": "GB", "UK": "GB",
};

const VALID_GDPR_BASES = new Set([
  "EXPLICIT_CONSENT",
  "EXISTING_BUSINESS_RELATIONSHIP",
  "LEGITIMATE_INTEREST",
]);

function resolveCountryCode(raw: string | undefined): string | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (upper.length === 2) return upper;
  return COUNTRY_NAME_TO_CODE[upper] ?? null;
}

function isEuLead(countryCode: string | null): boolean {
  return countryCode !== null && EU_COUNTRY_CODES.has(countryCode);
}


const BULK_ENRICH_MAX = 100;

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_CSV_ROWS = 5_000;
const BATCH_SIZE = 100;

const HEADER_ALIASES: Record<string, string> = {
  company: "companyName",
  company_name: "companyName",
  "company name": "companyName",
  companyname: "companyName",
  organization: "companyName",
  organisation: "companyName",
  org: "companyName",
  firm: "companyName",
  account: "companyName",
  account_name: "companyName",
  "account name": "companyName",

  first_name: "firstName",
  "first name": "firstName",
  firstname: "firstName",
  first: "firstName",
  given_name: "firstName",
  "given name": "firstName",
  forename: "firstName",

  last_name: "lastName",
  "last name": "lastName",
  lastname: "lastName",
  last: "lastName",
  surname: "lastName",
  family_name: "lastName",
  "family name": "lastName",

  name: "fullName",
  "full name": "fullName",
  fullname: "fullName",
  person_name: "fullName",
  "person name": "fullName",
  lead_name: "fullName",
  "lead name": "fullName",

  email_address: "email",
  "email address": "email",
  emailaddress: "email",
  mail: "email",
  "e-mail": "email",
  e_mail: "email",

  job_title: "title",
  "job title": "title",
  jobtitle: "title",
  position: "title",
  role: "title",
  occupation: "title",
  designation: "title",

  // Google Maps / Apify scraper exports use "title" for the business name
  title: "companyName",
  business_name: "companyName",
  "business name": "companyName",
  businessname: "companyName",
  place_name: "companyName",
  "place name": "companyName",

  // NOTE: bare "url" is intentionally NOT mapped to website because
  // Google Maps CSVs put the Maps URL in "url" while the real company
  // website lives in a separate "website" column.
  "website url": "website",
  website_url: "website",
  web: "website",
  domain: "website",
  company_domain: "website",
  "company domain": "website",
  company_website: "website",
  "company website": "website",
  site: "website",

  linkedin: "linkedinUrl",
  linkedin_url: "linkedinUrl",
  "linkedin url": "linkedinUrl",
  "linkedin profile": "linkedinUrl",
  linkedin_profile: "linkedinUrl",
  person_linkedin_url: "linkedinUrl",

  consent_basis: "consentBasis",
  "consent basis": "consentBasis",
  consentbasis: "consentBasis",
  gdpr_consent: "consentBasis",
  "gdpr consent": "consentBasis",

  country: "country",
  country_code: "country",
  "country code": "country",
  countrycode: "country",       // Google Maps / Apify
  nation: "country",
  location: "country",

  // Google Maps / Apify exports also have phoneUnformatted (E.164)
  phoneunformatted: "phone",
  phone_unformatted: "phone",
  "phone unformatted": "phone",
};


function normalizeHeaders(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    const cleanedKey = k.replace(/^\uFEFF/, "").replace(/[^\x20-\x7E]/g, "").trim();
    const normalized = cleanedKey.toLowerCase();
    const canonical = HEADER_ALIASES[normalized] ?? cleanedKey;
    out[canonical] = typeof v === "string" ? v.trim() : v;
  }

  if (out.fullName && !out.firstName) {
    const parts = out.fullName.trim().split(/\s+/);
    out.firstName = parts[0];
    if (parts.length > 1 && !out.lastName) {
      out.lastName = parts.slice(1).join(" ");
    }
  }

  return out;
}

// ── Canonical lead fields exposed to the mapping UI ──────────────────────────
export const CANONICAL_FIELD_LABELS: Record<string, string> = {
  firstName: "First Name",
  lastName: "Last Name",
  fullName: "Full Name (auto-split → first + last)",
  email: "Email",
  companyName: "Company Name",
  title: "Job Title",
  website: "Website",
  linkedinUrl: "LinkedIn URL",
  phone: "Phone",
  department: "Department",
  seniority: "Seniority",
};

// Apply user-provided column → field mappings to a raw CSV row.
// Keys are original CSV column names; values are canonical lead field names
// or "ignore" to discard the column.
function applyFieldMappings(
  row: Record<string, string>,
  mappings: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [csvCol, leadField] of Object.entries(mappings)) {
    if (!leadField || leadField === "ignore") continue;
    const val = row[csvCol];
    if (val !== undefined) {
      const cleaned = typeof val === "string" ? val.trim() : String(val ?? "").trim();
      if (cleaned) out[leadField] = cleaned;
    }
  }
  // Split fullName into firstName + lastName if not already provided
  if (out.fullName) {
    const parts = out.fullName.trim().split(/\s+/);
    if (!out.firstName) out.firstName = parts[0] ?? "";
    if (!out.lastName && parts.length > 1) out.lastName = parts.slice(1).join(" ");
    delete out.fullName;
  }
  return out;
}

function deriveCompanyName(website?: string | null, email?: string | null): string | null {
  const domain = extractDomain(website) || (email ? email.split("@")[1]?.toLowerCase() : null);
  if (!domain) return null;
  const namePart = domain.split(".")[0];
  if (!namePart) return domain;
  return namePart
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

const csvRowSchema = z
  .object({
    companyName: z
      .string()
      .trim()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    email: z
      .string()
      .optional()
      .or(z.literal("").transform(() => undefined))
      .transform((v) => {
        if (!v) return undefined;
        const cleaned = v.trim().toLowerCase();
        return cleaned || undefined;
      })
      .refine((v) => !v || z.string().email().safeParse(v).success, {
        message: "Invalid email format",
      }),
    firstName: z
      .string()
      .trim()
      .min(1)
      .optional()
      .or(z.literal("").transform(() => undefined)),
    lastName: z
      .string()
      .trim()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    title: z
      .string()
      .trim()
      .optional()
      .or(z.literal("").transform(() => undefined)),
    website: z
      .string()
      .trim()
      .optional()
      .or(z.literal("").transform(() => undefined))
      .transform((v) => {
        if (!v) return undefined;
        const lower = v.toLowerCase();
        if (["n/a", "none", "-", "null", "undefined"].includes(lower)) return undefined;
        // Discard Google Maps URLs — they are not company websites
        if (/google\.com\/maps/i.test(v)) return undefined;
        if (/^https?:\/\//i.test(v)) return v;
        return `https://${v}`;
      }),
    linkedinUrl: z
      .string()
      .trim()
      .optional()
      .or(z.literal("").transform(() => undefined))
      .transform((v) => {
        if (!v) return undefined;
        const lower = v.toLowerCase();
        if (["n/a", "none", "-", "null", "undefined"].includes(lower)) return undefined;
        if (/^https?:\/\//i.test(v)) return v;
        return `https://${v}`;
      }),
    country: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
    consentBasis: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
    phone: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
    department: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
    seniority: z.string().trim().optional().or(z.literal("").transform(() => undefined)),
  })
  .transform((data) => {
    const companyName = data.companyName || deriveCompanyName(data.website, data.email) || undefined;
    return {
      ...data,
      companyName,
    };
  })
  .superRefine((data, ctx) => {
    if (!data.companyName) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["companyName"],
        message: "Company name is required or must be resolvable from website/email",
      });
    }
  });

function getIp(req: AuthenticatedRequest): string | undefined {
  return req.ip ?? undefined;
}

function getUserAgent(req: AuthenticatedRequest): string | undefined {
  const ua = req.headers["user-agent"];
  return Array.isArray(ua) ? ua[0] : ua;
}

export async function createLead(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = createLeadSchema.parse(req.body);
    await assertCampaignAccess(data.campaignId, req.user!.userId, req.user!.orgId);
    const lead = await LeadService.createLead(data);
    await CacheService.invalidateVersioned(`version:campaign:${lead.campaignId}`);
    await logAudit({
      userId: req.user!.userId,
      action: AUDIT_EVENTS.LEAD_CREATED,
      entityType: "Lead",
      entityId: lead.id,
      metadata: { campaignId: lead.campaignId },
      ipAddress: getIp(req),
      userAgent: getUserAgent(req),
    });
    res.status(201).json(lead);
  } catch (error) {
    next(error);
  }
}

// ── Shared CSV buffer reader ──────────────────────────────────────────────────
async function readCsvBuffer(req: AuthenticatedRequest): Promise<Buffer> {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  if (req.body && typeof req.body === "object" && Buffer.isBuffer((req.body as any).file)) {
    return (req.body as any).file as Buffer;
  }
  return new Promise<Buffer>((resolve, reject) => {
    if (req.readableEnded) { resolve(Buffer.alloc(0)); return; }
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > MAX_CSV_BYTES) {
        reject(new ValidationError(`CSV exceeds ${MAX_CSV_BYTES / 1024 / 1024}MB limit`));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

const CSV_PARSE_OPTIONS = {
  columns: true,
  skip_empty_lines: true,
  trim: true,
  bom: true,
  relax_column_count: true,
  relax_quotes: true,
} as const;

// ── Detect columns & suggest mappings (step 1 of the import flow) ────────────
export async function detectCsvColumns(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const raw = await readCsvBuffer(req);
    if (raw.length === 0) {
      res.status(400).json({ error: "Empty file" });
      return;
    }

    let rows: Record<string, string>[];
    try {
      rows = parseCsv(raw, CSV_PARSE_OPTIONS) as Record<string, string>[];
    } catch {
      res.status(400).json({ error: "Invalid CSV format" });
      return;
    }

    if (rows.length === 0) {
      res.status(400).json({ error: "CSV has no data rows" });
      return;
    }

    // Normalise column names (strip BOM, non-ASCII)
    const rawColumns = Object.keys(rows[0]);
    const columns = rawColumns.map((col) =>
      col.replace(/^\uFEFF/, "").replace(/[^\x20-\x7E]/g, "").trim()
    );

    // Auto-suggest via existing HEADER_ALIASES
    const suggestedMappings: Record<string, string> = {};
    for (const col of columns) {
      suggestedMappings[col] = HEADER_ALIASES[col.toLowerCase()] ?? "ignore";
    }

    // Preview: first 3 data rows with cleaned column keys
    const preview = rows.slice(0, 3).map((row) => {
      const clean: Record<string, string> = {};
      rawColumns.forEach((raw, idx) => {
        clean[columns[idx]] = (row[raw] ?? "").trim().slice(0, 80);
      });
      return clean;
    });

    res.json({
      columns,
      suggestedMappings,
      preview,
      totalRows: rows.length,
      canonicalFields: CANONICAL_FIELD_LABELS,
    });
  } catch (error) {
    next(error);
  }
}

export async function importLeadsCsv(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { campaignId } = z
      .object({ campaignId: z.string().min(1) })
      .parse(req.query);

    // Optional user-provided field mappings (from query param or X-CSV-Mappings header)
    let fieldMappings: Record<string, string> | null = null;
    const rawMappings =
      typeof req.query.mappings === "string" && req.query.mappings
        ? req.query.mappings
        : (req.headers["x-csv-mappings"] as string | undefined);

    if (rawMappings) {
      try {
        fieldMappings = JSON.parse(rawMappings) as Record<string, string>;
      } catch {
        res.status(400).json({ error: "Invalid mappings JSON parameter" });
        return;
      }
    }

    await assertCampaignAccess(campaignId, req.user!.userId, req.user!.orgId);

    const raw = await readCsvBuffer(req);
    if (raw.length === 0) {
      res.status(400).json({ error: "Empty request body" });
      return;
    }

    let rows: Record<string, string>[];
    try {
      rows = parseCsv(raw, CSV_PARSE_OPTIONS) as Record<string, string>[];
    } catch {
      throw new ValidationError("Invalid CSV format");
    }

    if (rows.length === 0) {
      res.status(400).json({ error: "CSV contains no data rows" });
      return;
    }

    if (rows.length > MAX_CSV_ROWS) {
      res
        .status(400)
        .json({ error: `CSV exceeds ${MAX_CSV_ROWS} row limit. Split into smaller files.` });
      return;
    }

    const validRows: Array<{ index: number; data: z.infer<typeof csvRowSchema> & { campaignId: string } }> = [];
    const invalid: Array<{ row: number; reason: string }> = [];

    for (let i = 0; i < rows.length; i++) {
      const rowNum = i + 2;
      const normalized = fieldMappings
        ? applyFieldMappings(rows[i], fieldMappings)
        : normalizeHeaders(rows[i]);
      const parsed = csvRowSchema.safeParse(normalized);

      if (!parsed.success) {
        invalid.push({
          row: rowNum,
          reason: parsed.error.issues
            .map((e) => `${e.path.join(".")}: ${e.message}`)
            .join("; "),
        });
        continue;
      }

      const countryCode = resolveCountryCode(parsed.data.country);
      let consentBasis = parsed.data.consentBasis?.toUpperCase();
      if (isEuLead(countryCode)) {
        if (!consentBasis || !VALID_GDPR_BASES.has(consentBasis)) {
          consentBasis = "LEGITIMATE_INTEREST";
        }
      }

      const { country: _country, consentBasis: _basis, ...leadFields } = parsed.data;
      validRows.push({
        index: i,
        data: {
          ...leadFields,
          companyName: parsed.data.companyName!,
          campaignId,
          ...(consentBasis ? { enrichmentData: { consentBasis, country: parsed.data.country } } : {}),
        },
      });
    }

    // Try to enrich company names from homepage <title> / og:site_name (max 10s budget)
    const rowsNeedingEnrichment = validRows.filter((r) => r.data.website);
    if (rowsNeedingEnrichment.length > 0) {
      const websiteLimit = pLimit(5);
      const enrichmentPromise = Promise.all(
        rowsNeedingEnrichment.map((row) =>
          websiteLimit(async () => {
            try {
              const fetched = await fetchCompanyNameFromWebsite(row.data.website!);
              if (fetched && fetched.length >= 2) {
                row.data.companyName = fetched;
              }
            } catch {
              // keep existing derived/parsed companyName
            }
          })
        )
      );

      const timeoutPromise = new Promise((resolve) => setTimeout(resolve, 10_000));
      await Promise.race([enrichmentPromise, timeoutPromise]);
    }

    type CsvLeadRow = {
      companyName: string;
      email?: string;
      firstName?: string;
      lastName?: string;
      title?: string;
      website?: string;
      linkedinUrl?: string;
      phone?: string;
      department?: string;
      seniority?: string;
      campaignId: string;
      enrichmentData?: Record<string, unknown>;
    };

    async function insertCsvLead(rowData: CsvLeadRow): Promise<{ id: string }> {
      // Campaign existence is verified once by assertCampaignAccess above;
      // no need to re-fetch it per row.

      const domain = extractDomain(rowData.website) ||
        (rowData.email ? rowData.email.split("@")[1]?.toLowerCase() ?? null : null);

      // Phone lives in enrichmentData since it has no first-class Lead column yet
      const enrichmentData: Record<string, unknown> = { ...rowData.enrichmentData };
      if (rowData.phone) enrichmentData.phone = rowData.phone;

      return prisma.lead.create({
        data: {
          companyName: rowData.companyName,
          email: rowData.email ?? null,
          firstName: rowData.firstName ?? null,
          lastName: rowData.lastName ?? null,
          title: rowData.title ?? null,
          website: rowData.website ?? null,
          linkedinUrl: rowData.linkedinUrl ?? null,
          department: rowData.department ?? null,
          seniority: rowData.seniority ?? null,
          domain: domain ?? null,
          campaignId: rowData.campaignId,
          source: "csv_import",
          emailStatus: rowData.email ? "FOUND" : "NOT_ATTEMPTED",
          ...(rowData.email && { emailSource: "USER_PROVIDED", emailVerified: false }),
          ...(Object.keys(enrichmentData).length > 0
            ? { enrichmentData: enrichmentData as Prisma.InputJsonValue }
            : {}),
        },
        select: { id: true },
      });
    }

    function describeP2002(err: Prisma.PrismaClientKnownRequestError): string {
      const target = (err.meta?.target as string[] | undefined) ?? [];
      if (target.includes("email")) return "Duplicate: a lead with this email already exists in this campaign";
      if (target.includes("domain")) return "Duplicate: a lead from this company domain already exists in this campaign";
      if (target.includes("externalId")) return "Duplicate: externalId already exists in this campaign";
      return "Duplicate lead in this campaign";
    }

    const created: string[] = [];
    const skipped: Array<{ row: number; reason: string }> = [];

    for (let batchStart = 0; batchStart < validRows.length; batchStart += BATCH_SIZE) {
      const batch = validRows.slice(batchStart, batchStart + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(({ data }) => insertCsvLead(data as CsvLeadRow))
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const rowNum = batch[j]!.index + 2;

        if (result.status === "fulfilled") {
          created.push(result.value.id);
        } else {
          const err = result.reason;
          const isDuplicate =
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002";

          skipped.push({
            row: rowNum,
            reason: isDuplicate
              ? describeP2002(err as Prisma.PrismaClientKnownRequestError)
              : err instanceof Error
                ? err.message
                : "Unknown error",
          });
        }
      }
    }


    if (created.length > 0) {
      await CacheService.invalidateVersioned(`version:campaign:${campaignId}`);
      await logAudit({
        userId: req.user!.userId,
        action: AUDIT_EVENTS.LEADS_BULK_IMPORTED,
        entityType: "Lead",
        entityId: campaignId,
        metadata: { source: "csv_import", count: created.length, campaignId },
        ipAddress: getIp(req),
        userAgent: getUserAgent(req),
      });

      // Kick off scoring → enrichment → generation pipeline for newly imported leads.
      // Fire-and-forget: we never block the HTTP response on these jobs.
      try {
        const campaignRecord = await prisma.campaign.findUnique({
          where: { id: campaignId },
          select: { icpDescription: true, status: true },
        });
        const icpDescription = campaignRecord?.icpDescription ?? "";
        const SCORE_CHUNK = 50;
        for (let ci = 0; ci < created.length; ci += SCORE_CHUNK) {
          const chunk = created.slice(ci, ci + SCORE_CHUNK);
          const chunkHash = chunk.slice().sort().join(",").slice(0, 16);
          await leadScoringQueue.add(
            "score-lead-batch",
            { leadIds: chunk, campaignId, icpDescription },
            {
              jobId: `csv-score-${campaignId}-${chunkHash}`,
              attempts: 2,
              backoff: { type: "exponential", delay: 5_000 },
              removeOnComplete: { age: 300 },
              removeOnFail: { age: 3600 },
            }
          );
        }
      } catch (err) {
        // Log but never fail the response — leads are already created
        logger.warn({ err, campaignId }, "[importLeadsCsv] Failed to enqueue scoring for imported leads");
      }
    }

    res.status(207).json({
      created: created.length,
      skipped: skipped.length,
      invalid: invalid.length,
      details: { skipped, invalid },
    });
  } catch (error) {
    next(error);
  }
}

export async function getLeads(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const query = getLeadsQuerySchema.parse(req.query);
    if (query.campaignId) {
      await assertCampaignAccess(query.campaignId, req.user!.userId, req.user!.orgId);
    }
    const result = await LeadService.getLeads({
      ...query,
      userId: req.user!.userId,
    });
    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}

export async function getLeadById(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const lead = await LeadService.getLeadById(id);
    if (!lead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    await assertCampaignAccess(lead.campaignId, req.user!.userId, req.user!.orgId);
    res.status(200).json(lead);
  } catch (error) {
    next(error);
  }
}

export async function updateLead(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const data = updateLeadSchema.parse(req.body);
    const existing = await LeadService.getLeadById(id);
    if (!existing) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    await assertCampaignAccess(existing.campaignId, req.user!.userId, req.user!.orgId);
    const lead = await LeadService.updateLead(id, data);
    await logAudit({
      userId: req.user!.userId,
      action: AUDIT_EVENTS.LEAD_UPDATED,
      entityType: "Lead",
      entityId: lead.id,
      metadata: { fields: Object.keys(data), campaignId: lead.campaignId },
      ipAddress: getIp(req),
      userAgent: getUserAgent(req),
    });
    res.status(200).json(lead);
  } catch (error) {
    next(error);
  }
}

export async function deleteLead(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const existing = await LeadService.getLeadById(id);
    if (!existing) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    await assertCampaignAccess(existing.campaignId, req.user!.userId, req.user!.orgId);
    await LeadService.deleteLead(id);
    await CacheService.invalidateVersioned(`version:campaign:${existing.campaignId}`);

    if (existing.email && req.user!.orgId) {
      revokeConsent(req.user!.orgId, existing.email).catch((err) =>
        logger.warn({ err, leadId: id }, "[leads] consent revocation failed")
      );
    }

    await logAudit({
      userId: req.user!.userId,
      action: AUDIT_EVENTS.LEAD_DELETED,
      entityType: "Lead",
      entityId: id,
      metadata: { campaignId: existing.campaignId },
      ipAddress: getIp(req),
      userAgent: getUserAgent(req),
    });
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}


const bulkActionSchema = z.object({
  campaignId: z.string().min(1),
  leadIds: z.array(z.string().min(1)).min(1).max(500),
});

export async function bulkSuppress(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { campaignId, leadIds } = bulkActionSchema.parse(req.body);
    await assertCampaignAccess(campaignId, req.user!.userId, req.user!.orgId);

    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds }, campaignId, deletedAt: null },
      select: { id: true, email: true },
    });

    const emailLeads = leads.filter((l) => l.email);

    await prisma.$transaction(async (tx) => {
      if (emailLeads.length > 0) {
        await tx.suppression.createMany({
          data: emailLeads.map((l) => ({
            email: l.email!,
            orgId: req.user!.orgId!,
            userId: req.user!.userId,
            reason: "Bulk suppressed by operator",
            source: "bulk-action",
          })),
          skipDuplicates: true,
        });
      }
      if (leads.length > 0) {
        await tx.lead.updateMany({
          where: { id: { in: leads.map((l) => l.id) } },
          data: { deletedAt: new Date() },
        });
      }
    });

    await logAudit({
      userId: req.user!.userId,
      action: AUDIT_EVENTS.LEADS_BULK_IMPORTED,
      entityType: "Lead",
      entityId: campaignId,
      metadata: { action: "bulk_suppress", count: leads.length, campaignId },
      ipAddress: getIp(req),
      userAgent: getUserAgent(req),
    });

    await CacheService.invalidateVersioned(`version:campaign:${campaignId}`);
    res.status(200).json({ suppressed: emailLeads.length, deleted: leads.length });
  } catch (error) {
    next(error);
  }
}

export async function bulkRescore(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { campaignId, leadIds } = bulkActionSchema.parse(req.body);
    await assertCampaignAccess(campaignId, req.user!.userId, req.user!.orgId);

    const exists = await prisma.lead.count({
      where: { id: { in: leadIds }, campaignId, deletedAt: null },
    });

    if (exists !== leadIds.length) {
      res.status(400).json({ error: "One or more lead IDs are invalid or do not belong to this campaign" });
      return;
    }

    const rescoreDedupeHash = createHash("sha256")
      .update([...leadIds].sort().join(","))
      .digest("hex")
      .slice(0, 16);

    await leadScoringQueue.add(
      "run-bulk-scoring",
      { campaignId, leadIds },
      {
        // Deterministic jobId (same pattern as enrich-batch- in email-enrichment.queue.ts):
        // a duplicate submission for the same campaign+leads now dedupes via BullMQ
        // instead of enqueueing a second full LLM-scoring pass over the same leads.
        jobId: `bulk-rescore-${campaignId}-${rescoreDedupeHash}`,
        attempts: 2,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { age: 300 },
        removeOnFail: { age: 3600 },
      }
    );

    res.status(202).json({ queued: leadIds.length });
  } catch (error) {
    next(error);
  }
}

export async function bulkUpdateStage(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const schema = bulkActionSchema.extend({
      pipelineStage: z.enum(["PROSPECT", "ENGAGED", "HOT", "MEETING_BOOKED", "DISQUALIFIED"]),
    });
    const { campaignId, leadIds, pipelineStage } = schema.parse(req.body);
    await assertCampaignAccess(campaignId, req.user!.userId, req.user!.orgId);

    const result = await prisma.lead.updateMany({
      where: { id: { in: leadIds }, campaignId, deletedAt: null },
      data: { pipelineStage },
    });

    if (pipelineStage === "MEETING_BOOKED") {
      for (const leadId of leadIds) {
        realtimeQueue.add(
          "generate-discovery-script",
          { leadId },
          { jobId: `discovery-script-${leadId}`, removeOnComplete: { age: 3600 }, removeOnFail: { age: 86400 } }
        ).catch((err) => logger.error({ err, leadId }, "[leads.controller] Failed to enqueue discovery script"));
      }
    }

    await CacheService.invalidateVersioned(`version:campaign:${campaignId}`);
    await logAudit({
      userId: req.user!.userId,
      action: AUDIT_EVENTS.LEAD_UPDATED,
      entityType: "Lead",
      entityId: campaignId,
      metadata: { action: "bulk_stage_update", pipelineStage, count: result.count, campaignId },
      ipAddress: getIp(req),
      userAgent: getUserAgent(req),
    });

    res.status(200).json({ updated: result.count });
  } catch (error) {
    next(error);
  }
}


export async function reEnrichLead(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const userId = req.user!.userId;
    const lead = await prisma.lead.findFirst({
      where: {
        id,
        campaign: { createdById: userId },
      },
      select: { id: true },
    });
    if (!lead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    const result = await runEnrichmentWaterfall(id, userId);
    res.json({
      leadId: result.leadId,
      fieldsAdded: result.fieldsAdded,
      companyHit: result.companyHit,
      personHit: result.personHit,
    });
  } catch (err) {
    next(err);
  }
}

export async function bulkEnrichLeads(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const schema = z.object({
      leadIds: z.array(z.string().cuid()).min(1).max(BULK_ENRICH_MAX),
    });
    const { leadIds } = schema.parse(req.body);
    const userId = req.user!.userId;

    const owned = await prisma.lead.findMany({
      where: {
        id: { in: leadIds },
        campaign: { createdById: userId },
        emailStatus: { notIn: ["FOUND", "PENDING"] },
        deletedAt: null,
      },
      select: { id: true },
    });

    if (owned.length === 0) {
      res.status(202).json({ queued: 0, skipped: leadIds.length });
      return;
    }

    const eligibleIds = owned.map((l) => l.id);

    await prisma.lead.updateMany({
      where: { id: { in: eligibleIds }, emailStatus: { notIn: ["FOUND", "PENDING"] } },
      data: { emailStatus: "PENDING" },
    });

    await Promise.all(
      eligibleIds.map((leadId) =>
        emailEnrichmentQueue.add(
          "enrich-waterfall",
          { type: "single", leadId, userId },
          {
            jobId: `enrich-waterfall-${leadId}`,
            attempts: 2,
            backoff: { type: "exponential", delay: 3_000 },
            removeOnComplete: { age: 60 * 60 * 24 },
            removeOnFail: { age: 60 * 60 * 24 * 7 },
          }
        )
      )
    );

    res.status(202).json({ queued: eligibleIds.length, skipped: leadIds.length - eligibleIds.length });
  } catch (err) {
    next(err);
  }
}

export async function bulkScoreAndEnrich(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const schema = z.object({
      campaignId: z.string().min(1),
      leadIds: z.array(z.string().min(1)).min(1).max(200),
    });
    const { campaignId, leadIds } = schema.parse(req.body);
    const userId = req.user!.userId;

    await assertCampaignAccess(campaignId, userId, req.user!.orgId);

    const campaign = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { icpDescription: true, qualificationThreshold: true },
    });

    if (!campaign?.icpDescription?.trim()) {
      res.status(400).json({ error: "Campaign has no ICP description — configure it before scoring" });
      return;
    }

    const ownedLeads = await prisma.lead.findMany({
      where: { id: { in: leadIds }, campaignId, deletedAt: null },
      select: { id: true, emailStatus: true },
    });

    if (ownedLeads.length === 0) {
      res.status(400).json({ error: "No valid leads found for this campaign" });
      return;
    }

    const threshold = typeof campaign.qualificationThreshold === "number" && campaign.qualificationThreshold >= 0
      ? campaign.qualificationThreshold
      : 0.5;

    const validIds = ownedLeads.map((l) => l.id);
    const CHUNK = 10;
    const qualifiedIds: string[] = [];
    let disqualified = 0;

    for (let i = 0; i < validIds.length; i += CHUNK) {
      const chunk = validIds.slice(i, i + CHUNK);
      try {
        const results = await runBatchLeadScoringAgent(chunk, campaign.icpDescription, false, threshold);
        for (const [leadId, qualifies] of Object.entries(results)) {
          if (qualifies) qualifiedIds.push(leadId);
          else disqualified++;
        }
      } catch (err) {
        logger.warn({ err, campaignId, chunkStart: i }, "[leads.controller] bulkScoreAndEnrich chunk failed");
      }
    }

    const RESOLVED_STATUSES = new Set(["FOUND", "VERIFIED", "PENDING", "PENDING_VERIFICATION"]);
    const needEnrichment = ownedLeads
      .filter((l) => qualifiedIds.includes(l.id) && !RESOLVED_STATUSES.has(l.emailStatus ?? ""))
      .map((l) => l.id);

    let enrichmentQueued = 0;
    if (needEnrichment.length > 0) {
      await Promise.allSettled(
        needEnrichment.map((leadId) =>
          emailEnrichmentQueue.add(
            "enrich-waterfall",
            { type: "single", leadId, userId },
            {
              // Deterministic (no Date.now()): overlapping bulk runs now dedupe
              // per lead instead of double-enqueueing enrichment for it.
              jobId: `enrich-waterfall-${leadId}`,
              attempts: 2,
              backoff: { type: "exponential", delay: 3_000 },
              removeOnComplete: { age: 60 * 60 * 24 },
              removeOnFail: { age: 60 * 60 * 24 * 7 },
            }
          )
        )
      );
      enrichmentQueued = needEnrichment.length;
    }

    await CacheService.invalidateVersioned(`version:campaign:${campaignId}`);

    res.status(200).json({
      scored: validIds.length,
      qualified: qualifiedIds.length,
      disqualified,
      enrichmentQueued,
    });
  } catch (err) {
    next(err);
  }
}

export async function getLeadJourney(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const userId = req.user!.userId as string;

    const lead = await prisma.lead.findFirst({
      where: { id, campaign: { createdById: userId } },
      select: { id: true },
    });
    if (!lead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }

    const [events, summary] = await Promise.all([
      getRecentLeadJourney(id, 50),
      summarizeLeadJourney(id, 50),
    ]);

    res.json({
      data: {
        summary,
        events: events.map((e) => ({
          id: e.id,
          eventType: e.eventType,
          channel: e.channel,
          metadata: e.metadata,
          createdAt: e.createdAt,
        })),
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function getLeadCommittee(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const userId = req.user!.userId as string;

    const lead = await prisma.lead.findFirst({
      where: { id, campaign: { createdById: userId } },
      select: { companyId: true, companyName: true, domain: true },
    });
    if (!lead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }

    const where = lead.companyId
      ? { companyId: lead.companyId, id: { not: id }, campaign: { createdById: userId } }
      : { companyName: lead.companyName, id: { not: id }, campaign: { createdById: userId } };

    const committee = await prisma.lead.findMany({
      where,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        title: true,
        email: true,
        emailVerified: true,
        qualificationScore: true,
        recommendedAction: true,
        pipelineStage: true,
        linkedinUrl: true,
        campaign: { select: { id: true, name: true } },
      },
      take: 10,
      orderBy: { qualificationScore: "desc" },
    });

    res.json({ data: committee });
  } catch (err) {
    next(err);
  }
}

export async function generateResearchCard(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const userId = req.user!.userId;
    const forceRefresh = req.query.forceRefresh === "true";
    const card = await generateLeadResearchCard(id, userId, undefined, forceRefresh);
    res.json(card);
  } catch (err) {
    const message = (err as Error).message;
    if (message === "Lead not found") {
      res.status(404).json({ error: message });
      return;
    }
    next(err);
  }
}

export async function generateDiscoveryScriptController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id } = req.params as { id: string };
    const userId = req.user!.userId;
    const lead = await prisma.lead.findFirst({
      where: { id, campaign: { createdById: userId } },
      select: { id: true, campaignId: true },
    });
    if (!lead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    const script = await generateDiscoveryScript(id);
    if (!script) {
      next(new HttpError(
        503,
        "generateDiscoveryScript returned null",
        "DISCOVERY_SCRIPT_UNAVAILABLE",
        "We weren't able to generate your discovery script right now. Please try again — if the issue persists, contact support."
      ));
      return;
    }
    res.json(script);
  } catch (err) {
    next(err);
  }
}

export async function generateMessageForLeadController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { id: leadId } = req.params as { id: string };
    const userId = req.user!.userId;

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { campaignId: true },
    });

    if (!lead) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }

    await assertCampaignAccess(lead.campaignId, userId, req.user?.orgId);

    const existing = await prisma.outreachMessage.findMany({
      where: { leadId },
      select: { id: true, approvalStatus: true, deliveryState: true },
    });

    const activeOrSent = existing.find(
      (m) => m.approvalStatus === "APPROVED" || m.deliveryState === "SENT" || m.deliveryState === "QUEUED"
    );

    if (activeOrSent) {
      res.status(409).json({ error: "Lead has already been contacted or message is queued/sent." });
      return;
    }

    if (existing.length > 0) {
      await prisma.outreachMessage.deleteMany({
        where: { id: { in: existing.map((m) => m.id) } },
      });
    }

    const { tone } = (req.body || {}) as { tone?: string };
    const message = await generateSingleOutreachMessage(leadId, userId, tone);
    res.status(201).json(message);
  } catch (error) {
    next(error);
  }
}


export async function bulkEnrollSequence(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { campaignId, leadIds } = bulkActionSchema.parse(req.body);
    await assertCampaignAccess(campaignId, req.user!.userId, req.user!.orgId);

    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds }, campaignId, deletedAt: null },
      select: { id: true },
    });

    for (const lead of leads) {
      await initializeLeadSequence(lead.id, campaignId);
    }

    await logAudit({
      userId: req.user!.userId,
      action: AUDIT_EVENTS.LEAD_UPDATED,
      entityType: "Lead",
      entityId: campaignId,
      metadata: { action: "bulk_enroll_sequence", count: leads.length, campaignId },
      ipAddress: getIp(req),
      userAgent: getUserAgent(req),
    });

    await CacheService.invalidateVersioned(`version:campaign:${campaignId}`);

    res.status(200).json({ enrolled: leads.length });
  } catch (error) {
    next(error);
  }
}

export async function bulkSendEmailBatch(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { campaignId, leadIds } = bulkActionSchema.parse(req.body);
    await assertCampaignAccess(campaignId, req.user!.userId, req.user!.orgId);

    const pendingMessages = await prisma.outreachMessage.findMany({
      where: {
        leadId: { in: leadIds },
        lead: { campaignId },
        approvalStatus: "PENDING",
      },
      select: { id: true },
    });

    const messageIds = pendingMessages.map((m) => m.id);

    if (messageIds.length === 0) {
      res.status(200).json({ succeeded: [], failed: [], message: "No pending messages found for the selected leads" });
      return;
    }

    const result = await batchApproveMessages(campaignId, messageIds, req.user!.userId);

    await logAudit({
      userId: req.user!.userId,
      action: AUDIT_EVENTS.MESSAGE_APPROVED,
      entityType: "OutreachMessage",
      entityId: campaignId,
      metadata: { campaignId, count: result.succeeded.length, succeeded: result.succeeded, failed: result.failed },
      ipAddress: getIp(req),
      userAgent: getUserAgent(req),
    });

    await CacheService.invalidateVersioned(`version:campaign:${campaignId}`);

    res.status(200).json(result);
  } catch (error) {
    next(error);
  }
}