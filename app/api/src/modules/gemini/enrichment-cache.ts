import { redis } from "../../lib/ioredis";
import { logger } from "../../lib/logger";

export interface CachedEmailResolution {
  email: string;
  source: string;
  verified: boolean;
  catchAll: boolean;
}

export type EnrichmentCacheNamespace = "person" | "domain";

const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

export function buildEnrichmentCacheKey(parts: Array<string | null | undefined>): string {
  const normalized = parts
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim().toLowerCase());

  return normalized.length > 0 ? `enrichment:${normalized.join(":")}` : "enrichment:empty";
}

export async function getCachedEnrichmentValue<T>(
  key: string,
  namespace: EnrichmentCacheNamespace,
): Promise<T | null> {
  const fullKey = `${namespace}:${key}`;

  try {
    const raw = await redis.get(fullKey);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    logger.warn({ err, key: fullKey }, "[enrichment-cache] read failed");
    return null;
  }
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
