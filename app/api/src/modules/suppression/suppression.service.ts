import { z } from "zod";

import { prisma } from "../../lib/prisma";
import {
  createSuppressionSchema,
  checkSuppressionSchema,
  getSuppressionQuerySchema,
} from "./suppression.schema";
import { Prisma } from "@prisma/client";

export interface BulkSuppressionResult {
  created: number;
  skipped: number;
  failed: number;
  total: number;
  details: {
    skipped: Array<{ index: number; value: string; reason: string }>;
    failed: Array<{ index: number; value: string; reason: string }>;
  };
}

function entryLabel(entry: z.infer<typeof createSuppressionSchema>): string {
  return entry.email ?? entry.domain ?? "(unknown)";
}

export async function createSuppression(
  orgId: string,
  userId: string,
  data: z.infer<typeof createSuppressionSchema>
) {
  if (data.email) {
    const existing = await prisma.suppression.findUnique({
      where: { email_orgId: { email: data.email, orgId } },
    });
    if (existing) throw new Error("Email already suppressed");
  }
  return prisma.suppression.create({ data: { ...data, orgId, userId } });
}

export async function createSuppressionBulk(
  orgId: string,
  userId: string,
  entries: z.infer<typeof createSuppressionSchema>[]
): Promise<BulkSuppressionResult> {
  let created = 0;
  const failedDetails: Array<{ index: number; value: string; reason: string }> = [];
  const skippedDetails: Array<{ index: number; value: string; reason: string }> = [];

  try {
    const result = await prisma.suppression.createMany({
      data: entries.map((entry) => ({ ...entry, orgId, userId })),
      skipDuplicates: true,
    });
    created = result.count;
    const skippedCount = entries.length - created;
    // We can't know which specific entries were skipped without a second query,
    // so report the aggregate count only.
    for (let i = 0; i < skippedCount; i++) {
      skippedDetails.push({ index: -1, value: "(duplicate)", reason: "Already suppressed" });
    }
  } catch (err) {
    // Treat a full-batch failure as all entries failed
    entries.forEach((entry, i) => {
      failedDetails.push({
        index: i,
        value: entryLabel(entry),
        reason: err instanceof Error ? err.message : "Unknown error",
      });
    });
  }

  return {
    created,
    skipped: skippedDetails.length,
    failed: failedDetails.length,
    total: entries.length,
    details: {
      skipped: skippedDetails,
      failed: failedDetails,
    },
  };
}


export async function getSuppressions(
  orgId: string,
  query: z.infer<typeof getSuppressionQuerySchema>
) {
  const { email, domain, source, type, page, limit } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.SuppressionWhereInput = {
    orgId,
    ...(email && { email: { contains: email, mode: "insensitive" } }),
    ...(domain && { domain: { contains: domain, mode: "insensitive" } }),
    ...(source && { source }),
    ...(type === "email" && { email: { not: null } }),
    ...(type === "domain" && { email: null, domain: { not: null } }),
  };

  const [suppressions, total] = await prisma.$transaction([
    prisma.suppression.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
    }),
    prisma.suppression.count({ where }),
  ]);

  return {
    data: suppressions,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

export async function getSuppressionStats(orgId: string) {
  const [total, emailCount, domainCount] = await prisma.$transaction([
    prisma.suppression.count({ where: { orgId } }),
    prisma.suppression.count({ where: { orgId, email: { not: null } } }),
    prisma.suppression.count({ where: { orgId, email: null, domain: { not: null } } }),
  ]);
  return { total, emailCount, domainCount };
}

export async function checkSuppression(
  orgId: string,
  query: z.infer<typeof checkSuppressionSchema>
) {
  const { email, domain } = query;
  const emailDomain = email ? email.split("@")[1] : undefined;

  const [emailMatch, domainMatch, emailDomainMatch] = await Promise.all([
    email
      ? prisma.suppression.findUnique({ where: { email_orgId: { email, orgId } } })
      : Promise.resolve(null),
    domain
      ? prisma.suppression.findFirst({ where: { domain, orgId } })
      : Promise.resolve(null),
    emailDomain
      ? prisma.suppression.findFirst({ where: { domain: emailDomain, orgId } })
      : Promise.resolve(null),
  ]);

  const suppressed = !!(emailMatch || domainMatch || emailDomainMatch);
  return {
    suppressed,
    reason:
      emailMatch?.reason ??
      domainMatch?.reason ??
      emailDomainMatch?.reason ??
      null,
    matchedOn: emailMatch
      ? "email"
      : domainMatch
        ? "domain"
        : emailDomainMatch
          ? "email_domain"
          : null,
  };
}

export async function deleteSuppression(orgId: string, id: string) {
  const existing = await prisma.suppression.findFirst({ where: { id, orgId } });
  if (!existing) throw new Error("Suppression not found or access denied");
  return prisma.suppression.delete({ where: { id } });
}