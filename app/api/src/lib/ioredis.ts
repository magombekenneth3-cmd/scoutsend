import IORedis from "ioredis";
import { logger } from "./logger";

function buildConnectionOptions(url: string): Record<string, unknown> {
  try {
    const parsed = new URL(url);
    const opts: Record<string, unknown> = {
      host: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : 6379,
      db: parsed.pathname && parsed.pathname !== "/" ? parseInt(parsed.pathname.slice(1), 10) : 0,
    };
    if (parsed.password) opts.password = decodeURIComponent(parsed.password);
    if (parsed.protocol === "rediss:") {
      // SECURITY FIX: removed rejectUnauthorized: false.
      // Set REDIS_SSL_REJECT_UNAUTHORIZED=false only for dev environments
      // with self-signed certs (e.g. local rediss:// with custom CA).
      const rejectUnauthorized = process.env.REDIS_SSL_REJECT_UNAUTHORIZED !== "false";
      opts.tls = { rejectUnauthorized };
    }
    return opts;
  } catch {
    return {};
  }
}

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const parsedOpts = buildConnectionOptions(REDIS_URL);

export const redis = new IORedis(REDIS_URL, {
  ...parsedOpts,
  commandTimeout: 2_000,
  maxRetriesPerRequest: 1,
  enableReadyCheck: true,
  lazyConnect: false,
  reconnectOnError: (err: Error) => err.message.includes("READONLY"),
} as any);

redis.on("error", (err) => {
  logger.error({ err }, "Redis connection error");
});

export const createRedisConnection = () => {
  const conn = new IORedis(REDIS_URL, {
    ...parsedOpts,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
    reconnectOnError: (err: Error) => err.message.includes("READONLY"),
  } as any);
  conn.on("error", (err) => {
    logger.error({ err }, "Redis connection error in dynamically created connection");
  });
  return conn;
};

export const redisConnectionOptions = {
  ...parsedOpts,
  maxRetriesPerRequest: null as null,
  enableReadyCheck: false,
};