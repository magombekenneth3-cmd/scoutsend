/**
 * warmup.agent.ts — Canonical warmup evaluation agent (Rev 7).
 *
 * System law:
 *   computeWarmupDecision() → validateTransition() → applyWarmupDecision()
 *
 * There is ONE decision path for both mailbox and domain scope.
 * There are ZERO competing decision engines.
 *
 * INV-4:  One canonical engine for both scopes
 * INV-6:  PAUSED entities are included for observation-only
 * INV-11: Engine never receives NOT_STARTED or PAUSED
 */

import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { computeWarmupDecision } from "../../lib/warmup/warmup-policy.engine.js";
import { applyWarmupDecision } from "./warmup-apply.service";
import type {
  WarmupPolicyInput,
  WarmupMetrics,
  EvaluatableWarmupState,
  PlacementProvider,
  PlacementProviderPolicy,
  SenderProviderPolicy,
} from "../../lib/warmup/warmup-types.js";
import type { WarmupModelType } from "./warmup-apply.service";

// ─── Default Policies (will be per-provider configurable later) ──────────────

const DEFAULT_SENDER_POLICY: SenderProviderPolicy = {
  warmupSafeDailyLimit: 40,
  minObservationPeriodDays: 3,
};

const DEFAULT_PLACEMENT_POLICIES: Record<PlacementProvider, PlacementProviderPolicy> = {
  GOOGLE: {
    spamThreshold: 0.08,
    cooldownMultiplier: 0.75,
    degradedThreshold: 2,
    recoveryThreshold: 3,
  },
  MICROSOFT: {
    spamThreshold: 0.08,
    cooldownMultiplier: 0.8,
    degradedThreshold: 2,
    recoveryThreshold: 3,
  },
};

// ─── Evaluatable states (NOT_STARTED and PAUSED handled separately) ──────────

const EVALUATABLE_STATES = new Set<string>([
  "OBSERVATION",
  "RAMPING",
  "STABLE",
  "COOLDOWN",
  "RECOVERY",
]);

// ─── Entrypoint ──────────────────────────────────────────────────────────────

/**
 * Main warmup evaluation pass. Called by the scheduler.
 *
 * Processes domains first (domain-level PAUSE affects child mailboxes),
 * then mailboxes.
 */
export async function runWarmupAgent(): Promise<void> {
  logger.info("[warmup.agent] Starting warmup evaluation pass");

  await runDomainWarmupPass();
  await runMailboxWarmupPass();

  logger.info("[warmup.agent] Warmup evaluation pass complete");
}

// ─── Domain Pass ─────────────────────────────────────────────────────────────

async function runDomainWarmupPass(): Promise<void> {
  const domains = await prisma.senderDomain.findMany({
    where: {
      warmupState: { not: "NOT_STARTED" },
    },
    select: {
      id: true,
      domain: true,
      dailyLimit: true,
      baseDailyLimit: true,
      warmupState: true,
      warmupFenceVersion: true,
      warmupDay: true,
      warmupStartedAt: true,
      consecutiveHealthyEvals: true,
      consecutiveDegradedEvals: true,
      bounceRate: true,
      complaintRate: true,
      orgId: true,
    },
  });

  logger.info({ count: domains.length }, "[warmup.agent] Evaluating domains");

  for (const domain of domains) {
    try {
      // INV-6: PAUSED entities are included — observation only
      if (domain.warmupState === "PAUSED") {
        await logObservation("domain", domain.id, domain.domain);
        continue;
      }

      // INV-11: Engine never receives NOT_STARTED
      if (!EVALUATABLE_STATES.has(domain.warmupState)) {
        continue;
      }

      const metrics = await aggregateMetrics("SenderDomain", domain.id);

      const input: WarmupPolicyInput = {
        scope: "domain",
        warmupDay: domain.warmupDay,
        currentState: domain.warmupState as EvaluatableWarmupState,
        currentDailyLimit: domain.dailyLimit,
        baseDailyLimit: domain.baseDailyLimit,
        consecutiveHealthyEvals: domain.consecutiveHealthyEvals,
        consecutiveDegradedEvals: domain.consecutiveDegradedEvals,
        metrics,
        senderPolicy: DEFAULT_SENDER_POLICY,
        placementPolicies: DEFAULT_PLACEMENT_POLICIES,
      };

      const decision = computeWarmupDecision(input);

      await applyWarmupDecision("SenderDomain", {
        id: domain.id,
        warmupState: domain.warmupState,
        warmupFenceVersion: domain.warmupFenceVersion,
        dailyLimit: domain.dailyLimit,
        warmupDay: domain.warmupDay,
        orgId: domain.orgId,
      }, decision);

    } catch (err) {
      logger.error(
        { err, domainId: domain.id, domain: domain.domain },
        "[warmup.agent] Failed to evaluate domain",
      );
    }
  }
}

// ─── Mailbox Pass ────────────────────────────────────────────────────────────

async function runMailboxWarmupPass(): Promise<void> {
  const mailboxes = await prisma.senderMailbox.findMany({
    where: {
      warmupState: { not: "NOT_STARTED" },
    },
    select: {
      id: true,
      emailAddress: true,
      dailyLimit: true,
      baseDailyLimit: true,
      warmupState: true,
      warmupFenceVersion: true,
      warmupDay: true,
      warmupStartedAt: true,
      consecutiveHealthyEvals: true,
      consecutiveDegradedEvals: true,
      bounceRate: true,
      complaintRate: true,
      orgId: true,
    },
  });

  logger.info({ count: mailboxes.length }, "[warmup.agent] Evaluating mailboxes");

  for (const mailbox of mailboxes) {
    try {
      // INV-6: PAUSED entities are included — observation only
      if (mailbox.warmupState === "PAUSED") {
        await logObservation("mailbox", mailbox.id, mailbox.emailAddress);
        continue;
      }

      // INV-11: Engine never receives NOT_STARTED
      if (!EVALUATABLE_STATES.has(mailbox.warmupState)) {
        continue;
      }

      const metrics = await aggregateMetrics("SenderMailbox", mailbox.id);

      const input: WarmupPolicyInput = {
        scope: "mailbox",
        warmupDay: mailbox.warmupDay,
        currentState: mailbox.warmupState as EvaluatableWarmupState,
        currentDailyLimit: mailbox.dailyLimit,
        baseDailyLimit: mailbox.baseDailyLimit,
        consecutiveHealthyEvals: mailbox.consecutiveHealthyEvals,
        consecutiveDegradedEvals: mailbox.consecutiveDegradedEvals,
        metrics,
        senderPolicy: DEFAULT_SENDER_POLICY,
        placementPolicies: DEFAULT_PLACEMENT_POLICIES,
      };

      const decision = computeWarmupDecision(input);

      await applyWarmupDecision("SenderMailbox", {
        id: mailbox.id,
        warmupState: mailbox.warmupState,
        warmupFenceVersion: mailbox.warmupFenceVersion,
        dailyLimit: mailbox.dailyLimit,
        warmupDay: mailbox.warmupDay,
        orgId: mailbox.orgId,
      }, decision);

    } catch (err) {
      logger.error(
        { err, mailboxId: mailbox.id, email: mailbox.emailAddress },
        "[warmup.agent] Failed to evaluate mailbox",
      );
    }
  }
}

// ─── Observation Logging (PAUSED entities) ───────────────────────────────────

/**
 * Log observation-only for PAUSED entities (INV-6).
 *
 * Observation continues during PAUSE to provide evidence for
 * resume decisions. No state or limit changes are made.
 */
async function logObservation(
  scope: "mailbox" | "domain",
  entityId: string,
  label: string,
): Promise<void> {
  const since7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const recentEvents = await prisma.deliverabilityEvent.findMany({
    where: {
      ...(scope === "mailbox"
        ? { senderMailboxId: entityId }
        : { senderDomainId: entityId }),
      createdAt: { gte: since7d },
    },
    select: { type: true, severity: true },
  });

  const bounces = recentEvents.filter((e) =>
    ["BOUNCE", "SOFT_BOUNCE", "HARD_BOUNCE"].includes(e.type),
  ).length;

  const spamLandings = recentEvents.filter((e) =>
    e.type === "SEED_WARMUP_SPAM_LANDING",
  ).length;

  const blocks = recentEvents.filter((e) =>
    ["DOMAIN_BLOCKED", "MAILBOX_BLOCKED"].includes(e.type),
  ).length;

  logger.info(
    {
      scope,
      entityId,
      label,
      state: "PAUSED",
      observation: {
        bounces7d: bounces,
        spamLandings7d: spamLandings,
        blocks7d: blocks,
        totalEvents7d: recentEvents.length,
      },
    },
    "[warmup.agent] PAUSED entity observation (no state change)",
  );
}

// ─── Metrics Aggregation ─────────────────────────────────────────────────────

/**
 * Aggregate deliverability metrics for a mailbox or domain.
 *
 * Queries DeliverabilityEvent and WarmupInteraction tables
 * to build the WarmupMetrics required by the policy engine.
 */
async function aggregateMetrics(
  model: WarmupModelType,
  entityId: string,
): Promise<WarmupMetrics> {
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const whereClause = model === "SenderMailbox"
    ? { senderMailboxId: entityId }
    : { senderDomainId: entityId };

  // Fetch all recent events in one query
  const events = await prisma.deliverabilityEvent.findMany({
    where: {
      ...whereClause,
      createdAt: { gte: since7d },
    },
    select: {
      type: true,
      severity: true,
      createdAt: true,
      metadata: true,
    },
  });

  const is24h = (e: { createdAt: Date }) => e.createdAt >= since24h;

  // Helper to classify seed email provider
  const classifyProvider = (e: { metadata: unknown }): "google" | "microsoft" | "other" => {
    const meta = e.metadata as Record<string, unknown> | null;
    const seedEmail = typeof meta?.seedEmail === "string" ? meta.seedEmail : "";
    const domain = seedEmail.split("@")[1]?.toLowerCase() ?? "";
    if (domain === "gmail.com" || domain === "googlemail.com") return "google";
    if (["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain)) return "microsoft";
    return "other";
  };

  const bounceTypes = new Set(["BOUNCE", "SOFT_BOUNCE", "HARD_BOUNCE"]);
  const spamType = "SEED_WARMUP_SPAM_LANDING";
  const engagedType = "SEED_WARMUP_ENGAGED";
  const blockTypes = new Set(["DOMAIN_BLOCKED", "MAILBOX_BLOCKED"]);

  let sent24h = 0, bounces24h = 0, complaints24h = 0, blockEvents24h = 0;
  let seedInteractions24h = 0, seedSpamLandings24h = 0;
  let googleSeedInteractions24h = 0, googleSeedSpamLandings24h = 0;
  let msSeedInteractions24h = 0, msSeedSpamLandings24h = 0;

  let sent7d = 0, bounces7d = 0, complaints7d = 0;
  let seedInteractions7d = 0, seedSpamLandings7d = 0;
  let googleSeedInteractions7d = 0, googleSeedSpamLandings7d = 0;
  let msSeedInteractions7d = 0, msSeedSpamLandings7d = 0;

  for (const e of events) {
    const in24h = is24h(e);

    if (bounceTypes.has(e.type)) {
      bounces7d++;
      if (in24h) bounces24h++;
    }

    if (e.type === "SPAM_COMPLAINT") {
      complaints7d++;
      if (in24h) complaints24h++;
    }

    if (blockTypes.has(e.type) && in24h) {
      blockEvents24h++;
    }

    if (e.type === spamType || e.type === engagedType) {
      seedInteractions7d++;
      if (in24h) seedInteractions24h++;

      const provider = classifyProvider(e);

      if (e.type === spamType) {
        seedSpamLandings7d++;
        if (in24h) seedSpamLandings24h++;

        if (provider === "google") {
          googleSeedSpamLandings7d++;
          if (in24h) googleSeedSpamLandings24h++;
        } else if (provider === "microsoft") {
          msSeedSpamLandings7d++;
          if (in24h) msSeedSpamLandings24h++;
        }
      }

      if (provider === "google") {
        googleSeedInteractions7d++;
        if (in24h) googleSeedInteractions24h++;
      } else if (provider === "microsoft") {
        msSeedInteractions7d++;
        if (in24h) msSeedInteractions24h++;
      }
    }
  }

  // Get send counts from entity
  if (model === "SenderMailbox") {
    const mbx = await prisma.senderMailbox.findUnique({
      where: { id: entityId },
      select: { currentSent: true, totalSent: true },
    });
    sent24h = mbx?.currentSent ?? 0;
    sent7d = Math.max(sent24h, seedInteractions7d);
  } else {
    const dom = await prisma.senderDomain.findUnique({
      where: { id: entityId },
      select: { currentSent: true, totalSent: true },
    });
    sent24h = dom?.currentSent ?? 0;
    sent7d = Math.max(sent24h, seedInteractions7d);
  }

  return {
    sent24h,
    bounces24h,
    complaints24h,
    seedInteractions24h,
    seedSpamLandings24h,
    blockEvents24h,
    googleSeedInteractions24h,
    googleSeedSpamLandings24h,
    msSeedInteractions24h,
    msSeedSpamLandings24h,
    sent7d,
    bounces7d,
    complaints7d,
    seedInteractions7d,
    seedSpamLandings7d,
    googleSeedInteractions7d,
    googleSeedSpamLandings7d,
    msSeedInteractions7d,
    msSeedSpamLandings7d,
    sentLifetime: 0, // populated later from entity.totalSent
    bouncesLifetime: 0,
  };
}