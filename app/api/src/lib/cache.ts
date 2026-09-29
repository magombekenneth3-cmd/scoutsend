import { redis } from "./ioredis";
import { logger } from "./logger";

export class CacheService {
    static async getOrSet<T>(
        key: string,
        fetcher: () => Promise<T>,
        ttlSeconds = 30
    ): Promise<T> {
        const cached = await redis.get(key);
        if (cached) return JSON.parse(cached) as T;
        const data = await fetcher();
        await redis.set(key, JSON.stringify(data), "EX", ttlSeconds);
        return data;
    }

    static async getOrSetVersioned<T>(
        baseKey: string,
        versionKey: string,
        fetcher: () => Promise<T>,
        ttlSeconds = 30
    ): Promise<T> {
        try {
            const version = (await redis.get(versionKey)) ?? "1";
            const cacheKey = `${baseKey}:v${version}`;
            return await this.getOrSet(cacheKey, fetcher, ttlSeconds);
        } catch (err) {
            logger.warn(
                { err, baseKey, versionKey },
                "[cache] Redis unavailable — bypassing cache, going direct to DB"
            );
            return fetcher();
        }
    }

    static async invalidateVersioned(versionKey: string): Promise<void> {
        try {
            await redis.incr(versionKey);
        } catch (err) {
            logger.warn({ err, versionKey }, "[cache] Redis unavailable — skipping cache invalidation");
        }
    }

    static async invalidate(key: string): Promise<void> {
        try {
            await redis.del(key);
        } catch (err) {
            logger.warn({ err, key }, "[cache] Redis unavailable — skipping cache invalidation");
        }
    }
}
