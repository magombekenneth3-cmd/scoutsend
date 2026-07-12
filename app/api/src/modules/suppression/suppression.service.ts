import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  createSuppressionSchema,
  checkSuppressionSchema,
  getSuppressionQuerySchema,
} from "./suppression.schema";

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
  userId: string,
  data: z.infer<typeof createSuppressionSchema>
) {
  if (data.email) {
    const existing = await prisma.suppression.findUnique({
      where: { email_userId: { email: data.email, userId } },
    });
    if (existing) throw new Error("Email already suppressed");
  }
  return prisma.suppression.create({ data: { ...data, userId } });
}

export async function createSuppressionBulk(
  userId: string,
  entries: z.infer<typeof createSuppressionSchema>[]
): Promise<BulkSuppressionResult> {
  const results = await Promise.allSettled(
    entries.map((entry) =>
      prisma.suppression.create({ data: { ...entry, userId } })
    )
  );

  let created = 0;
  let skipped = 0;
  let failed = 0;
  const skippedDetails: Array<{ index: number; value: string; reason: string }> = [];
  const failedDetails: Array<{ index: number; value: string; reason: string }> = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const value = entryLabel(entries[i]);

    if (result.status === "fulfilled") {
      created++;
    } else {
      const err = result.reason;
      const isDuplicate =
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2002";

      if (isDuplicate) {
        skipped++;
        skippedDetails.push({ index: i, value, reason: "Already suppressed" });
      } else {
        failed++;
        failedDetails.push({
          index: i,
          value,
          reason: err instanceof Error ? err.message : "Unknown error",
        });
      }
    }
  }

  return {
    created,
    skipped,
    failed,
    total: entries.length,
    details: {
      skipped: skippedDetails,
      failed: failedDetails,
    },
  };
}

export async function getSuppressions(
  userId: string,
  query: z.infer<typeof getSuppressionQuerySchema>
) {
  const { email, domain, source, type, page, limit } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.SuppressionWhereInput = {
    userId,
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

export async function getSuppressionStats(userId: string) {
  const [total, emailCount, domainCount] = await prisma.$transaction([
    prisma.suppression.count({ where: { userId } }),
    prisma.suppression.count({ where: { userId, email: { not: null } } }),
    prisma.suppression.count({ where: { userId, email: null, domain: { not: null } } }),
  ]);
  return { total, emailCount, domainCount };
}

export async function checkSuppression(
  userId: string,
  query: z.infer<typeof checkSuppressionSchema>
) {
  const { email, domain } = query;
  const emailDomain = email ? email.split("@")[1] : undefined;

  const [emailMatch, domainMatch, emailDomainMatch] = await Promise.all([
    email
      ? prisma.suppression.findUnique({ where: { email_userId: { email, userId } } })
      : Promise.resolve(null),
    domain
      ? prisma.suppression.findFirst({ where: { domain, userId } })
      : Promise.resolve(null),
    emailDomain
      ? prisma.suppression.findFirst({ where: { domain: emailDomain, userId } })
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

export async function deleteSuppression(userId: string, id: string) {
  const existing = await prisma.suppression.findFirst({ where: { id, userId } });
  if (!existing) throw new Error("Suppression not found or access denied");
  return prisma.suppression.delete({ where: { id } });
}