import { redis } from "./ioredis";
import { logger } from "./logger";

const BLOCK_TTL_429 = 3_600;
const BLOCK_TTL_AUTH = 86_400;

export class ApiKeyVault {
  private readonly serviceName: string;
  private readonly keys: string[];

  constructor(serviceName: string, envCsvName: string) {
    this.serviceName = serviceName;
    const raw = process.env[envCsvName] ?? "";
    this.keys = raw
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
  }

  async acquireKey(): Promise<string> {
    if (this.keys.length === 0) {
      throw new Error(`[key-manager] No keys configured for: ${this.serviceName}`);
    }

    for (const key of this.keys) {
      const blocked = await redis.get(`kv:blocked:${this.serviceName}:${key.slice(-8)}`);
      if (!blocked) return key;
    }

    throw new Error(`[key-manager] All keys exhausted for: ${this.serviceName}`);
  }

  async reportFailure(key: string, statusCode: number): Promise<void> {
    const ttl = statusCode === 429 ? BLOCK_TTL_429 : BLOCK_TTL_AUTH;
    await redis.setex(`kv:blocked:${this.serviceName}:${key.slice(-8)}`, ttl, "1");
    logger.warn({ service: this.serviceName, statusCode, ttl }, "[key-manager] Key blocked");
  }
}
