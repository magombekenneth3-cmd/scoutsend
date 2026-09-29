import { redis } from "../../lib/ioredis";
import { logger } from "../../lib/logger";

const WINDOW_MS = 60_000;
const MAX_QUEUE_PER_BUCKET = Number(process.env.GEMINI_MAX_QUEUE_SIZE ?? 500);

interface BucketConfig {
    rpm: number;
    concurrency: number;
}

interface QueueEntry {
    fn: () => Promise<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
}

export const BUCKET_CONFIGS: Record<string, BucketConfig> = {
    "gemini-3.1-flash-lite": {
        rpm: Number(process.env.GEMINI_3_1_FLASH_LITE_RPM ?? 30),
        concurrency: Number(process.env.GEMINI_3_1_FLASH_LITE_CONCURRENCY ?? 5),
    },
    "gemini-2.0-flash": {
        rpm: Number(process.env.GEMINI_2_0_FLASH_RPM ?? 30),
        concurrency: Number(process.env.GEMINI_2_0_FLASH_CONCURRENCY ?? 5),
    },
    "gemini-2.5-flash": {
        rpm: Number(process.env.GEMINI_2_5_FLASH_RPM ?? 20),
        concurrency: Number(process.env.GEMINI_2_5_FLASH_CONCURRENCY ?? 3),
    },
    "text-embedding-004": {
        rpm: Number(process.env.GEMINI_EMBED_RPM ?? 50),
        concurrency: Number(process.env.GEMINI_EMBED_CONCURRENCY ?? 10),
    },
};

export const DEFAULT_CONFIG: BucketConfig = { rpm: 15, concurrency: 3 };

class RedisModelBucket {
    private readonly rpm: number;
    private readonly maxConcurrency: number;
    private readonly queue: QueueEntry[] = [];
    private drainTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly model: string, config: BucketConfig) {
        this.rpm = config.rpm;
        this.maxConcurrency = config.concurrency;
    }

    schedule<T>(fn: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            if (this.queue.length >= MAX_QUEUE_PER_BUCKET) {
                reject(
                    new Error(
                        `[gemini-limiter] Queue saturated for ${this.model} (limit: ${MAX_QUEUE_PER_BUCKET})`,
                    ),
                );
                return;
            }
            this.queue.push({
                fn: fn as () => Promise<unknown>,
                resolve: resolve as (v: unknown) => void,
                reject,
            });
            this.drain();
        });
    }

    async signalThrottled(retryAfterMs: number): Promise<void> {
        const key = `gemini:limiter:throttled:${this.model}`;
        try {
            await redis.set(key, "1", "PX", Math.max(1000, retryAfterMs));
            logger.warn(
                { model: this.model, retryAfterMs },
                "[gemini-limiter] Throttled in Redis — pausing model across all processes",
            );
        } catch (err) {
            logger.warn({ err, model: this.model }, "[gemini-limiter] Redis error setting throttle signal");
        }
    }

    get queueDepth(): number {
        return this.queue.length;
    }

    private async tryAcquire(): Promise<boolean> {
        const now = Date.now();
        const cutoff = now - WINDOW_MS;
        const tsKey = `gemini:limiter:ts:${this.model}`;
        const inflightKey = `gemini:limiter:inflight:${this.model}`;
        const throttleKey = `gemini:limiter:throttled:${this.model}`;

        try {
            const isThrottled = await redis.exists(throttleKey);
            if (isThrottled) return false;

            const inflightStr = await redis.get(inflightKey);
            const inflight = inflightStr ? parseInt(inflightStr, 10) : 0;
            if (inflight >= this.maxConcurrency) return false;

            await redis.zremrangebyscore(tsKey, "-inf", cutoff.toString());
            const count = await redis.zcard(tsKey);
            if (count >= this.rpm) return false;

            const requestId = `${now}:${Math.random().toString(36).slice(2, 8)}`;
            await redis.zadd(tsKey, now, requestId);
            await redis.expire(tsKey, 120);
            await redis.incr(inflightKey);
            await redis.expire(inflightKey, 300);

            return true;
        } catch (err) {
            logger.warn({ err, model: this.model }, "[gemini-limiter] Redis error in tryAcquire — failing open locally");
            return true;
        }
    }

    private async releaseInflight(): Promise<void> {
        const inflightKey = `gemini:limiter:inflight:${this.model}`;
        try {
            const val = await redis.decr(inflightKey);
            if (val < 0) await redis.set(inflightKey, "0");
        } catch (err) {
            logger.warn({ err, model: this.model }, "[gemini-limiter] Redis error in releaseInflight");
        }
    }

    private async drain(): Promise<void> {
        if (this.queue.length === 0) return;

        const acquired = await this.tryAcquire();
        if (!acquired) {
            this.scheduleNextDrain(200);
            return;
        }

        const entry = this.queue.shift();
        if (!entry) return;

        this.dispatch(entry);
        if (this.queue.length > 0) {
            this.drain();
        }
    }

    private dispatch(entry: QueueEntry): void {
        let p: Promise<unknown>;
        try {
            p = entry.fn();
        } catch (err) {
            this.releaseInflight().catch(() => {});
            entry.reject(err);
            this.drain();
            return;
        }

        p.then(
            (result) => {
                this.releaseInflight().catch(() => {});
                entry.resolve(result);
                this.drain();
            },
            (err) => {
                this.releaseInflight().catch(() => {});
                entry.reject(err);
                this.drain();
            },
        );
    }

    private scheduleNextDrain(delayMs: number): void {
        if (this.drainTimer !== null) return;
        this.drainTimer = setTimeout(() => {
            this.drainTimer = null;
            this.drain();
        }, delayMs);
    }
}

class GeminiLimiter {
    private readonly buckets = new Map<string, RedisModelBucket>();

    private bucket(model: string): RedisModelBucket {
        let b = this.buckets.get(model);
        if (!b) {
            const config = BUCKET_CONFIGS[model] ?? DEFAULT_CONFIG;
            b = new RedisModelBucket(model, config);
            this.buckets.set(model, b);
        }
        return b;
    }

    schedule<T>(model: string, fn: () => Promise<T>): Promise<T> {
        return this.bucket(model).schedule(fn);
    }

    signalThrottled(model: string, retryAfterMs: number): void {
        void this.bucket(model).signalThrottled(retryAfterMs);
    }

    stats(): Record<string, { queued: number }> {
        const out: Record<string, { queued: number }> = {};
        for (const [key, b] of this.buckets) {
            out[key] = { queued: b.queueDepth };
        }
        return out;
    }
}

export const geminiLimiter = new GeminiLimiter();