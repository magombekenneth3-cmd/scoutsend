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

const BUCKET_CONFIGS: Record<string, BucketConfig> = {
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

const DEFAULT_CONFIG: BucketConfig = { rpm: 15, concurrency: 3 };

class ModelBucket {
    private readonly rpm: number;
    private readonly maxConcurrency: number;
    private inFlight = 0;
    private readonly queue: QueueEntry[] = [];
    private readonly timestamps: number[] = [];
    private throttledUntil = 0;
    private drainTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly key: string, config: BucketConfig) {
        this.rpm = config.rpm;
        this.maxConcurrency = config.concurrency;
    }

    schedule<T>(fn: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            if (this.queue.length >= MAX_QUEUE_PER_BUCKET) {
                reject(
                    new Error(
                        `[gemini-limiter] Queue saturated for ${this.key} (limit: ${MAX_QUEUE_PER_BUCKET})`,
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

    signalThrottled(retryAfterMs: number): void {
        const resumeAt = Date.now() + retryAfterMs;
        if (resumeAt > this.throttledUntil) {
            this.throttledUntil = resumeAt;
            logger.warn(
                { model: this.key, retryAfterMs },
                "[gemini-limiter] Throttled — pausing bucket",
            );
            this.scheduleNextDrain();
        }
    }

    get queueDepth(): number {
        return this.queue.length;
    }

    get inflightCount(): number {
        return this.inFlight;
    }

    private purgeWindow(): void {
        const cutoff = Date.now() - WINDOW_MS;
        let i = 0;
        while (i < this.timestamps.length && this.timestamps[i] <= cutoff) i++;
        if (i) this.timestamps.splice(0, i);
    }

    private drain(): void {
        this.purgeWindow();
        const now = Date.now();

        while (
            this.queue.length > 0 &&
            this.inFlight < this.maxConcurrency &&
            this.timestamps.length < this.rpm &&
            now >= this.throttledUntil
        ) {
            this.dispatch(this.queue.shift()!);
        }

        if (this.queue.length > 0) this.scheduleNextDrain();
    }

    private dispatch(entry: QueueEntry): void {
        this.inFlight++;
        this.timestamps.push(Date.now());

        let p: Promise<unknown>;
        try {
            p = entry.fn();
        } catch (err) {
            this.inFlight--;
            entry.reject(err);
            this.drain();
            return;
        }

        p.then(
            (result) => {
                this.inFlight--;
                entry.resolve(result);
                this.drain();
            },
            (err) => {
                this.inFlight--;
                entry.reject(err);
                this.drain();
            },
        );
    }

    private scheduleNextDrain(): void {
        if (this.drainTimer !== null) {
            clearTimeout(this.drainTimer);
            this.drainTimer = null;
        }

        if (!this.queue.length) return;
        if (this.inFlight >= this.maxConcurrency) return;

        this.purgeWindow();
        const now = Date.now();
        const throttleWait = Math.max(0, this.throttledUntil - now);
        const rpmWait =
            this.timestamps.length >= this.rpm
                ? Math.max(0, this.timestamps[0] + WINDOW_MS - now)
                : 0;

        const wait = Math.max(throttleWait, rpmWait);
        if (wait === 0) return;

        this.drainTimer = setTimeout(() => {
            this.drainTimer = null;
            this.drain();
        }, wait + 10);
    }
}

class GeminiLimiter {
    private readonly buckets = new Map<string, ModelBucket>();

    private bucket(model: string): ModelBucket {
        let b = this.buckets.get(model);
        if (!b) {
            const config = BUCKET_CONFIGS[model] ?? DEFAULT_CONFIG;
            b = new ModelBucket(model, config);
            this.buckets.set(model, b);
        }
        return b;
    }

    schedule<T>(model: string, fn: () => Promise<T>): Promise<T> {
        return this.bucket(model).schedule(fn);
    }

    signalThrottled(model: string, retryAfterMs: number): void {
        this.bucket(model).signalThrottled(retryAfterMs);
    }

    stats(): Record<string, { queued: number; inflight: number }> {
        const out: Record<string, { queued: number; inflight: number }> = {};
        for (const [key, b] of this.buckets) {
            out[key] = { queued: b.queueDepth, inflight: b.inflightCount };
        }
        return out;
    }
}

export const geminiLimiter = new GeminiLimiter();