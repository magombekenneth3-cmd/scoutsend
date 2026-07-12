import { z } from "zod";
import { Prisma } from "@prisma/client";
import dns from "node:dns/promises";
import { prisma } from "../../lib/prisma";
import { NotFoundError, ForbiddenError, ConflictError } from "../../lib/errors";
import {
  createSenderDomainSchema,
  updateSenderDomainSchema,
  getSenderDomainsQuerySchema,
} from "./senderDomain.schema";

const DOMAIN_INCLUDE = {
  _count: { select: { campaigns: true } },
} satisfies Prisma.SenderDomainInclude;

async function getDomainOrThrow(id: string, userId: string) {
  const domain = await prisma.senderDomain.findUnique({ where: { id } });

  if (!domain) throw new NotFoundError("Sender domain");
  if (domain.createdById !== userId) throw new ForbiddenError();

  return domain;
}

export async function createSenderDomain(
  data: z.infer<typeof createSenderDomainSchema>,
  createdById: string
) {
  const existing = await prisma.senderDomain.findUnique({
    where: { domain: data.domain },
  });
  if (existing) throw new ConflictError(`Domain ${data.domain} is already registered`);

  return prisma.senderDomain.create({
    data: { ...data, createdById },
    include: DOMAIN_INCLUDE,
  });
}

export async function getSenderDomains(
  query: z.infer<typeof getSenderDomainsQuerySchema>,
  userId: string
) {
  const { health, warmupEnabled, page, limit } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.SenderDomainWhereInput = {
    createdById: userId,
    ...(health && { health }),
    ...(warmupEnabled !== undefined && { warmupEnabled }),
  };

  const [domains, total] = await prisma.$transaction([
    prisma.senderDomain.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: DOMAIN_INCLUDE,
    }),
    prisma.senderDomain.count({ where }),
  ]);

  return {
    data: domains,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

export async function getSenderDomainById(id: string, userId: string) {
  await getDomainOrThrow(id, userId);

  return prisma.senderDomain.findUnique({
    where: { id },
    include: {
      campaigns: {
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, status: true, dailySendLimit: true },
      },
      deliverabilityEvents: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, type: true, severity: true, metadata: true, createdAt: true },
      },
      _count: { select: { campaigns: true } },
    },
  });
}

export async function updateSenderDomain(
  id: string,
  userId: string,
  data: z.infer<typeof updateSenderDomainSchema>
) {
  await getDomainOrThrow(id, userId);

  return prisma.senderDomain.update({
    where: { id },
    data,
    include: DOMAIN_INCLUDE,
  });
}

export async function deleteSenderDomain(id: string, userId: string) {
  await getDomainOrThrow(id, userId);

  const activeCampaigns = await prisma.campaign.count({
    where: {
      senderDomainId: id,
      status: { in: ["RESEARCHING", "GENERATING", "REVIEW", "QUEUED", "SENDING"] },
    },
  });

  if (activeCampaigns > 0) {
    throw new ConflictError("Cannot delete a domain with active campaigns");
  }

  return prisma.senderDomain.delete({ where: { id } });
}

export async function resetDailyCount(id: string, userId: string) {
  await getDomainOrThrow(id, userId);

  return prisma.senderDomain.update({
    where: { id },
    data: { currentSent: 0 },
  });
}

export async function verifySenderDomainDns(id: string, userId: string) {
  const domain = await getDomainOrThrow(id, userId);

  let spfValid = false;
  try {
    const txtRecords = await dns.resolveTxt(domain.domain);
    spfValid = txtRecords.some((chunks) =>
      chunks.join("").toLowerCase().startsWith("v=spf1"),
    );
  } catch {}

  let dkimValid = false;
  try {
    const dkimRecords = await dns.resolveTxt(`default._domainkey.${domain.domain}`);
    dkimValid = dkimRecords.some((chunks) =>
      chunks.join("").toLowerCase().includes("v=dkim1"),
    );
  } catch {}

  let dmarcValid = false;
  try {
    const dmarcRecords = await dns.resolveTxt(`_dmarc.${domain.domain}`);
    dmarcValid = dmarcRecords.some((chunks) =>
      chunks.join("").toLowerCase().startsWith("v=dmarc1"),
    );
  } catch {}

  const dnsCheckedAt = new Date();

  await prisma.senderDomain.update({
    where: { id },
    data: { spfValid, dkimValid, dmarcValid, dnsCheckedAt },
  });

  return { spfValid, dkimValid, dmarcValid, dnsCheckedAt };
}