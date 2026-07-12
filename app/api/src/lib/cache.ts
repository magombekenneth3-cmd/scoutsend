import { redis } from "./ioredis";

export class CacheService {
  static async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>
  ): Promise<T> {
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached) as T;
    }
    const data = await fetcher();
    await redis.set(key, JSON.stringify(data));
    return data;
  }

  static async getOrSetVersioned<T>(
    baseKey: string,
    versionKey: string,
    fetcher: () => Promise<T>
  ): Promise<T> {
    const version = (await redis.get(versionKey)) ?? "1";
    const cacheKey = `${baseKey}:v${version}`;
    return this.getOrSet(cacheKey, fetcher);
  }

  static async invalidateVersioned(versionKey: string): Promise<void> {
    await redis.incr(versionKey);
  }

  static async invalidate(key: string): Promise<void> {
    await redis.del(key);
  }
}
