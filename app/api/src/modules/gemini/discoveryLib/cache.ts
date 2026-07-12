import { redis } from "../../../lib/ioredis";
import { logger } from "../../../lib/logger";
import { CACHE_NULL_SENTINEL } from "./discovery.constants";

export async function cacheGet<T>(key: string): Promise<T | null> {
    try {
        const raw = await redis.get(key);
        if (!raw) return null;
        return JSON.parse(raw) as T;
    } catch {
        return null;
    }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    try {
        await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch (err) {
        logger.debug({ err, key }, "[discovery] Cache write failed — continuing without cache");
    }
}

export async function cacheGetNullable(key: string): Promise<string | null | undefined> {
    try {
        const raw = await redis.get(key);
        if (raw === null) return undefined;
        return raw === CACHE_NULL_SENTINEL ? null : raw;
    } catch {
        return undefined;
    }
}

export async function cacheSetNullable(key: string, value: string | null, ttlSeconds: number): Promise<void> {
    try {
        await redis.set(key, value ?? CACHE_NULL_SENTINEL, "EX", ttlSeconds);
    } catch (err) {
        logger.debug({ err, key }, "[discovery] Cache write (nullable) failed — continuing without cache");
    }
}