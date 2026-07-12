import { Response, NextFunction } from "express";
import { z } from "zod";
import { parse as parseCsv } from "csv-parse/sync";
import { Prisma } from "@prisma/client";
import { AuthenticatedRequest } from "../auth/auth.types";
import * as LeadService from "./leads.service";
import { createLeadSchema, updateLeadSchema, getLeadsQuerySchema } from "./leads.schema";
import { logAudit } from "../audit/audit.service";
import { AUDIT_EVENTS } from "../../lib/constants";
import { assertCampaignOwner } from "../../lib/ownership";
import { ValidationError } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { leadScoringQueue } from "../gemini/campaign.queue";
import { logger } from "../../lib/logger";
import { emailEnrichmentQueue } from "../gemini/email-enrichment.queue";
import { runEnrichmentWaterfall } from "../gemini/enrichment-waterfall.agent";
import { generateLeadResearchCard } from "../gemini/lead-research.agent";
import { generateSingleOutreachMessage } from "../gemini/generate.agent";
import { CacheService } from "../../lib/cache";

const BULK_ENRICH_MAX = 100;

const MAX_CSV_BYTES = 5 * 1024 * 1024;
const MAX_CSV_ROWS = 5_000;
const BATCH_SIZE = 100;

const HEADER_ALIASES: Record<string, string> = {
  company: "companyName",
  company_name: "companyName",
  "company name": "companyName",
  organization: "companyName",
  org: "companyName",
  first_name: "firstName",
  "first name": "firstName",
  firstname: "firstName",
  last_name: "lastName",
  "last name": "lastName",
  lastname: "lastName",
  email_address: "email",
  "email address": "email",
  mail: "email",
  job_title: "title",
  "job title": "title",
  position: "title",
  role: "title",
  url: "website",
  "website url": "website",
  web: "website",
  linkedin: "linkedinUrl",
  linkedin_url: "linkedinUrl",
  "linkedin url": "linkedinUrl",
  "linkedin profile": "linkedinUrl",
};

function normalizeHeaders(row: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) {
    const normalized = k.trim().toLowerCase();
    const canonical = HEADER_ALIASES[normalized] ?? k.trim();
    out[canonical] = v;
  }
  return out;
}

const csvRowSchema = z.object({
  companyName: z.string().min(1),
  email: z
    .string()
    .email()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  firstName: z
    .string()
    .min(1)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  lastName: z
    .string()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  title: z
    .string()
    .optional()
    .or(z.literal("").transform(() => undefined)),
  website: z
    .string()
    .optional()
    .or(z.literal("").transform(() => undefined))
    .transform((v) => {
      if (!v) return undefined;
      if (/^https?:\/\//i.test(v)) return v;
      return `https://${v}`;
    }),
  linkedinUrl: z
    .string()
    .optional()
    .or(z.literal("").transform(() => undefined))
    .transform((v) => {
      if (!v) return undefined;
      if (/^https?:\/\//i.test(v)) return v;
      return `https://${v}`;
    }),
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
    await assertCampaignOwner(data.campaignId, req.user!.userId);
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

export async function importLeadsCsv(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { campaignId } = z
      .object({ campaignId: z.string().min(1) })
      .parse(req.query);

    await assertCampaignOwner(campaignId, req.user!.userId);

    const contentType = req.headers["content-type"] ?? "";
    if (
      !contentType.includes("text/csv") &&
      !contentType.includes("application/octet-stream")
    ) {
      res.status(415).json({ error: "Content-Type must be text/csv" });
      return;
    }

    const raw: Buffer = await new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0;
      req.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_CSV_BYTES) {
          reject(
            new ValidationError(
              `CSV exceeds ${MAX_CSV_BYTES / 1024 / 1024}MB limit`
            )
          );
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });

    let rows: Record<string, string>[];
    try {
      rows = parseCsv(raw, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Record<string, string>[];
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
      const normalized = normalizeHeaders(rows[i]);
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

      validRows.push({ index: i, data: { ...parsed.data, campaignId } });
    }

    const created: string[] = [];
    const skipped: Array<{ row: number; reason: string }> = [];

    for (let batchStart = 0; batchStart < validRows.length; batchStart += BATCH_SIZE) {
      const batch = validRows.slice(batchStart, batchStart + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(({ data }) =>
          LeadService.createLead(data)
        )
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const rowNum = batch[j].index + 2;

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
              ? "Duplicate lead (same email already exists in this campaign)"
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
      await assertCampaignOwner(query.campaignId, req.user!.userId);
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
    await assertCampaignOwner(lead.campaignId, req.user!.userId);
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
    await assertCampaignOwner(existing.campaignId, req.user!.userId);
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
    await assertCampaignOwner(existing.campaignId, req.user!.userId);
    await LeadService.deleteLead(id);
    await CacheService.invalidateVersioned(`version:campaign:${existing.campaignId}`);
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
    await assertCampaignOwner(campaignId, req.user!.userId);

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
    await assertCampaignOwner(campaignId, req.user!.userId);

    const exists = await prisma.lead.count({
      where: { id: { in: leadIds }, campaignId, deletedAt: null },
    });

    if (exists !== leadIds.length) {
      res.status(400).json({ error: "One or more lead IDs are invalid or do not belong to this campaign" });
      return;
    }

    await leadScoringQueue.add(
      "run-bulk-scoring",
      { campaignId, leadIds },
      {
        jobId: `bulk-rescore-${campaignId}-${Date.now()}`,
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
      },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((l) => l.id));
    const validIds = leadIds.filter((id) => ownedIds.has(id));

    if (validIds.length === 0) {
      res.status(400).json({ error: "No valid lead IDs found for this user" });
      return;
    }

    await Promise.all(
      validIds.map((leadId) =>
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

    res.status(202).json({ queued: validIds.length });
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
    const card = await generateLeadResearchCard(id, userId);
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

    await assertCampaignOwner(lead.campaignId, userId);

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

    const message = await generateSingleOutreachMessage(leadId, userId);
    res.status(201).json(message);
  } catch (error) {
    next(error);
  }
}