import IORedis from "ioredis";
import { logger } from "./logger";

export const redis = new IORedis(
  process.env.REDIS_URL ?? "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
    reconnectOnError: (err) => err.message.includes("READONLY"),
  }
);

redis.on("error", (err) => {
  logger.error({ err }, "Redis connection error");
});

export const createRedisConnection = () => {
  const conn = new IORedis(
    process.env.REDIS_URL ?? "redis://localhost:6379",
    {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      lazyConnect: true,
      reconnectOnError: (err) => err.message.includes("READONLY"),
    }
  );
  conn.on("error", (err) => {
    logger.error({ err }, "Redis connection error in dynamically created connection");
  });
  return conn;
};

export const redisConnectionOptions = {
  maxRetriesPerRequest: null as null,
  enableReadyCheck: false,
};