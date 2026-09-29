#!/usr/bin/env node
/**
 * STATE 2.5 — Controlled 429 Runtime Verification
 * 
 * Fires 5 sequential requests to /v1/replies:
 *   - Req 1: load counts  (should be 200)
 *   - Req 2: load replies (should be 200)  ← legitimate initial load
 *   - Req 3: extra        (should be 200 — 3rd of 3 allowed)
 *   - Req 4: trigger 429  (max=3 exhausted)
 *   - Req 5: still 429    (rate limit window active)
 *
 * Then waits and fires:
 *   - Req 6: counts (should still be 429)
 *
 * Records timestamps, status codes, and all rate-limit response headers.
 */

import "dotenv/config";

const TOKEN = process.argv[2];
if (!TOKEN) {
  console.error("Usage: npx tsx scratch/run_429_test.mts <JWT_TOKEN>");
  process.exit(1);
}

const API = "http://localhost:8080";
const headers = {
  Authorization: `Bearer ${TOKEN}`,
  "Content-Type": "application/json",
  // Simulate same IP by using a fixed forwarded header so Redis key is consistent
};

const RATE_LIMIT_HEADERS = [
  "retry-after",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "ratelimit-limit",
  "ratelimit-remaining",
  "ratelimit-reset",
];

async function hit(label: string, url: string): Promise<void> {
  const t0 = Date.now();
  const res = await fetch(url, { headers });
  const elapsed = Date.now() - t0;

  const rl: Record<string, string> = {};
  for (const h of RATE_LIMIT_HEADERS) {
    const v = res.headers.get(h);
    if (v !== null) rl[h] = v;
  }

  const body = await res.text().catch(() => "(unreadable)");
  let bodyPreview = body.slice(0, 120);
  if (body.length > 120) bodyPreview += "…";

  console.log(`\n[${new Date().toISOString()}] ${label}`);
  console.log(`  URL:     ${url}`);
  console.log(`  STATUS:  ${res.status} ${res.statusText}`);
  console.log(`  ELAPSED: ${elapsed}ms`);
  console.log(`  RL HEADERS: ${JSON.stringify(rl, null, 4).replace(/\n/g, "\n             ")}`);
  console.log(`  BODY:    ${bodyPreview}`);

  if (Object.keys(rl).length === 0 && res.status === 429) {
    console.log("  ⚠️  WARNING: 429 but NO rate-limit headers in response — proxy may be stripping them");
  }
  if (res.status === 429 && rl["retry-after"]) {
    console.log(`  ✅  retry-after present: ${rl["retry-after"]}s`);
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

console.log("═".repeat(70));
console.log("STATE 2.5 — Controlled 429 Runtime Verification");
console.log(`API: ${API}`);
console.log(`Limiter: max=3 per 60s (temporarily lowered for test)`);
console.log("═".repeat(70));

// Clear note: max=3 means 3 requests per window. Requests 1-3 succeed, 4+ → 429.

// ─── Scenario A: Replies list endpoint ───────────────────────────────────────
console.log("\n── Scenario A: /v1/replies (main list endpoint) ──");

await hit("Req 1/A — counts (normal load, expect 200)", `${API}/v1/replies/counts`);
await sleep(100);
await hit("Req 2/A — list page 1 (normal load, expect 200)", `${API}/v1/replies?page=1&limit=10`);
await sleep(100);
await hit("Req 3/A — list page 1 again (3rd/3 allowed, expect 200)", `${API}/v1/replies?page=1&limit=10`);
await sleep(100);

console.log("\n── Triggering 429 ──");
await hit("Req 4/A — SHOULD be 429 (limit exhausted)", `${API}/v1/replies?page=1&limit=10`);
await sleep(200);
await hit("Req 5/A — SHOULD be 429 (still in window)", `${API}/v1/replies/counts`);

// ─── Check Redis key after 429 ───────────────────────────────────────────────
console.log("\n── Redis rate-limit key state after 429 ──");
const { default: Redis } = await import("ioredis");
const redis = new Redis(process.env.REDIS_URL!);
const keys = await redis.keys("rl::*");
console.log("  Active rl:: keys:", keys);
for (const k of keys) {
  const val = await redis.get(k);
  const ttl = await redis.ttl(k);
  console.log(`  Key: ${k}  Value: ${val}  TTL: ${ttl}s`);
}
await redis.quit();

console.log("\n" + "═".repeat(70));
console.log("DONE — Scenario A complete");
console.log("═".repeat(70));
