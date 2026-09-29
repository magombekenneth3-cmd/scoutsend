import { z } from "zod";
import { Prisma, OrgRole } from "@prisma/client";
import dns from "node:dns/promises";
import { getDomain } from "tldts";

import { prisma } from "../../lib/prisma";
import {
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from "../../lib/errors";
import { logger } from "../../lib/logger";

import {
  createSenderDomainSchema,
  updateSenderDomainSchema,
  getSenderDomainsQuerySchema,
} from "./senderDomain.schema";

// ─── Role constants ───────────────────────────────────────────────────────────
const WRITE_ROLES: OrgRole[] = [OrgRole.OWNER, OrgRole.ADMIN, OrgRole.MEMBER];
const DELETE_ROLES: OrgRole[] = [OrgRole.OWNER, OrgRole.ADMIN];

// ─── Prisma include ───────────────────────────────────────────────────────────
const DOMAIN_INCLUDE = {
  _count: {
    select: {
      campaigns: true,
    },
  },
} satisfies Prisma.SenderDomainInclude;

// ─── DNS constants ────────────────────────────────────────────────────────────
export const DNS_LOOKUP_TIMEOUT_MS = 5000;

export const TRANSIENT_DNS_CODES = new Set([
  "ETIMEOUT",
  "ESERVFAIL",
  "ECONNREFUSED",
  "EREFUSED",
  "ECANCELLED",
]);

// ─── DNS resolver interface (enables injection in tests) ──────────────────────
export interface DnsResolver {
  resolveTxt(hostname: string): Promise<string[][]>;
}

/** Production resolver: delegates directly to node:dns/promises */
const defaultDnsResolver: DnsResolver = {
  resolveTxt: (hostname) => dns.resolveTxt(hostname),
};

// ─── Internal types ───────────────────────────────────────────────────────────
export type DnsFieldResult = {
  value: boolean | null;
  checked: boolean;
};

type DnsVerifiableDomain = {
  id: string;
  domain: string;
  dkimSelector: string | null;
  spfValid: boolean | null;
  dkimValid: boolean | null;
  dmarcValid: boolean | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function isTransientDnsError(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException)?.code;
  return code !== undefined && TRANSIENT_DNS_CODES.has(code);
}

export async function withDnsTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string
): Promise<T> {
  let timer: NodeJS.Timeout;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        Object.assign(
          new Error(`${label} timed out after ${ms}ms`),
          { code: "ETIMEOUT" }
        )
      );
    }, ms);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer!);
  }
}

// ─── Authorization ────────────────────────────────────────────────────────────
async function getDomainOrThrow(
  id: string,
  userId: string,
  orgId?: string,
  requiredRoles: OrgRole[] = WRITE_ROLES
) {
  const domain = await prisma.senderDomain.findUnique({
    where: { id },
  });

  if (!domain) {
    throw new NotFoundError("Sender domain");
  }

  // Organization-owned domain
  if (domain.orgId) {
    if (orgId && domain.orgId !== orgId) {
      throw new ForbiddenError();
    }

    const membership = await prisma.organizationMember.findUnique({
      where: {
        orgId_userId: {
          orgId: domain.orgId,
          userId,
        },
      },
      select: { role: true },
    });

    if (!membership || !requiredRoles.includes(membership.role)) {
      throw new ForbiddenError();
    }

    return domain;
  }

  // Personal domain (orgId === null)
  if (domain.createdById !== userId) {
    throw new ForbiddenError();
  }

  return domain;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────
export async function createSenderDomain(
  data: z.infer<typeof createSenderDomainSchema>,
  createdById: string,
  orgId?: string
) {
  try {
    return await prisma.senderDomain.create({
      data: {
        ...data,
        createdById,
        orgId,
      },
      include: DOMAIN_INCLUDE,
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new ConflictError(
        `Domain ${data.domain} is already registered`
      );
    }
    throw err;
  }
}

export async function getSenderDomains(
  query: z.infer<typeof getSenderDomainsQuerySchema>,
  userId: string,
  orgId?: string
) {
  const { health, warmupEnabled, page, limit } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.SenderDomainWhereInput = {
    OR: [
      ...(orgId ? [{ orgId }] : []),
      {
        orgId: null,
        createdById: userId,
      },
    ],
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
    meta: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
}

export async function getSenderDomainById(
  id: string,
  userId: string,
  orgId?: string
) {
  await getDomainOrThrow(id, userId, orgId);

  return prisma.senderDomain.findUnique({
    where: { id },
    include: {
      campaigns: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          name: true,
          status: true,
          dailySendLimit: true,
        },
      },
      deliverabilityEvents: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          type: true,
          severity: true,
          metadata: true,
          createdAt: true,
        },
      },
      _count: {
        select: { campaigns: true },
      },
    },
  });
}

export async function updateSenderDomain(
  id: string,
  userId: string,
  data: z.infer<typeof updateSenderDomainSchema>,
  orgId?: string
) {
  await getDomainOrThrow(id, userId, orgId);

  return prisma.senderDomain.update({
    where: { id },
    data,
    include: DOMAIN_INCLUDE,
  });
}

export async function deleteSenderDomain(
  id: string,
  userId: string,
  orgId?: string
) {
  await getDomainOrThrow(id, userId, orgId, DELETE_ROLES);

  const activeCampaigns = await prisma.campaign.count({
    where: {
      senderDomainId: id,
      status: {
        in: [
          "RESEARCHING",
          "GENERATING",
          "REVIEW",
          "QUEUED",
          "SENDING",
          "PAUSED",
        ],
      },
    },
  });

  if (activeCampaigns > 0) {
    throw new ConflictError(
      "Cannot delete a domain with active campaigns"
    );
  }

  return prisma.senderDomain.delete({ where: { id } });
}

export async function resetDailyCount(
  id: string,
  userId: string,
  orgId?: string
) {
  await getDomainOrThrow(id, userId, orgId);

  return prisma.senderDomain.update({
    where: { id },
    data: {
      currentSent: 0,
      lastResetAt: new Date(),
    },
  });
}

// ─── Public-suffix-aware DMARC parent walk ────────────────────────────────────
export function getParentDomain(domain: string): string | null {
  const orgDomain = getDomain(domain);
  if (!orgDomain || domain === orgDomain) return null;
  const labels = domain.split(".");
  if (labels.length <= 2) return null;
  const parent = labels.slice(1).join(".");
  const parentOrgDomain = getDomain(parent);
  if (!parentOrgDomain || parentOrgDomain !== orgDomain) return null;
  return parent;
}

// ─── DNS check primitives (exported for unit testing with injected resolver) ──
export async function checkSpf(
  domain: string,
  resolver: DnsResolver = defaultDnsResolver
): Promise<DnsFieldResult> {
  try {
    const records = await withDnsTimeout(
      resolver.resolveTxt(domain),
      DNS_LOOKUP_TIMEOUT_MS,
      "SPF lookup"
    );

    // RFC 7208 §3.2: a domain SHOULD publish exactly one SPF record.
    // We validate that at least one TXT record is a valid SPF record
    // starting with "v=spf1". We do NOT enforce "exactly one" here because
    // DNS can return multiple chunks per record; checking for presence is
    // the correct authoritative validation.
    const spfRecords = records.filter((chunks) =>
      chunks.join("").toLowerCase().startsWith("v=spf1")
    );

    return { value: spfRecords.length > 0, checked: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;

    if (isTransientDnsError(err)) {
      logger.warn({ err, domain, record: "SPF", code }, "[dns] transient lookup failure, keeping prior value");
      return { value: null, checked: false };
    }

    logger.debug({ err, domain, record: "SPF", code }, "[dns] no valid record found");
    return { value: false, checked: true };
  }
}

export async function checkDkim(
  domain: string,
  selector: string,
  resolver: DnsResolver = defaultDnsResolver
): Promise<DnsFieldResult> {
  try {
    const records = await withDnsTimeout(
      resolver.resolveTxt(`${selector}._domainkey.${domain}`),
      DNS_LOOKUP_TIMEOUT_MS,
      "DKIM lookup"
    );

    const value = records.some((chunks) =>
      chunks.join("").toLowerCase().includes("v=dkim1")
    );

    return { value, checked: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;

    if (isTransientDnsError(err)) {
      logger.warn({ err, domain, record: "DKIM", selector, code }, "[dns] transient lookup failure, keeping prior value");
      return { value: null, checked: false };
    }

    logger.debug({ err, domain, record: "DKIM", selector, code }, "[dns] no valid record found");
    return { value: false, checked: true };
  }
}

export async function checkDmarc(
  domain: string,
  resolver: DnsResolver = defaultDnsResolver
): Promise<DnsFieldResult> {
  try {
    const records = await withDnsTimeout(
      resolver.resolveTxt(`_dmarc.${domain}`),
      DNS_LOOKUP_TIMEOUT_MS,
      "DMARC lookup"
    );

    const value = records.some((chunks) =>
      chunks.join("").toLowerCase().startsWith("v=dmarc1")
    );

    return { value, checked: true };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;

    if (isTransientDnsError(err)) {
      logger.warn({ err, domain, record: "DMARC", code }, "[dns] transient lookup failure, keeping prior value");
      return { value: null, checked: false };
    }

    const parent = getParentDomain(domain);

    if (!parent) {
      logger.debug({ err, domain, record: "DMARC", code }, "[dns] no valid record found");
      return { value: false, checked: true };
    }

    // Recursive org-domain DMARC inheritance (public-suffix-safe)
    return checkDmarc(parent, resolver);
  }
}

// ─── Verification orchestration ───────────────────────────────────────────────
async function runDnsVerification(
  domain: DnsVerifiableDomain,
  resolver: DnsResolver = defaultDnsResolver
) {
  const selector = domain.dkimSelector ?? "default";

  const [spfResult, dkimResult, dmarcResult] = await Promise.allSettled([
    checkSpf(domain.domain, resolver),
    checkDkim(domain.domain, selector, resolver),
    checkDmarc(domain.domain, resolver),
  ]);

  const fallback: DnsFieldResult = { value: null, checked: false };

  const spf = spfResult.status === "fulfilled" ? spfResult.value : fallback;
  const dkim = dkimResult.status === "fulfilled" ? dkimResult.value : fallback;
  const dmarc = dmarcResult.status === "fulfilled" ? dmarcResult.value : fallback;

  if (spfResult.status === "rejected") {
    logger.error({ err: spfResult.reason, domain: domain.domain, record: "SPF" }, "[dns] unexpected lookup failure");
  }

  if (dkimResult.status === "rejected") {
    logger.error({ err: dkimResult.reason, domain: domain.domain, record: "DKIM" }, "[dns] unexpected lookup failure");
  }

  if (dmarcResult.status === "rejected") {
    logger.error({ err: dmarcResult.reason, domain: domain.domain, record: "DMARC" }, "[dns] unexpected lookup failure");
  }

  const dnsCheckedAt = new Date();

  const updateData: Prisma.SenderDomainUpdateInput = {
    dnsCheckedAt,
    ...(spf.value !== null && { spfValid: spf.value }),
    ...(dkim.value !== null && { dkimValid: dkim.value }),
    ...(dmarc.value !== null && { dmarcValid: dmarc.value }),
  };

  await prisma.senderDomain.update({
    where: { id: domain.id },
    data: updateData,
  });

  return {
    spfValid: spf.value ?? domain.spfValid ?? false,
    dkimValid: dkim.value ?? domain.dkimValid ?? false,
    dmarcValid: dmarc.value ?? domain.dmarcValid ?? false,
    dnsCheckedAt,
    inconclusive: {
      spf: !spf.checked,
      dkim: !dkim.checked,
      dmarc: !dmarc.checked,
    },
  };
}

// ─── Public DNS verification entry points ─────────────────────────────────────

/** User-triggered verification — enforces full ownership check. */
export async function verifySenderDomainDns(
  id: string,
  userId: string,
  orgId?: string
) {
  const domain = await getDomainOrThrow(id, userId, orgId);
  return runDnsVerification(domain);
}

/** Internal/backend-triggered verification — bypasses ownership check. */
export async function verifySenderDomainDnsInternal(id: string) {
  const domain = await prisma.senderDomain.findUnique({ where: { id } });
  if (!domain) throw new NotFoundError("Sender domain");
  return runDnsVerification(domain);
}

/** Read cached DNS status without performing a live lookup. */
export async function getCachedDnsStatus(id: string) {
  const domain = await prisma.senderDomain.findUnique({
    where: { id },
    select: {
      spfValid: true,
      dkimValid: true,
      dmarcValid: true,
      dnsCheckedAt: true,
    },
  });

  if (!domain) throw new NotFoundError("Sender domain");
  return domain;
}