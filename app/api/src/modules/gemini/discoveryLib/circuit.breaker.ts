import { redis } from "../../../lib/ioredis";
import { logger } from "../../../lib/logger";
import { redisKeys } from "./redis.keys";
import { CB_FAILURE_THRESHOLD, CB_RESET_MS, CB_TTL_S } from "./discovery.constants";

interface CircuitBreakerState {
    failures: number;
    openedAt: number | null;
}

async function getState(name: string): Promise<CircuitBreakerState> {
    try {
        const raw = await redis.get(redisKeys.circuitBreaker(name));
        if (!raw) return { failures: 0, openedAt: null };
        return JSON.parse(raw) as CircuitBreakerState;
    } catch {
        return { failures: 0, openedAt: null };
    }
}

async function setState(name: string, state: CircuitBreakerState): Promise<void> {
    try {
        await redis.set(redisKeys.circuitBreaker(name), JSON.stringify(state), "EX", CB_TTL_S);
    } catch {
    }
}

export async function circuitBreakerAllow(name: string): Promise<boolean> {
    const state = await getState(name);
    if (state.openedAt === null) return true;
    if (Date.now() - state.openedAt >= CB_RESET_MS) {
        await setState(name, { failures: 0, openedAt: null });
        return true;
    }
    return false;
}

export async function circuitBreakerSuccess(name: string): Promise<void> {
    await setState(name, { failures: 0, openedAt: null });
}

export async function circuitBreakerFailure(name: string): Promise<void> {
    const state = await getState(name);
    const failures = state.failures + 1;
    const openedAt =
        failures >= CB_FAILURE_THRESHOLD && state.openedAt === null
            ? Date.now()
            : state.openedAt;
    if (openedAt !== state.openedAt) {
        logger.warn({ name, failures }, "[discovery] Circuit breaker opened");
    }
    await setState(name, { failures, openedAt });
}