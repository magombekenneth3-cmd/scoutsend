/**
 * warmup-fence.ts — Versioned fencing for the warmup subsystem.
 *
 * DB = authoritative durable state (immediate).
 * Redis = execution-time fence cache (eventually consistent).
 *
 * INV-2:  Fence versions are independently monotonic per scope.
 * INV-7:  handleEngagement() is never fenced — observe only.
 *
 * Redis key structure:
 *   warmup:fence:global               → { paused: boolean, version: number }
 *   warmup:fence:domain:{domainId}    → { paused: boolean, version: number }
 *   warmup:fence:mailbox:{mailboxId}  → { paused: boolean, version: number }
 *
 * Workers call isWarmupFenced() at the LAST SAFE POINT before SendIntent
 * creation / provider interaction.
 *
 * Fence relay (outbox → Redis) is version-guarded: a stale event
 * (version < current) is silently discarded.
 */

import { redis } from "../../lib/ioredis";
import { logger } from "../../lib/logger";
import type { WarmupState, EffectiveWarmupState } from "../../lib/warmup/warmup-types.js";

// ─── Redis Key Builders ──────────────────────────────────────────────────────

const GLOBAL_KEY = "warmup:fence:global";
const domainKey = (id: string) => `warmup:fence:domain:${id}`;
const mailboxKey = (id: string) => `warmup:fence:mailbox:${id}`;

// ─── Types ───────────────────────────────────────────────────────────────────

interface RedisFenceEntry {
  paused: boolean;
  version: number;
}

// ─── Read ────────────────────────────────────────────────────────────────────

async function readFence(key: string): Promise<RedisFenceEntry | null> {
  const raw = await redis.get(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as RedisFenceEntry;
  } catch {
    return null;
  }
}

// ─── isWarmupFenced ──────────────────────────────────────────────────────────

/**
 * Check if a mailbox is fenced from sending warmup traffic.
 *
 * Checks three levels (any fence blocks):
 *   1. Global fence
 *   2. Domain fence (if domainId provided)
 *   3. Mailbox fence
 *
 * Returns true if ANY level is paused.
 *
 * This is the LAST SAFE POINT before provider interaction.
 * handleEngagement() must NEVER call this (INV-7).
 */
export async function isWarmupFenced(
  mailboxId: string,
  domainId: string | null,
): Promise<boolean> {
  // Check all levels in parallel
  const checks = [
    readFence(GLOBAL_KEY),
    readFence(mailboxKey(mailboxId)),
  ];
  if (domainId) {
    checks.push(readFence(domainKey(domainId)));
  }

  const results = await Promise.all(checks);

  for (const fence of results) {
    if (fence?.paused) return true;
  }

  return false;
}

// ─── computeEffectiveState ───────────────────────────────────────────────────

/**
 * Compute the effective warmup state for a mailbox, considering
 * the domain and global fence hierarchy.
 *
 * Domain PAUSE → all child mailboxes effectively paused (even if
 * their intrinsic warmupState is RAMPING).
 *
 * The mailbox's intrinsic warmupState is NEVER modified by this.
 */
export function computeEffectiveState(
  mailbox: { warmupState: WarmupState },
  domain: { warmupState: WarmupState } | null,
  globalPaused: boolean,
): EffectiveWarmupState {
  if (globalPaused) return "PAUSED_BY_GLOBAL";
  if (domain?.warmupState === "PAUSED") return "PAUSED_BY_DOMAIN";
  return mailbox.warmupState;
}

// ─── Fence Relay (Outbox → Redis) ────────────────────────────────────────────

/**
 * Update a fence in Redis. Version-guarded: if the incoming version
 * is <= the current cached version, the update is silently discarded.
 *
 * Called by the outbox consumer when processing WARMUP_PAUSED or
 * WARMUP_STATE_CHANGED events.
 */
export async function relayFenceToRedis(
  scope: "global" | "domain" | "mailbox",
  entityId: string | null,
  paused: boolean,
  version: number,
): Promise<boolean> {
  let key: string;
  if (scope === "global") {
    key = GLOBAL_KEY;
  } else if (scope === "domain" && entityId) {
    key = domainKey(entityId);
  } else if (scope === "mailbox" && entityId) {
    key = mailboxKey(entityId);
  } else {
    logger.warn({ scope, entityId }, "[warmup-fence] Invalid fence relay args");
    return false;
  }

  // Version-guarded write via Lua script
  const script = `
    local key = KEYS[1]
    local newVersion = tonumber(ARGV[1])
    local newPaused = ARGV[2]

    local current = redis.call('GET', key)
    if current then
      local data = cjson.decode(current)
      if data.version >= newVersion then
        return 0
      end
    end

    local entry = cjson.encode({ paused = (newPaused == "true"), version = newVersion })
    redis.call('SET', key, entry, 'EX', 86400)
    return 1
  `;

  const result = await redis.eval(script, 1, key, version, String(paused));
  const applied = result === 1;

  if (applied) {
    logger.info(
      { scope, entityId, paused, version },
      "[warmup-fence] Fence relayed to Redis",
    );
  } else {
    logger.debug(
      { scope, entityId, paused, version },
      "[warmup-fence] Stale fence version — discarded",
    );
  }

  return applied;
}

// ─── Reconciler ──────────────────────────────────────────────────────────────

/**
 * Reconcile Redis fence state from DB truth.
 *
 * Called periodically (e.g., every 5 min) to converge Redis to DB.
 * This handles Redis loss, missed outbox events, and clock drift.
 */
export async function reconcileFences(
  prisma: {
    senderMailbox: { findMany: (args: unknown) => Promise<Array<{ id: string; warmupState: string; warmupFenceVersion: number }>> };
    senderDomain: { findMany: (args: unknown) => Promise<Array<{ id: string; warmupState: string; warmupFenceVersion: number }>> };
  },
): Promise<void> {
  // Reconcile domains
  const domains = await prisma.senderDomain.findMany({
    where: { warmupState: { not: "NOT_STARTED" } },
    select: { id: true, warmupState: true, warmupFenceVersion: true },
  } as any);

  for (const d of domains) {
    await relayFenceToRedis(
      "domain",
      d.id,
      d.warmupState === "PAUSED",
      d.warmupFenceVersion,
    );
  }

  // Reconcile mailboxes
  const mailboxes = await prisma.senderMailbox.findMany({
    where: { warmupState: { not: "NOT_STARTED" } },
    select: { id: true, warmupState: true, warmupFenceVersion: true },
  } as any);

  for (const m of mailboxes) {
    await relayFenceToRedis(
      "mailbox",
      m.id,
      m.warmupState === "PAUSED",
      m.warmupFenceVersion,
    );
  }

  logger.info(
    { domains: domains.length, mailboxes: mailboxes.length },
    "[warmup-fence] Reconciliation complete",
  );
}
