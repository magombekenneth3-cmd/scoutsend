import { redis } from "../ioredis";
import { logger } from "../../lib/logger";
import {
    MAX_RETRY_ATTEMPTS,
    RETRY_BASE_MS,
    SEM_LIMIT,
    SEM_ACQUIRE_TIMEOUT_MS,
    CB_THRESHOLD,
    CB_COOLDOWN_MS,
    IDEMPOTENCY_TTL_MS,
} from "./replyTypes";

const SEM_GLOBAL_KEY = "sem:gemini:global:active";
const SEM_TENANT_PREFIX = "sem:gemini:tenant:";
const SEM_TENANT_LIMIT = 3;
const SEM_TTL_SECONDS = 120;
const CB_FAILURES_KEY = "cb:gemini:global:failures";
const CB_OPEN_UNTIL_KEY = "cb:gemini:global:open_until";
const IDEMPOTENCY_KEY_PREFIX = "reply:classify:";
const PROCESSING_LOCK_TTL_MS = 300_000;

const SEM_ACQUIRE_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current >= tonumber(ARGV[1]) then
  return 0
end
redis.call('INCR', KEYS[1])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
return 1
`;

const SEM_RELEASE_SCRIPT = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
if current > 0 then
  return redis.call('DECR', KEYS[1])
end
return 0
`;

function toFiniteNumber(value: unknown, fallback: number): number {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        const parsed = Number(value);
        if (Number.isFinite(parsed)) return parsed;
    }
    return fallback;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function tryAcquireSlot(key: string, limit: number): Promise<boolean> {
    const result = await redis.eval(
        SEM_ACQUIRE_SCRIPT,
        1,
        key,
        String(limit),
        String(SEM_TTL_SECONDS),
    );
    return toFiniteNumber(result, 0) === 1;
}

async function releaseSlot(key: string): Promise<void> {
    try {
        await redis.eval(SEM_RELEASE_SCRIPT, 1, key);
    } catch (err) {
        logger.warn({ err, key }, "[reply-infra] Semaphore release failed");
    }
}

async function acquireSlotWithDeadline(key: string, limit: number, deadline: number): Promise<void> {
    while (Date.now() < deadline) {
        try {
            if (await tryAcquireSlot(key, limit)) return;
        } catch (err) {
            logger.warn({ err, key }, "[reply-infra] Semaphore acquire Redis error, retrying");
        }
        const remaining = deadline - Date.now();
        if (remaining <= 0) break;
        await sleep(Math.min(80, remaining));
    }
    throw new Error(`Semaphore acquisition timeout for key ${key}`);
}

async function cbIsOpen(): Promise<boolean> {
    try {
        const raw = await redis.get(CB_OPEN_UNTIL_KEY);
        if (!raw) return false;
        return Date.now() < toFiniteNumber(raw, 0);
    } catch {
        return false;
    }
}

async function cbSuccess(): Promise<void> {
    try {
        await redis.del(CB_FAILURES_KEY, CB_OPEN_UNTIL_KEY);
    } catch (err) {
        logger.warn({ err }, "[reply-infra] Circuit breaker reset failed");
    }
}

async function cbFailure(): Promise<void> {
    try {
        const failures = await redis.incr(CB_FAILURES_KEY);
        await redis.expire(CB_FAILURES_KEY, Math.ceil(CB_COOLDOWN_MS / 1000));
        if (failures >= CB_THRESHOLD) {
            const openUntil = Date.now() + CB_COOLDOWN_MS;
            await redis.set(CB_OPEN_UNTIL_KEY, String(openUntil), "PX", CB_COOLDOWN_MS);
            logger.warn({ failures, openUntil }, "[reply-infra] Circuit breaker opened for Gemini");
        }
    } catch (err) {
        logger.warn({ err }, "[reply-infra] Circuit breaker failure recording failed");
    }
}

export async function guardedCall<T>(fn: () => Promise<T>, tenantId?: string): Promise<T> {
    if (await cbIsOpen()) {
        throw new Error("Circuit breaker open: Gemini unavailable");
    }

    const deadline = Date.now() + SEM_ACQUIRE_TIMEOUT_MS;
    const tenantKey = tenantId ? `${SEM_TENANT_PREFIX}${tenantId}` : null;

    if (tenantKey) {
        await acquireSlotWithDeadline(tenantKey, SEM_TENANT_LIMIT, deadline);
    }

    try {
        await acquireSlotWithDeadline(SEM_GLOBAL_KEY, SEM_LIMIT, deadline);
    } catch (err) {
        if (tenantKey) await releaseSlot(tenantKey);
        throw err;
    }

    try {
        const result = await fn();
        await cbSuccess();
        return result;
    } catch (err) {
        await cbFailure();
        throw err;
    } finally {
        await releaseSlot(SEM_GLOBAL_KEY);
        if (tenantKey) await releaseSlot(tenantKey);
    }
}

export function isRetryableError(err: unknown): boolean {
    if (err instanceof Error) {
        if (/circuit breaker/i.test(err.message)) return false;
        if (/timeout/i.test(err.message)) return true;
        if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|network/i.test(err.message)) return true;
    }
    const status = (err as Record<string, unknown> | null)?.["status"];
    if (typeof status === "number") {
        return [429, 500, 502, 503, 504].includes(status);
    }
    return false;
}

export async function withRetry<T>(
    fn: () => Promise<T>,
    attempts = MAX_RETRY_ATTEMPTS,
    baseMs = RETRY_BASE_MS,
): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i < attempts; i++) {
        try {
            return await fn();
        } catch (err) {
            lastErr = err;
            if (i === attempts - 1 || !isRetryableError(err)) throw err;
            await sleep(baseMs * Math.pow(2, i) * (1 + Math.random() * 0.2));
        }
    }
    throw lastErr;
}

export async function withTimeout<T>(factory: () => Promise<T>, ms: number): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            const err = new Error(`Operation timed out after ${ms}ms`);
            controller.abort(err);
            reject(err);
        }, ms);
    });

    try {
        return await Promise.race([factory(), timeoutPromise]);
    } finally {
        clearTimeout(timer);
        if (!controller.signal.aborted) controller.abort();
    }
}

export function repairAndParseJSON<T>(text: string): T {
    const stripped = text
        .replace(/^```(?:json)?\s*/m, "")
        .replace(/\s*```\s*$/m, "")
        .trim();
    const noTrailingCommas = stripped.replace(/,(\s*[}\]])/g, "$1");
    return JSON.parse(noTrailingCommas) as T;
}

export async function claimMessageForProcessing(id: string): Promise<boolean> {
    try {
        const result = await redis.set(
            `${IDEMPOTENCY_KEY_PREFIX}${id}`,
            "processing",
            "PX",
            PROCESSING_LOCK_TTL_MS,
            "NX",
        );
        return result === "OK";
    } catch (err) {
        logger.error({ err, id }, "[reply-infra] Redis claim failed, failing open");
        return true;
    }
}

export async function markMessageProcessed(id: string): Promise<void> {
    try {
        await redis.set(`${IDEMPOTENCY_KEY_PREFIX}${id}`, "done", "PX", IDEMPOTENCY_TTL_MS);
    } catch (err) {
        logger.error({ err, id }, "[reply-infra] Redis mark-processed failed");
    }
}

export async function releaseMessageClaim(id: string): Promise<void> {
    try {
        await redis.del(`${IDEMPOTENCY_KEY_PREFIX}${id}`);
    } catch (err) {
        logger.error({ err, id }, "[reply-infra] Redis release-claim failed");
    }
}

export function recordMetric(name: string, durationMs: number, tags: Record<string, unknown> = {}): void {
    logger.debug({ metric: name, durationMs, ...tags }, "[reply] metric");
}

export function emitLearningEvent(type: string, messageId: string, payload: Record<string, unknown>): void {
    logger.info({ eventType: type, messageId, ...payload }, "[reply] learning-event");
}