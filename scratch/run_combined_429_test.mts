#!/usr/bin/env node
/**
 * STATE 2.5 — Combined API + Proxy 429 Verification
 * Exhausts the rate limit via direct API calls,
 * then immediately tests the Next.js proxy to verify header forwarding.
 */

import "dotenv/config";
import { default as Redis } from "ioredis";

const TOKEN = process.argv[2];
if (!TOKEN) { console.error("Usage: npx tsx scratch/run_combined_429_test.mts <JWT>"); process.exit(1); }

const API    = "http://localhost:8080";
const NEXT   = "http://localhost:3000";

const apiHeaders  = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
const nextHeaders = { Cookie: `token=${TOKEN}`, "Content-Type": "application/json" };

const RL_HDR = ["retry-after","x-ratelimit-limit","x-ratelimit-remaining","x-ratelimit-reset",
                "ratelimit-limit","ratelimit-remaining","ratelimit-reset"];

interface HitResult { status: number; rl: Record<string,string>; body: string; elapsed: number; }

async function hit(label: string, url: string, hdrs: Record<string,string>): Promise<HitResult> {
  const t0 = Date.now();
  const res = await fetch(url, { headers: hdrs, redirect: "manual" });
  const elapsed = Date.now() - t0;
  const rl: Record<string,string> = {};
  for (const h of RL_HDR) { const v = res.headers.get(h); if (v) rl[h] = v; }
  const body = (await res.text().catch(()=>"(err)")).slice(0, 200);
  console.log(`\n[${new Date().toISOString()}] ${label}`);
  console.log(`  STATUS:  ${res.status}  ELAPSED: ${elapsed}ms`);
  if (Object.keys(rl).length > 0) { for (const [k,v] of Object.entries(rl)) console.log(`  ${k}: ${v}`); }
  else console.log("  (no rate-limit headers)");
  console.log(`  BODY:    ${body}`);
  return { status: res.status, rl, body, elapsed };
}

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── Step 0: Clear Redis counter ─────────────────────────────────────────────
const redis = new Redis(process.env.REDIS_URL!);
const keys = await redis.keys("rl::*");
if (keys.length > 0) { await redis.del(...keys); console.log(`Cleared ${keys.length} rl:: key(s)`); }
else { console.log("Redis rl:: counter: clean"); }
await redis.quit();

console.log("\n" + "═".repeat(68));
console.log("PART 1 — Direct API: exhaust limiter (max=3), then verify 429");
console.log("═".repeat(68));

await hit("API Req 1/3 (expect 200)", `${API}/v1/replies/counts`, apiHeaders);
await sleep(50);
await hit("API Req 2/3 (expect 200)", `${API}/v1/replies?page=1&limit=5`, apiHeaders);
await sleep(50);
await hit("API Req 3/3 (expect 200, remaining=0)", `${API}/v1/replies?page=1&limit=5`, apiHeaders);
await sleep(50);
const r4 = await hit("API Req 4 — TRIGGER 429", `${API}/v1/replies?page=1&limit=5`, apiHeaders);
await sleep(50);
const r5 = await hit("API Req 5 — confirm 429", `${API}/v1/replies/counts`, apiHeaders);

console.log("\n═".padEnd(68, "═").substring(1));
console.log("PART 1 VERDICT:");
if (r4.status === 429 && r4.rl["retry-after"]) {
  console.log(`  ✅ 429 confirmed at API layer with retry-after=${r4.rl["retry-after"]}s`);
} else {
  console.log(`  ❌ Expected 429 with retry-after, got: ${r4.status} headers=${JSON.stringify(r4.rl)}`);
}

console.log("\n" + "═".repeat(68));
console.log("PART 2 — Next.js Proxy: same IP, counter still exhausted → proxy 429");
console.log("═".repeat(68));

// The Redis key `rl:::/56` covers ALL requests from this IP (::1/56 = loopback CIDR).
// Both direct API and Next.js calls go to localhost:8080, share the same key.
await sleep(50);
const p1 = await hit("PROXY Req 1 — /api/replies/counts (expect 429)", `${NEXT}/api/replies/counts`, nextHeaders);
await sleep(50);
const p2 = await hit("PROXY Req 2 — /api/replies?page=1 (expect 429)", `${NEXT}/api/replies?page=1&limit=5`, nextHeaders);

console.log("\n═".padEnd(68, "═").substring(1));
console.log("PART 2 VERDICT:");
if (p1.status === 429 || p2.status === 429) {
  const p = p1.status === 429 ? p1 : p2;
  if (p.rl["retry-after"]) {
    console.log(`  ✅ PASS: Proxy forwarded retry-after=${p.rl["retry-after"]}s on ${p.status} response`);
  } else {
    console.log(`  ⚠️  Proxy returned 429 but retry-after MISSING from forwarded headers`);
    console.log(`     This means _proxy.ts is NOT forwarding Retry-After.`);
    console.log(`     Client will fall back to 30s default.`);
  }
  const rlk = Object.keys(p.rl).filter(k => k.startsWith("ratelimit-") || k.startsWith("x-ratelimit-"));
  if (rlk.length > 0) { console.log(`  ✅ RateLimit standard headers forwarded: ${rlk.join(", ")}`); }
  else { console.log("  ℹ️  Standard RateLimit-* headers not forwarded (only Retry-After matters for client UX)"); }
} else {
  console.log(`  ⚠️  Proxy returned ${p1.status}/${p2.status} — counter may have reset between tests.`);
  console.log(`     Next.js routes may route through a different IP causing a different Redis key.`);
  // Check what key got created
  const redis2 = new Redis(process.env.REDIS_URL!);
  const k2 = await redis2.keys("rl::*");
  console.log(`  Active rl:: keys:`, k2);
  for (const k of k2) {
    const v = await redis2.get(k); const t = await redis2.ttl(k);
    console.log(`    ${k} = ${v} (TTL ${t}s)`);
  }
  await redis2.quit();
}

console.log("\n" + "═".repeat(68));
console.log("STATE 2.5 PART 1+2 COMPLETE");
