import { logger } from "../logger";

export type BackpressureLevel = "NORMAL" | "THROTTLE" | "HALT";

export interface SystemHealthSnapshot {
    waiting: number;
    active: number;
    oldestWaitingAgeMs: number;
    processingLatencyMs: number;
    throughputPerMin: number;
    redisMemoryRatio: number;
    provider429Rate: number;
}

const HALT_THRESHOLDS = {
    redisMemoryRatio: 0.85,
    oldestWaitingAgeMs: 300_000,
    provider429Rate: 0.25,
};

const THROTTLE_THRESHOLDS = {
    waiting: 500,
    processingLatencyMs: 10_000,
    provider429Rate: 0.10,
};

async function collectSnapshot(
    queues: Array<{
        getWaitingCount: () => Promise<number>;
        getActiveCount: () => Promise<number>;
        getWaiting: (start: number, end: number) => Promise<Array<{ timestamp: number }>>;
    }>,
    redis: {
        info: (section: string) => Promise<string>;
        get: (key: string) => Promise<string | null>;
    },
): Promise<SystemHealthSnapshot> {
    const [waitingCounts, activeCounts] = await Promise.all([
        Promise.all(queues.map((q) => q.getWaitingCount())),
        Promise.all(queues.map((q) => q.getActiveCount())),
    ]);

    const waiting = waitingCounts.reduce((a, b) => a + b, 0);
    const active = activeCounts.reduce((a, b) => a + b, 0);

    const redisInfo = await redis.info("memory");
    const usedMatch = redisInfo.match(/used_memory:(\d+)/);
    const maxMatch = redisInfo.match(/maxmemory:(\d+)/);
    const usedBytes = usedMatch ? parseInt(usedMatch[1], 10) : 0;
    const maxBytes = maxMatch ? parseInt(maxMatch[1], 10) : 0;
    const redisMemoryRatio = maxBytes > 0 ? usedBytes / maxBytes : 0;

    const [p429Raw, latencyRaw, throughputRaw] = await Promise.all([
        redis.get("metrics:provider:429rate"),
        redis.get("metrics:queue:latency_ms"),
        redis.get("metrics:queue:throughput_per_min"),
    ]);

    const provider429Rate = parseFloat(p429Raw ?? "0");
    const processingLatencyMs = parseFloat(latencyRaw ?? "0");
    const throughputPerMin = parseFloat(throughputRaw ?? "0");

    const oldestJobs = await queues[0]?.getWaiting(0, 0).catch(() => []);
    const oldestWaitingAgeMs =
        oldestJobs[0]?.timestamp ? Date.now() - oldestJobs[0].timestamp : 0;

    return {
        waiting,
        active,
        oldestWaitingAgeMs,
        processingLatencyMs,
        throughputPerMin,
        redisMemoryRatio,
        provider429Rate,
    };
}

export async function evaluateBackpressure(
    queues: Array<{
        getWaitingCount: () => Promise<number>;
        getActiveCount: () => Promise<number>;
        getWaiting: (start: number, end: number) => Promise<Array<{ timestamp: number }>>;
    }>,
    redis: {
        info: (section: string) => Promise<string>;
        get: (key: string) => Promise<string | null>;
    },
): Promise<BackpressureLevel> {
    const snap = await collectSnapshot(queues, redis);

    if (
        snap.redisMemoryRatio > HALT_THRESHOLDS.redisMemoryRatio ||
        snap.oldestWaitingAgeMs > HALT_THRESHOLDS.oldestWaitingAgeMs ||
        snap.provider429Rate > HALT_THRESHOLDS.provider429Rate
    ) {
        logger.error(
            { snap },
            "[backpressure] HALT — critical queue/memory/provider pressure — upstream discovery stopped",
        );
        return "HALT";
    }

    if (
        snap.waiting > THROTTLE_THRESHOLDS.waiting ||
        snap.processingLatencyMs > THROTTLE_THRESHOLDS.processingLatencyMs ||
        snap.provider429Rate > THROTTLE_THRESHOLDS.provider429Rate
    ) {
        logger.warn(
            { snap },
            "[backpressure] THROTTLE — elevated load detected — reducing upstream dispatch",
        );
        return "THROTTLE";
    }

    return "NORMAL";
}
