#!/usr/bin/env node
/**
 * STATE 2.5 — Proxy Layer 429 Header Forwarding Verification
 *
 * Tests the Next.js API route layer (http://localhost:3000/api/replies/...)
 * to confirm _proxy.ts forwards Retry-After and X-RateLimit-* headers
 * to the browser client.
 *
 * Uses a browser cookie (token=<JWT>) as Next.js routes expect.
 */

import "dotenv/config";

const TOKEN = process.argv[2];
if (!TOKEN) {
  console.error("Usage: npx tsx scratch/run_proxy_429_test.mts <JWT_TOKEN>");
  process.exit(1);
}

// Next.js frontend dev server
const NEXT = process.env.APP_URL ?? "http://localhost:3000";

const cookieHeader = `token=${TOKEN}`;

const RATE_LIMIT_HEADERS = [
  "retry-after",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "ratelimit-limit",
  "ratelimit-remaining",
  "ratelimit-reset",
];

async function hit(label: string, url: string): Promise<{ status: number; rl: Record<string, string>; body: string }> {
  const t0 = Date.now();
  const res = await fetch(url, {
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "application/json",
    },
    redirect: "manual",
  });
  const elapsed = Date.now() - t0;

  const rl: Record<string, string> = {};
  for (const h of RATE_LIMIT_HEADERS) {
    const v = res.headers.get(h);
    if (v !== null) rl[h] = v;
  }

  const body = await res.text().catch(() => "(unreadable)");
  const bodyPreview = body.slice(0, 150) + (body.length > 150 ? "…" : "");

  console.log(`\n[${new Date().toISOString()}] ${label}`);
  console.log(`  URL:     ${url}`);
  console.log(`  STATUS:  ${res.status} ${res.statusText}`);
  console.log(`  ELAPSED: ${elapsed}ms`);

  if (Object.keys(rl).length > 0) {
    console.log(`  RL HEADERS (forwarded by proxy):`);
    for (const [k, v] of Object.entries(rl)) {
      console.log(`    ${k}: ${v}`);
    }
  } else {
    console.log("  RL HEADERS: (none visible at proxy layer)");
    if (res.status === 429) {
      console.log("  ⚠️  WARNING: 429 with NO rate-limit headers — proxy may be stripping them");
    }
  }
  console.log(`  BODY:    ${bodyPreview}`);

  return { status: res.status, rl, body };
}

async function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

console.log("═".repeat(70));
console.log("STATE 2.5 — Next.js Proxy Layer 429 Header Forwarding");
console.log(`Next.js: ${NEXT}`);
console.log("═".repeat(70));
console.log("NOTE: Redis counter still exhausted from previous test.");
console.log("      Hitting /api/replies/* should immediately get 429.\n");

// The Redis counter is already exhausted from the direct API test.
// These requests through the Next.js proxy should get immediate 429.

const r1 = await hit("Proxy Req 1 — /api/replies/counts (expect 429)", `${NEXT}/api/replies/counts`);
await sleep(100);
const r2 = await hit("Proxy Req 2 — /api/replies?page=1&limit=10 (expect 429)", `${NEXT}/api/replies?page=1&limit=10`);

console.log("\n── Summary ──");
console.log(`  Req 1 status: ${r1.status} | retry-after via proxy: ${r1.rl["retry-after"] ?? "MISSING"}`);
console.log(`  Req 2 status: ${r2.status} | retry-after via proxy: ${r2.rl["retry-after"] ?? "MISSING"}`);

if (r1.rl["retry-after"] && r2.rl["retry-after"]) {
  console.log("\n  ✅ PASS: proxy correctly forwards Retry-After on both endpoints");
} else {
  console.log("\n  ❌ FAIL: proxy is NOT forwarding Retry-After — client will get 30s fallback");
}

const x1 = r1.rl["ratelimit-remaining"] ?? r1.rl["x-ratelimit-remaining"];
const x2 = r2.rl["ratelimit-remaining"] ?? r2.rl["x-ratelimit-remaining"];
if (x1 !== undefined || x2 !== undefined) {
  console.log("  ✅ PASS: X-RateLimit-Remaining forwarded by proxy");
} else {
  console.log("  ℹ️  X-RateLimit-Remaining not forwarded (only standard headers forwarded by proxy)");
}
