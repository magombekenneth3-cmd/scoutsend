import { redis } from "./ioredis";

export async function isRateLimited(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  try {
    const results = await redis.multi()
      .set(key, "0", "EX", windowSeconds, "NX")
      .incr(key)
      .exec();
    const current = (results?.[1]?.[1] ?? 0) as number;
    return current > limit;
  } catch {
    return false;
  }
}

export function getClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "127.0.0.1";
}
