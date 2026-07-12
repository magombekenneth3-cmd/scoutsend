import { randomUUID } from "crypto";
import { ApprovalStatus, DeliveryState, ReplyIntent, EmailStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { buildListUnsubscribeHeaders, renderEmailTemplate, TemplateStyle } from "../../lib/emailTemplate";
import { getBrandSettingsOrDefault } from "../brandSettings/brandsettings.service";
import { extractJSON } from "../gemini/gemini.client";
import { logger } from "../../lib/logger";
import { createMailProvider, MailboxCredentials, SendResult, OutlookCredentials } from "../../lib/mail";
import { redis } from "../../lib/ioredis";
import { decryptJson, isEncrypted, encryptJson } from "../../lib/mail/crypto";
import { DOMAIN_HEALTH_THRESHOLDS } from "../../lib/constants";
import { emitCampaignEvent } from "../../lib/campaign-events";
import { effectiveCurrentSent, reserveDailyCapacity } from "../../lib/daily-quota";
import { verifySenderDomainDns } from "../senderDomain/senderDomain.services";
import { verifyMailboxDns } from "../senderMailbox/senderMailbox.services";
import { CacheService } from "../../lib/cache";
import { recalculateDomainHealth, recalculateMailboxHealth } from "../Deliverybilityevents/deliverbility.service";



const WARMUP_BOUNCE_HOLD = 0.03;
const WARMUP_COMPLAINT_HOLD = 0.001;

const BOUNCE_PENALTY_DAYS_PER_EXCESS = 7;
const COMPLAINT_PENALTY_DAYS_PER_EXCESS = 7;

const DEGRADED_EXTRA_PENALTY_DAYS = 7;

function decryptCredentials(raw: unknown): MailboxCredentials {
  if (isEncrypted(raw)) return decryptJson<MailboxCredentials>(raw as string);
  return raw as MailboxCredentials;
}

interface ParsedBody {
  greeting?: string;
  opening?: string;
  body?: string;
  ctaText?: string;
  closing?: string;
}

const GREETING_RE = /^(?:Hi|Hello|Hey|Dear)\b.{0,60}[,.]?\s*$/im;
const CLOSING_RE = /^(?:Best|Regards|Sincerely|Cheers|Thanks|Thank you|Kind regards|Warm regards)[,.]?\s*$/im;

function parseBody(raw: string) {
  try {
    const parsed = extractJSON<ParsedBody>(raw);
    if (parsed && typeof parsed === "object" && parsed.body) {
      return {
        greeting: parsed.greeting ?? "Hi there,",
        opening: parsed.opening ?? "",
        body: parsed.body,
        ctaText: parsed.ctaText ?? "Let's connect",
        closing: parsed.closing ?? "Best,",
      };
    }
  } catch (err) {
    logger.warn({ err }, "[send.agent] parseBody JSON extraction failed, falling back to regex");
  }

  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const greetingIdx = lines.findIndex((l) => GREETING_RE.test(l));

  if (greetingIdx !== -1) {
    const reversedClosingIdx = [...lines].reverse().findIndex((l) => CLOSING_RE.test(l));
    const closingIdx = reversedClosingIdx >= 0 ? lines.length - 1 - reversedClosingIdx : -1;
    const bodyStart = greetingIdx + 1;
    const bodyEnd = closingIdx > bodyStart ? closingIdx : lines.length;

    return {
      greeting: lines[greetingIdx],
      opening: "",
      body: lines.slice(bodyStart, bodyEnd).join("\n"),
      ctaText: "Let's connect",
      closing: closingIdx > 0 ? lines.slice(closingIdx).join("\n") : "Best,",
    };
  }

  return {
    greeting: "Hi there,",
    opening: "",
    body: raw,
    ctaText: "Let's connect",
    closing: "Best,",
  };
}

const MAX_RETRIES = 3;
const PAUSE_CHECK_INTERVAL = 25;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WARMUP_DAYS = 28;
const MIN_WARMUP_SEND = 5;

const SEND_JITTER_MIN_MS = 2000;
const SEND_JITTER_RANGE_MS = 8000;
const BLOCKED_EMAIL_STATUSES: EmailStatus[] = [
  EmailStatus.INVALID,
  EmailStatus.BOUNCED,
  EmailStatus.SUPPRESSED,
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const jitterMs = () => Math.floor(SEND_JITTER_MIN_MS + Math.random() * SEND_JITTER_RANGE_MS);

const ROTATION_COOLDOWN_SEC = 6 * 60 * 60;
const MIN_ROTATION_BATCH = 5;
const HEALTH_PRIORITY: Record<string, number> = { HEALTHY: 0, WARNING: 1, DEGRADED: 2 };
const SAFE_UTC_WINDOW_START = 13;
const SAFE_UTC_WINDOW_END = 16;

async function tryRotateWithCooldown(campaignId: string): Promise<boolean> {
  const key = `rotation-lock:${campaignId}`;
  const acquired = await redis.set(key, "1", "EX", ROTATION_COOLDOWN_SEC, "NX");
  return !!acquired;
}

export function getWarmupLimit(domain: {
  dailyLimit: number;
  warmupEnabled: boolean;
  createdAt: Date;
  bounceRate: number;
  complaintRate: number;
  health: string;
}): number {
  if (!domain.warmupEnabled) return domain.dailyLimit;
  if (domain.health === "BLOCKED") return MIN_WARMUP_SEND;

  const ageMs = Date.now() - new Date(domain.createdAt).getTime();
  const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));

  if (ageDays >= WARMUP_DAYS) return domain.dailyLimit;

  const bounceExcess = Math.max(0, domain.bounceRate / WARMUP_BOUNCE_HOLD - 1);
  const complaintExcess = Math.max(0, domain.complaintRate / WARMUP_COMPLAINT_HOLD - 1);

  const penaltyDays =
    bounceExcess * BOUNCE_PENALTY_DAYS_PER_EXCESS +
    complaintExcess * COMPLAINT_PENALTY_DAYS_PER_EXCESS;

  const extraPenalty = domain.health === "DEGRADED" ? DEGRADED_EXTRA_PENALTY_DAYS : 0;

  const effectiveAgeDays = Math.max(0, ageDays - penaltyDays - extraPenalty);

  if (penaltyDays > 0 || extraPenalty > 0) {
    logger.warn(
      {
        bounceRate: domain.bounceRate,
        complaintRate: domain.complaintRate,
        health: domain.health,
        ageDays: Math.floor(ageDays),
        penaltyDays: Math.round(penaltyDays * 10) / 10,
        extraPenalty,
        effectiveAgeDays: Math.floor(effectiveAgeDays),
      },
      "[send.agent] Warmup ramp penalised — deliverability metrics elevated",
    );
  }

  const progress = Math.sqrt(effectiveAgeDays / WARMUP_DAYS);
  const limit = Math.floor(
    MIN_WARMUP_SEND + (domain.dailyLimit - MIN_WARMUP_SEND) * progress,
  );

  return Math.max(MIN_WARMUP_SEND, Math.min(limit, domain.dailyLimit));
}

const BOUNCE_CRITICAL = DOMAIN_HEALTH_THRESHOLDS.BOUNCE_RATE_BLOCKED;
const BOUNCE_DEGRADED = DOMAIN_HEALTH_THRESHOLDS.BOUNCE_RATE_DEGRADED;
const BOUNCE_WARNING = DOMAIN_HEALTH_THRESHOLDS.BOUNCE_RATE_WARNING;
const COMPLAINT_CRITICAL = DOMAIN_HEALTH_THRESHOLDS.COMPLAINT_RATE_BLOCKED;
const COMPLAINT_WARNING = DOMAIN_HEALTH_THRESHOLDS.COMPLAINT_RATE_WARNING;
const REPUTATION_CRITICAL = 50;

type DomainHealth = "HEALTHY" | "WARNING" | "DEGRADED" | "BLOCKED";

function resolveHealth(params: {
  bounceRate: number;
  complaintRate: number;
  reputationScore: number | null;
  currentHealth: string;
}): { newHealth: DomainHealth | null; canSend: boolean; effectiveRateMultiplier: number } {
  const { bounceRate, complaintRate, reputationScore, currentHealth } = params;

  if (
    bounceRate >= BOUNCE_CRITICAL ||
    complaintRate >= COMPLAINT_CRITICAL ||
    (reputationScore !== null && reputationScore < REPUTATION_CRITICAL)
  ) {
    return { newHealth: "BLOCKED", canSend: false, effectiveRateMultiplier: 0 };
  }

  if (bounceRate >= BOUNCE_DEGRADED || complaintRate >= COMPLAINT_WARNING * 2) {
    return { newHealth: "DEGRADED", canSend: true, effectiveRateMultiplier: 0.25 };
  }

  if (bounceRate >= BOUNCE_WARNING || complaintRate >= COMPLAINT_WARNING) {
    return { newHealth: "WARNING", canSend: true, effectiveRateMultiplier: 0.5 };
  }

  return {
    newHealth: currentHealth !== "HEALTHY" ? "HEALTHY" : null,
    canSend: true,
    effectiveRateMultiplier: 1.0,
  };
}

export async function enforceDomainHealth(domainId: string): Promise<{
  canSend: boolean;
  newHealth: DomainHealth | null;
  effectiveRateMultiplier: number;
}> {
  const domain = await prisma.senderDomain.findUnique({
    where: { id: domainId },
    select: { id: true, bounceRate: true, complaintRate: true, reputationScore: true, health: true },
  });

  if (!domain) return { canSend: false, newHealth: null, effectiveRateMultiplier: 0 };

  const { newHealth, canSend, effectiveRateMultiplier } = resolveHealth({
    bounceRate: domain.bounceRate,
    complaintRate: domain.complaintRate,
    reputationScore: domain.reputationScore,
    currentHealth: domain.health,
  });

  if (newHealth && newHealth !== domain.health) {
    await prisma.senderDomain.update({
      where: { id: domainId },
      data: { health: newHealth },
    });

    logger.warn(
      {
        domainId,
        from: domain.health,
        to: newHealth,
        bounceRate: domain.bounceRate,
        complaintRate: domain.complaintRate,
        reputationScore: domain.reputationScore,
        effectiveRateMultiplier,
      },
      "[send.agent] Domain health updated"
    );

    if (newHealth === "BLOCKED") {
      await prisma.deliverabilityEvent.create({
        data: {
          type: "DOMAIN_BLOCKED",
          severity: "CRITICAL",
          senderDomainId: domainId,
          metadata: {
            bounceRate: domain.bounceRate,
            complaintRate: domain.complaintRate,
            reputationScore: domain.reputationScore,
          },
        },
      });
    }
  }

  return { canSend, newHealth, effectiveRateMultiplier };
}

export async function enforceMailboxHealth(mailboxId: string): Promise<{
  canSend: boolean;
  newHealth: DomainHealth | null;
  effectiveRateMultiplier: number;
}> {
  const mailbox = await prisma.senderMailbox.findUnique({
    where: { id: mailboxId },
    select: { id: true, bounceRate: true, complaintRate: true, reputationScore: true, health: true },
  });

  if (!mailbox) return { canSend: false, newHealth: null, effectiveRateMultiplier: 0 };

  const { newHealth, canSend, effectiveRateMultiplier } = resolveHealth({
    bounceRate: mailbox.bounceRate,
    complaintRate: mailbox.complaintRate,
    reputationScore: mailbox.reputationScore,
    currentHealth: mailbox.health,
  });

  if (newHealth && newHealth !== mailbox.health) {
    await prisma.senderMailbox.update({
      where: { id: mailboxId },
      data: { health: newHealth },
    });

    logger.warn(
      { mailboxId, from: mailbox.health, to: newHealth },
      "[send.agent] Mailbox health updated"
    );

    if (newHealth === "BLOCKED") {
      await prisma.deliverabilityEvent.create({
        data: {
          type: "MAILBOX_BLOCKED",
          severity: "CRITICAL",
          senderMailboxId: mailboxId,
          metadata: {
            bounceRate: mailbox.bounceRate,
            complaintRate: mailbox.complaintRate,
            reputationScore: mailbox.reputationScore,
          },
        },
      });
    }
  }

  return { canSend, newHealth, effectiveRateMultiplier };
}

interface MessageWithLead {
  id: string;
  createdAt: Date;
  lead: {
    qualificationScore: number | null;
    signals: Array<{
      signalType: string;
      confidence: number;
      createdAt: Date;
    }>;
  };
}

type CandidatePoolItem = MessageWithLead;

const SIGNAL_WEIGHTS: Record<string, number> = {
  FUNDING_SIGNAL: 1.0,
  HIRING_SIGNAL: 0.8,
  INTENT_SIGNAL: 0.9,
  GROWTH_SIGNAL: 0.6,
  TECH_SIGNAL: 0.4,
  RISK_SIGNAL: -0.5,
};

const SIGNAL_HALF_LIFE_DAYS: Record<string, number> = {
  FUNDING_SIGNAL: 30,
  HIRING_SIGNAL: 14,
  INTENT_SIGNAL: 7,
  GROWTH_SIGNAL: 60,
  TECH_SIGNAL: 90,
  RISK_SIGNAL: 90,
};

function scoreMessageForSend(msg: MessageWithLead): number {
  const qualScore = msg.lead.qualificationScore ?? 0.5;

  let signalScore = 0;
  for (const signal of msg.lead.signals) {
    const weight = SIGNAL_WEIGHTS[signal.signalType] ?? 0.2;
    const halfLifeDays = SIGNAL_HALF_LIFE_DAYS[signal.signalType] ?? 30;
    const ageDays =
      (Date.now() - new Date(signal.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    const decayFactor = Math.pow(0.5, ageDays / halfLifeDays);
    signalScore += weight * signal.confidence * decayFactor;
  }

  const clampedSignalScore = Math.max(-0.3, Math.min(0.5, signalScore));
  const waitHours = (Date.now() - new Date(msg.createdAt).getTime()) / (1000 * 60 * 60);
  const starvationBump = waitHours > 48 ? 0.1 : 0;

  return qualScore + clampedSignalScore + starvationBump;
}

const DEFAULT_SEND_WINDOW_START = 7;
const DEFAULT_SEND_WINDOW_END = 17;
const DEFAULT_SEND_WINDOW_DAYS = [1, 2, 3, 4, 5];

function jsDayToSchemaBit(jsDay: number): number {
  return jsDay === 0 ? 7 : jsDay;
}

interface SendWindowCampaign {
  sendWindowStart: number | null;
  sendWindowEnd: number | null;
  sendWindowDays: number[];
  timezone: string | null;
}

function isWithinSendWindow(campaign: SendWindowCampaign): boolean {
  const windowStart = campaign.sendWindowStart ?? DEFAULT_SEND_WINDOW_START;
  const windowEnd = campaign.sendWindowEnd ?? DEFAULT_SEND_WINDOW_END;
  const windowDays =
    campaign.sendWindowDays.length > 0 ? campaign.sendWindowDays : DEFAULT_SEND_WINDOW_DAYS;

  if (campaign.timezone) {
    try {
      const localParts = new Intl.DateTimeFormat("en-US", {
        timeZone: campaign.timezone,
        hour: "numeric",
        weekday: "short",
        hour12: false,
      }).formatToParts(new Date());

      const hourStr = localParts.find((p) => p.type === "hour")?.value ?? "0";
      const weekdayStr = localParts.find((p) => p.type === "weekday")?.value ?? "";
      const localHour = parseInt(hourStr, 10);

      const weekdayMap: Record<string, number> = {
        Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
      };
      const localJsDay = weekdayMap[weekdayStr] ?? new Date().getUTCDay();
      const schemaBit = jsDayToSchemaBit(localJsDay);

      if (!windowDays.includes(schemaBit)) return false;
      if (localHour < windowStart || localHour >= windowEnd) return false;
      return true;
    } catch {
      logger.error(
        { timezone: campaign.timezone },
        "[send.agent] Invalid campaign timezone — send halted"
      );
      return false;
    }
  }

  const now = new Date();
  const schemaBit = jsDayToSchemaBit(now.getUTCDay());
  if (!windowDays.includes(schemaBit)) return false;
  if (now.getUTCHours() < SAFE_UTC_WINDOW_START || now.getUTCHours() >= SAFE_UTC_WINDOW_END) return false;
  return true;
}

async function validateDomainForFailover(
  senderDomainId: string | null | undefined,
  campaignId: string,
): Promise<{ valid: boolean; reason?: string }> {
  if (!senderDomainId) return { valid: true };

  try {
    const { spfValid, dkimValid, dmarcValid } = await verifySenderDomainDns(senderDomainId, "SYSTEM");

    if (!spfValid || !dkimValid || !dmarcValid) {
      const reason = ([!spfValid && "SPF_INVALID", !dkimValid && "DKIM_INVALID", !dmarcValid && "DMARC_INVALID"] as (string | false)[])
        .filter(Boolean)
        .join(",");
      logger.warn(
        { campaignId, senderDomainId, spfValid, dkimValid, dmarcValid },
        `[send.agent] Failover candidate domain failed DNS validation (${reason}) — skipping`,
      );
      return { valid: false, reason };
    }

    return { valid: true };
  } catch (err) {
    logger.warn(
      { campaignId, senderDomainId, err },
      "[send.agent] DNS validation threw during failover check — treating domain as invalid",
    );
    return { valid: false, reason: "DNS_CHECK_FAILED" };
  }
}

async function validateMailboxForFailover(
  mailboxId: string,
  campaignId: string,
): Promise<{ valid: boolean; reason?: string }> {
  try {
    const { sendingDomain, spfValid, dkimValid, dmarcValid } = await verifyMailboxDns(mailboxId, "SYSTEM");

    if (!spfValid || !dkimValid || !dmarcValid) {
      const reason = ([!spfValid && "SPF_INVALID", !dkimValid && "DKIM_INVALID", !dmarcValid && "DMARC_INVALID"] as (string | false)[])
        .filter(Boolean)
        .join(",");
      logger.warn(
        { campaignId, mailboxId, sendingDomain, spfValid, dkimValid, dmarcValid },
        `[send.agent] Failover candidate mailbox DNS invalid (${reason}) — skipping`,
      );
      return { valid: false, reason };
    }

    return { valid: true };
  } catch (err) {
    logger.warn(
      { campaignId, mailboxId, err },
      "[send.agent] DNS validation threw during mailbox failover check — treating mailbox as invalid",
    );
    return { valid: false, reason: "DNS_CHECK_FAILED" };
  }
}

function classifyFailure(errorMsg: string): "permanent" | "retryable" {
  const normalized = errorMsg.toLowerCase();
  if (
    normalized.includes("550") ||
    normalized.includes("554") ||
    normalized.includes("501") ||
    normalized.includes("mailbox not found") ||
    normalized.includes("user unknown") ||
    normalized.includes("recipient rejected") ||
    normalized.includes("address rejected") ||
    normalized.includes("invalid recipient") ||
    normalized.includes("does not exist") ||
    normalized.includes("recipient address rejected") ||
    normalized.includes("no such user") ||
    normalized.includes("bad recipient")
  ) {
    return "permanent";
  }
  return "retryable";
}

export async function runSendAgent(campaignId: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      senderDomain: true,
      senderMailbox: true,
      createdBy: true,
    },
  });

  if (!campaign) throw new Error("Campaign not found");

  let mailbox = campaign.senderMailbox;
  let domain = campaign.senderDomain;

  if (!mailbox && !domain) {
    logger.error(
      {
        campaignId: campaign.id,
        status: campaign.status,
        linkedInAccountId: campaign.linkedInAccountId ?? null,
      },
      "[send.agent] No email sender configured — likely a scheduler routing bug; verify scan-queued-campaigns has senderMailboxId: { not: null }",
    );
    throw new Error("No sender mailbox or domain configured");
  }

  if (!mailbox) {
    throw new Error(
      "No sender mailbox configured for this campaign. " +
      "Domain-only sending is not currently supported."
    );
  }

  if (!["QUEUED", "SENDING", "PAUSED"].includes(campaign.status)) {
    throw new Error(`Invalid campaign state: ${campaign.status}`);
  }

  if (campaign.status === "PAUSED") return;

  const isMailboxMode = !!mailbox;
  const healthEntityId = mailbox.id;

  let health = isMailboxMode
    ? await enforceMailboxHealth(healthEntityId)
    : await enforceDomainHealth(domain!.id);

  if (!health.canSend) {
    logger.warn(
      { campaignId, oldMailboxId: mailbox.id },
      "[send.agent] Campaign mailbox is blocked. Attempting automatic failover..."
    );

    const canRotate = await tryRotateWithCooldown(campaignId);
    if (!canRotate) {
      logger.info({ campaignId }, "[send.agent] Health failover skipped — rotation cooldown active");
    } else {
      const failoverCandidates = await prisma.senderMailbox.findMany({
        where: {
          createdById: campaign.createdById,
          health: { notIn: ["BLOCKED"] },
          id: { not: mailbox.id },
        },
      });

      failoverCandidates.sort((a, b) =>
        (HEALTH_PRIORITY[a.health] ?? 3) - (HEALTH_PRIORITY[b.health] ?? 3) ||
        a.currentSent - b.currentSent
      );

      let chosenFailover: { mailbox: (typeof failoverCandidates)[0]; health: typeof health } | null = null;
      for (const candidate of failoverCandidates) {
        const candHealth = await enforceMailboxHealth(candidate.id);
        if (!candHealth.canSend) continue;
        const effectiveSent = await effectiveCurrentSent(prisma, "SenderMailbox", candidate.id);
        const warmupLim = getWarmupLimit({
          dailyLimit: candidate.dailyLimit,
          warmupEnabled: candidate.warmupEnabled,
          createdAt: candidate.createdAt,
          bounceRate: candidate.bounceRate,
          complaintRate: candidate.complaintRate,
          health: candidate.health,
        });
        const effectiveDailyLim = Math.floor(warmupLim * candHealth.effectiveRateMultiplier);
        if (Math.max(0, effectiveDailyLim - effectiveSent) < MIN_ROTATION_BATCH) continue;
        chosenFailover = { mailbox: candidate, health: candHealth };
        break;
      }

      if (chosenFailover) {
        const alternativeMailbox = chosenFailover.mailbox;
        const alternativeHealth = chosenFailover.health;
        const alternativeDomainStr = alternativeMailbox.emailAddress.split("@")[1];
        const alternativeDomain = await prisma.senderDomain.findFirst({
          where: {
            domain: alternativeDomainStr,
            createdById: campaign.createdById,
            health: { notIn: ["BLOCKED"] },
          },
        });

        const dnsCheck = await validateDomainForFailover(alternativeDomain?.id ?? null, campaignId);
        const mailboxDnsCheck = await validateMailboxForFailover(alternativeMailbox.id, campaignId);

        if (!dnsCheck.valid || !mailboxDnsCheck.valid) {
          logger.warn(
            {
              campaignId,
              candidateMailboxId: alternativeMailbox.id,
              candidateDomainId: alternativeDomain?.id,
              domainDnsReason: dnsCheck.reason,
              mailboxDnsReason: mailboxDnsCheck.reason,
            },
            "[send.agent] Health-failover candidate rejected: DNS invalid — campaign paused",
          );
        } else {
          await prisma.campaign.update({
            where: { id: campaignId },
            data: {
              senderMailboxId: alternativeMailbox.id,
              ...(alternativeDomain && { senderDomainId: alternativeDomain.id }),
            },
          });

          await prisma.deliverabilityEvent
            .create({
              data: {
                type: "MAILBOX_ROTATED",
                severity: "WARNING",
                ...(alternativeDomain && { senderDomainId: alternativeDomain.id }),
                metadata: {
                  reason: "health_failover",
                  campaignId,
                  fromMailboxId: mailbox.id,
                  toMailboxId: alternativeMailbox.id,
                  dnsValidated: true,
                },
              },
            })
            .catch((err) =>
              logger.warn({ err, campaignId }, "[send.agent] Non-fatal: deliverabilityEvent write failed"),
            );

          logger.info(
            {
              campaignId,
              oldMailboxId: mailbox.id,
              newMailboxId: alternativeMailbox.id,
              newDomainId: alternativeDomain?.id,
            },
            "[send.agent] Successfully failed over campaign to alternative mailbox (DNS validated)",
          );

          mailbox = alternativeMailbox;
          if (alternativeDomain) {
            domain = alternativeDomain;
          }
          health = alternativeHealth;
        }
      }
    }
  }

  if (!health.canSend) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "PAUSED", previousStatus: campaign.status },
    });
    logger.warn(
      { campaignId, healthEntityId: mailbox!.id, isMailboxMode },
      "[send.agent] Sender blocked and no alternative mailbox available — campaign paused"
    );
    return;
  }

  if (campaign.timezone) {
    try {
      Intl.DateTimeFormat("en-US", { timeZone: campaign.timezone });
    } catch {
      logger.error(
        { campaignId, timezone: campaign.timezone },
        "[send.agent] Campaign has invalid timezone — halting send until corrected"
      );
      await prisma.deliverabilityEvent.create({
        data: {
          type: "CONFIG_ERROR",
          severity: "WARNING",
          metadata: { campaignId, issue: "invalid_timezone", value: campaign.timezone },
        },
      }).catch(() => null);
      return;
    }
  }

  if (!isWithinSendWindow(campaign)) {
    logger.info({ campaignId }, "[send.agent] Outside campaign send window, skipping batch");
    return;
  }

  const senderMeta = mailbox ?? domain!;
  const getLimits = async (meta: typeof senderMeta, h: typeof health) => {
    const warmupLimit = getWarmupLimit({
      dailyLimit: meta.dailyLimit,
      warmupEnabled: meta.warmupEnabled,
      createdAt: meta.createdAt,
      bounceRate: meta.bounceRate,
      complaintRate: meta.complaintRate,
      health: meta.health,
    });
    const effectiveDailyLimit = Math.floor(warmupLimit * h.effectiveRateMultiplier);
    const table: "SenderMailbox" | "SenderDomain" = domain && meta.id === domain.id ? "SenderDomain" : "SenderMailbox";
    const effectiveSent = await effectiveCurrentSent(prisma, table, meta.id);
    const remainingToday = Math.max(0, effectiveDailyLimit - effectiveSent);
    const rawBatchSize = Math.min(campaign.dailySendLimit, remainingToday);
    return { warmupLimit, effectiveDailyLimit, rawBatchSize };
  };

  const limits = await getLimits(senderMeta, health);
  let { warmupLimit, effectiveDailyLimit, rawBatchSize } = limits;
  let effectiveRateMultiplier = health.effectiveRateMultiplier;

  if (rawBatchSize === 0) {
    logger.info(
      { campaignId, mailboxId: mailbox!.id, currentSent: senderMeta.currentSent },
      "[send.agent] Mailbox daily sending limit reached. Attempting to rotate to another mailbox with capacity..."
    );

    const canCapacityRotate = await tryRotateWithCooldown(campaignId);
    if (!canCapacityRotate) {
      logger.info({ campaignId }, "[send.agent] Capacity rotation skipped — rotation cooldown active");
    } else {
      const alternativeMailboxes = await prisma.senderMailbox.findMany({
        where: {
          createdById: campaign.createdById,
          health: { notIn: ["BLOCKED"] },
          id: { not: mailbox!.id },
        },
      });

      let rotatedMailbox = null;
      let rotatedDomain = null;
      let rotatedHealth = null;
      let rotatedLimits = null;

      for (const alt of alternativeMailboxes) {
        const altHealth = await enforceMailboxHealth(alt.id);
        if (!altHealth.canSend) continue;
        if (altHealth.effectiveRateMultiplier < 0.5) continue;

        const altLimits = await getLimits(alt, altHealth);
        if (altLimits.rawBatchSize < MIN_ROTATION_BATCH) continue;

        const altDomainStr = alt.emailAddress.split("@")[1];
        const altDomain = await prisma.senderDomain.findFirst({
          where: {
            domain: altDomainStr,
            createdById: campaign.createdById,
            health: { notIn: ["BLOCKED"] },
          },
        });

        const dnsCheck = await validateDomainForFailover(altDomain?.id ?? null, campaignId);
        const mailboxDnsCheck = await validateMailboxForFailover(alt.id, campaignId);
        if (!dnsCheck.valid || !mailboxDnsCheck.valid) {
          logger.info(
            {
              campaignId,
              candidateMailboxId: alt.id,
              candidateDomainId: altDomain?.id,
              domainDnsReason: dnsCheck.reason,
              mailboxDnsReason: mailboxDnsCheck.reason,
            },
            "[send.agent] Capacity-rotation candidate skipped: DNS invalid",
          );
          continue;
        }

        rotatedMailbox = alt;
        rotatedHealth = altHealth;
        rotatedLimits = altLimits;
        rotatedDomain = altDomain;
        break;
      }

      if (rotatedMailbox && rotatedHealth && rotatedLimits) {
        await prisma.campaign.update({
          where: { id: campaignId },
          data: {
            senderMailboxId: rotatedMailbox.id,
            ...(rotatedDomain && { senderDomainId: rotatedDomain.id }),
          },
        });

        await prisma.deliverabilityEvent.create({
          data: {
            type: "MAILBOX_ROTATED",
            severity: "INFO",
            ...(rotatedDomain && { senderDomainId: rotatedDomain.id }),
            metadata: {
              reason: "capacity_rotation",
              campaignId,
              fromMailboxId: mailbox!.id,
              toMailboxId: rotatedMailbox.id,
            },
          },
        }).catch((err) => logger.warn({ err, campaignId }, "[send.agent] Non-fatal: deliverabilityEvent write failed"));

        logger.info(
          {
            campaignId,
            oldMailboxId: mailbox!.id,
            newMailboxId: rotatedMailbox.id,
            newDomainId: rotatedDomain?.id,
          },
          "[send.agent] Successfully rotated campaign to a mailbox with sending capacity"
        );

        mailbox = rotatedMailbox;
        if (rotatedDomain) {
          domain = rotatedDomain;
        }
        health = rotatedHealth;
        warmupLimit = rotatedLimits.warmupLimit;
        effectiveDailyLimit = rotatedLimits.effectiveDailyLimit;
        effectiveRateMultiplier = rotatedHealth.effectiveRateMultiplier;
        rawBatchSize = rotatedLimits.rawBatchSize;
      }
    }
  }

  if (rawBatchSize === 0) {
    logger.info(
      {
        campaignId,
        currentSent: mailbox!.currentSent,
        warmupLimit,
        effectiveDailyLimit,
        effectiveRateMultiplier,
        warmupEnabled: mailbox!.warmupEnabled,
      },
      "[send.agent] Daily limit reached and no other mailbox has capacity, skipping batch"
    );
    return;
  }

  const CANDIDATE_POOL_MULTIPLIER = 3;

  const approvedMessageWhere = {
    lead: {
      campaignId,
      emailStatus: { notIn: BLOCKED_EMAIL_STATUSES },
      recommendedAction: { not: "DISQUALIFY" },
      ...(campaign.catchAllPolicy === "SKIP" && { emailCatchAll: false }),
      OR: [
        { replies: { none: {} } },
        { replies: { every: { intent: ReplyIntent.OUT_OF_OFFICE } } },
      ],
    },
    approvalStatus: ApprovalStatus.APPROVED,
    deliveryState: DeliveryState.QUEUED,
    OR: [
      { nextRetryAt: null },
      { nextRetryAt: { lte: new Date() } },
    ],
  };

  const candidatePool: CandidatePoolItem[] = (await prisma.outreachMessage.findMany({
    where: approvedMessageWhere,
    select: {
      id: true,
      createdAt: true,
      lead: {
        select: {
          qualificationScore: true,
          signals: {
            select: { signalType: true, confidence: true, createdAt: true },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: rawBatchSize * CANDIDATE_POOL_MULTIPLIER,
  })) as CandidatePoolItem[];

  if (candidatePool.length === 0) {
    const remaining = await prisma.outreachMessage.count({ where: approvedMessageWhere });

    if (remaining === 0) {
      const leadCount = await prisma.lead.count({ where: { campaignId, deletedAt: null } });

      if (leadCount === 0) {
        logger.warn({ campaignId }, "[send.agent] No leads found — research stage may not have run");
        await prisma.campaign.update({ where: { id: campaignId }, data: { status: "FAILED" } });
      } else {
        const pendingLinkedInSteps = await prisma.leadStepStatus.count({
          where: {
            lead: { campaignId },
            status: { in: ["PENDING", "SCHEDULED", "EXECUTING"] },
          },
        });
        if (pendingLinkedInSteps === 0) {
          await prisma.campaign.update({ where: { id: campaignId }, data: { status: "COMPLETED" } });
        }
      }
    }

    return;
  }

  const scored = candidatePool
    .map((msg) => ({ id: msg.id, score: scoreMessageForSend(msg) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, rawBatchSize);

  const activeMailboxTable = mailbox ? "SenderMailbox" : "SenderDomain";
  const activeEntityId = mailbox ? mailbox.id : domain!.id;

  const reservation = await reserveDailyCapacity(
    prisma,
    activeMailboxTable,
    activeEntityId,
    rawBatchSize,
    effectiveDailyLimit,
  );

  if (!reservation) {
    logger.info(
      { campaignId, activeEntityId, rawBatchSize, effectiveDailyLimit },
      "[send.agent] Daily capacity exhausted at reservation time — skipping batch"
    );
    return;
  }

  const reservationPayload = JSON.stringify({ reservedCapacity: rawBatchSize, mailboxId: activeEntityId });
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "QueueJob"
    SET payload = payload || ${reservationPayload}::jsonb
    WHERE "campaignId" = ${campaignId} AND status = 'ACTIVE'
  `).catch(() => null);

  const selectedIds = scored.map((m) => m.id);
  const claimToken = `worker_${Date.now()}_${randomUUID()}`;

  const claimed = await prisma.$queryRaw<{ id: string }[]>(
    Prisma.sql`
      UPDATE "OutreachMessage"
      SET "deliveryState" = ${DeliveryState.SENDING}::"DeliveryState",
          "claimToken"    = ${claimToken}
      WHERE id IN (
        SELECT id FROM "OutreachMessage"
        WHERE id = ANY(ARRAY[${Prisma.join(selectedIds)}])
          AND "deliveryState" = ${DeliveryState.QUEUED}::"DeliveryState"
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `
  );

  const claimedIds = new Set(claimed.map((r) => r.id));

  await prisma.campaign.update({
    where: { id: campaignId },
    data: { status: "SENDING" },
  });

  const messages = await prisma.outreachMessage.findMany({
    where: { id: { in: [...claimedIds] }, deliveryState: DeliveryState.SENDING, claimToken },
    include: {
      lead: {
        select: { email: true, firstName: true, companyName: true, website: true },
      },
    },
  });

  if (messages.length === 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "QUEUED" },
    });
    return;
  }

  const allEmails = messages
    .map((m) => m.lead.email)
    .filter((e): e is string => !!e);
  const allDomains = [...new Set(allEmails.map((e) => e.split("@")[1]))];

  const suppressionRows = await prisma.suppression.findMany({
    where: {
      userId: campaign.createdById,
      OR: [
        { email: { in: allEmails } },
        { domain: { in: allDomains } },
      ],
    },
    select: { email: true, domain: true },
  });

  const suppressedEmails = new Set(
    suppressionRows.map((s) => s.email?.toLowerCase()).filter(Boolean) as string[]
  );
  const suppressedDomains = new Set(
    suppressionRows.map((s) => s.domain?.toLowerCase()).filter(Boolean) as string[]
  );
  const isSuppressed = (email: string) => {
    const lower = email.toLowerCase();
    return suppressedEmails.has(lower) || suppressedDomains.has(lower.split("@")[1]);
  };

  const repliedLeadIds = messages
    .filter((m) => m.isFollowUp)
    .map((m) => m.leadId);

  const repliedLeadSet = new Set<string>();
  if (repliedLeadIds.length > 0) {
    const replies = await prisma.reply.findMany({
      where: { leadId: { in: repliedLeadIds } },
      select: { leadId: true },
    });
    for (const r of replies) repliedLeadSet.add(r.leadId);
  }

  const brand = await getBrandSettingsOrDefault(campaign.createdBy.id);
  const fromAddress = mailbox
    ? `${brand.senderName} <${mailbox.emailAddress}>`
    : `${brand.senderName} <outreach@${domain!.domain}>`;

  let provider: ReturnType<typeof createMailProvider> | null = null;
  let providerInitError: string | null = null;

  try {
    const rawCreds = decryptCredentials(mailbox!.credentials);
    provider = createMailProvider(rawCreds, {
      outlook: {
        mailboxId: mailbox!.id,
        redis,
        onTokenRotation: async (newRefreshToken: string) => {
          if (rawCreds.type === "OUTLOOK" && newRefreshToken !== rawCreds.refreshToken) {
            const rotated: OutlookCredentials = { ...rawCreds, refreshToken: newRefreshToken };
            await prisma.senderMailbox.update({
              where: { id: mailbox!.id },
              data: { credentials: encryptJson(rotated) },
            });
          }
        },
      },
    });
  } catch (err) {
    providerInitError = err instanceof Error ? err.message : "unknown error";
  }

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    if (i % PAUSE_CHECK_INTERVAL === 0) {
      const [latest, midHealth] = await Promise.all([
        prisma.campaign.findUnique({ where: { id: campaignId }, select: { status: true } }),
        enforceMailboxHealth(mailbox!.id),
      ]);

      if (latest?.status === "PAUSED" || !midHealth.canSend) {
        const remainingIds = messages.slice(i).map((m) => m.id);
        await prisma.outreachMessage.updateMany({
          where: { id: { in: remainingIds }, deliveryState: DeliveryState.SENDING },
          data: { deliveryState: DeliveryState.QUEUED, claimToken: null },
        });
        if (!midHealth.canSend) {
          await prisma.campaign.update({
            where: { id: campaignId },
            data: { status: "PAUSED", previousStatus: campaign.status },
          });
          logger.warn(
            { campaignId, requeued: remainingIds.length },
            "[send.agent] Mailbox blocked mid-batch — campaign paused, messages requeued"
          );
        } else {
          logger.info(
            { campaignId, requeued: remainingIds.length },
            "[send.agent] Campaign paused mid-batch — messages requeued"
          );
        }
        return;
      }
    }

    const email = message.lead.email;

    if (!email || !EMAIL_REGEX.test(email)) {
      await prisma.outreachMessage.update({
        where: { id: message.id },
        data: { deliveryState: DeliveryState.SUPPRESSED, claimToken: null },
      });
      continue;
    }

    if (isSuppressed(email)) {
      await prisma.outreachMessage.update({
        where: { id: message.id },
        data: { deliveryState: DeliveryState.SUPPRESSED, claimToken: null },
      });
      continue;
    }

    if (message.isFollowUp && repliedLeadSet.has(message.leadId)) {
      await prisma.outreachMessage.update({
        where: { id: message.id },
        data: { deliveryState: DeliveryState.SUPPRESSED, claimToken: null },
      });
      logger.info(
        { messageId: message.id, leadId: message.leadId },
        "[send.agent] Follow-up suppressed — lead replied since message was claimed"
      );
      continue;
    }

    const content = parseBody(message.body);
    const { html, text } = renderEmailTemplate(
      brand,
      {
        subject: message.subject,
        greeting: content.greeting,
        opening: content.opening,
        body: content.body,
        ctaText: content.ctaText,
        closing: content.closing,
        ctaUrl: message.lead.website ?? undefined,
        messageId: message.id,
      },
      { style: (campaign.templateStyle as TemplateStyle | undefined) ?? "BRANDED" },
    );

    let result: SendResult;
    if (providerInitError || !provider) {
      result = {
        success: false,
        error: providerInitError ?? "Provider unavailable",
      };
    } else {
      try {
        result = await provider.sendEmail({
          to: email,
          from: fromAddress,
          subject: message.subject,
          html,
          text,
          headers: buildListUnsubscribeHeaders(message.id) ?? undefined,
        });
      } catch (err) {
        result = {
          success: false,
          error: err instanceof Error ? err.message : "unknown error",
        };
      }
    }

    if (result.success) {
      await prisma.outreachMessage.update({
        where: { id: message.id },
        data: {
          deliveryState: DeliveryState.SENT,
          sentAt: new Date(),
          externalMessageId: result.externalId,
          claimToken: null,
        },
      });
      sent++;

      if (sent % 3 === 0 || i === messages.length - 1) {
        emitCampaignEvent({
          campaignId,
          type: "progress",
          jobName: "send-batch",
          label: "Sending Emails",
          progress: Math.round(((i + 1) / messages.length) * 100),
          detail: `Sent ${sent}/${messages.length}`,
        });
      }
    } else {
      const errorMsg = result.error ?? "unknown error";
      const failureType = classifyFailure(errorMsg);
      const isPermanent = failureType === "permanent";
      const newCount = isPermanent ? MAX_RETRIES : (message.retryCount ?? 0) + 1;

      await prisma.outreachMessage.update({
        where: { id: message.id },
        data: {
          deliveryState: newCount >= MAX_RETRIES ? DeliveryState.FAILED : DeliveryState.QUEUED,
          retryCount: newCount,
          lastError: errorMsg,
          claimToken: null,
          nextRetryAt:
            newCount < MAX_RETRIES
              ? new Date(Date.now() + Math.pow(2, newCount) * 60_000)
              : null,
        },
      });
      failed++;
    }

    if (i < messages.length - 1) {
      await sleep(jitterMs());
    }
  }

  if (sent < rawBatchSize) {
    const unused = rawBatchSize - sent;
    if (mailbox) {
      await prisma.senderMailbox.update({
        where: { id: mailbox.id },
        data: { currentSent: { decrement: unused }, totalSent: { increment: sent } },
      });
    } else {
      await prisma.senderDomain.update({
        where: { id: domain!.id },
        data: { currentSent: { decrement: unused }, totalSent: { increment: sent } },
      });
    }
  } else if (mailbox) {
    await prisma.senderMailbox.update({
      where: { id: mailbox.id },
      data: { totalSent: { increment: sent } },
    });
  } else {
    await prisma.senderDomain.update({
      where: { id: domain!.id },
      data: { totalSent: { increment: sent } },
    });
  }

  if (sent > 0) {
    await Promise.all([
      mailbox ? recalculateMailboxHealth(mailbox.id) : Promise.resolve(),
      domain ? recalculateDomainHealth(domain.id) : Promise.resolve(),
    ]).catch(() => null);

    await CacheService.invalidateVersioned(`version:sender-mailboxes:${campaign.createdById}`).catch(() => null);
  }

  const [remainingQueued, remainingSending] = await Promise.all([
    prisma.outreachMessage.count({ where: approvedMessageWhere }),
    prisma.outreachMessage.count({
      where: {
        lead: { campaignId },
        deliveryState: DeliveryState.SENDING,
      },
    }),
  ]);

  if (remainingQueued === 0 && remainingSending === 0) {
    await prisma.$executeRaw(
      Prisma.sql`
        UPDATE "Campaign"
        SET status = 'COMPLETED'
        WHERE id = ${campaignId}
          AND NOT EXISTS (
            SELECT 1 FROM "OutreachMessage" om
            JOIN "Lead" l ON l.id = om."leadId"
            WHERE l."campaignId" = ${campaignId}
              AND om."deliveryState" IN ('QUEUED', 'SENDING')
          )
          AND NOT EXISTS (
            SELECT 1 FROM "LeadStepStatus" lss
            JOIN "Lead" l ON l.id = lss."leadId"
            WHERE l."campaignId" = ${campaignId}
              AND lss.status IN ('PENDING', 'SCHEDULED', 'EXECUTING')
          )
      `
    );
  } else {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "QUEUED" },
    });
  }

  logger.info(
    {
      campaignId,
      sent,
      failed,
      warmupLimit,
      effectiveDailyLimit,
      effectiveRateMultiplier,
      warmupEnabled: senderMeta.warmupEnabled,
      isMailboxMode,
    },
    "[send.agent] batch complete"
  );
  emitCampaignEvent({
    campaignId,
    type: "completed",
    jobName: "send-batch",
    label: "Sending Emails",
    detail: `${sent} sent, ${failed} failed`,
  });
}