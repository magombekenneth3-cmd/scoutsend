import { redis } from "../../lib/ioredis";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";

export interface CachedEmailResolution {
  email: string;
  source: string;
  verified: boolean;
  catchAll: boolean;
}

export type EnrichmentCacheNamespace = "person" | "domain";

const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days — aligned with CROSS_CAMPAIGN_CACHE_MAX_AGE_DAYS

export function buildEnrichmentCacheKey(parts: Array<string | null | undefined>): string {
  const normalized = parts
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());

  return normalized.length >= 2 ? `enrichment:${normalized.join(":")}` : "enrichment:empty";
}

export async function getCachedEnrichmentValue<T>(
  key: string,
  namespace: EnrichmentCacheNamespace,
): Promise<T | null> {
  const fullKey = `${namespace}:${key}`;

  try {
    const raw = await redis.get(fullKey);
    if (raw) {
      return JSON.parse(raw) as T;
    }
  } catch (err) {
    logger.warn({ err, key: fullKey }, "[enrichment-cache] Redis read failed");
  }

  // Postgres DB fallback for person namespace cache misses
  if (namespace === "person" && key.startsWith("enrichment:")) {
    try {
      const parts = key.replace(/^enrichment:/, "").split(":");
      const emailCandidate = parts.find((p) => p.includes("@"));
      
      const freshnessCutoff = new Date(Date.now() - CACHE_TTL_MS);
      const lead = await prisma.lead.findFirst({
        where: {
          emailStatus: "FOUND",
          deletedAt: null,
          lastEnrichedAt: { gte: freshnessCutoff },
          OR: [
            emailCandidate ? { email: { equals: emailCandidate, mode: "insensitive" } } : undefined,
            parts.length >= 2 ? { firstName: { equals: parts[1], mode: "insensitive" }, lastName: { equals: parts[2], mode: "insensitive" } } : undefined,
          ].filter(Boolean) as any[],
        },
        select: { email: true, emailSource: true, emailVerified: true, emailCatchAll: true },
        orderBy: { lastEnrichedAt: "desc" },
      });

      if (lead?.email) {
        const resolution: CachedEmailResolution = {
          email: lead.email,
          source: lead.emailSource ?? "DB_FALLBACK",
          verified: lead.emailVerified ?? false,
          catchAll: lead.emailCatchAll ?? false,
        };
        await setCachedEnrichmentValue(key, namespace, resolution);
        logger.info({ key: fullKey, email: lead.email }, "[enrichment-cache] DB fallback hit — backfilled Redis");
        return resolution as unknown as T;
      }
    } catch (dbErr) {
      logger.warn({ err: dbErr, key: fullKey }, "[enrichment-cache] DB fallback query failed");
    }
  }

  return null;
}


export async function setCachedEnrichmentValue<T>(
  key: string,
  namespace: EnrichmentCacheNamespace,
  value: T,
  ttlMs = CACHE_TTL_MS,
): Promise<void> {
  const fullKey = `${namespace}:${key}`;

  try {
    await redis.set(fullKey, JSON.stringify(value), "PX", ttlMs);
  } catch (err) {
    logger.warn({ err, key: fullKey }, "[enrichment-cache] write failed");
  }
}
