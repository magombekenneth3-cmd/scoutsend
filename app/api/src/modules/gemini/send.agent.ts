import { randomUUID } from "crypto";
import { ApprovalStatus, DeliveryState, ReplyIntent, EmailStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { renderEmailTemplate, TemplateStyle, buildListUnsubscribeHeaders } from "../../lib/emailTemplate";
import { logLeadJourneyEvent } from "../../lib/leads/lead-journey.service";
import { getBrandSettingsOrDefault } from "../brandSettings/brandsettings.service";
import { extractJSON } from "../gemini/gemini.client";
import { logger } from "../../lib/logger";
import { createMailProvider, MailboxCredentials, SendResult, OutlookCredentials } from "../../lib/mail";
import { redis } from "../../lib/ioredis";
import { decryptMailboxCredentials, encryptJson } from "../../lib/mail/crypto";
import { DOMAIN_HEALTH_THRESHOLDS, AUDIT_EVENTS } from "../../lib/constants";
import { emitCampaignEvent } from "../../lib/campaign-events";
import { effectiveCurrentSent, reserveDailyCapacity } from "../../lib/daily-quota";
import {
  buildSendIdempotencyKey,
  createOrRecoverSendIntent,
} from "../../lib/send/send-intent.service";
import { verifySenderDomainDns } from "../senderDomain/senderDomain.services";
import { verifyMailboxDns } from "../senderMailbox/senderMailbox.services";
import { CacheService } from "../../lib/cache";
import { recalculateDomainHealth, recalculateMailboxHealth } from "../Deliverybilityevents/deliverbility.service";
import { logAudit } from "../audit/audit.service";
import { checkBounceCircuitBreaker } from "./campaign-health.agent";
import dns from "dns/promises";



const WARMUP_BOUNCE_HOLD = 0.03;
const WARMUP_COMPLAINT_HOLD = 0.001;

const BOUNCE_PENALTY_DAYS_PER_EXCESS = 7;
const COMPLAINT_PENALTY_DAYS_PER_EXCESS = 7;

const DEGRADED_EXTRA_PENALTY_DAYS = 7;


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
  let greeting = "";
  let opening = "";
  let body = raw ? raw.trim() : "";
  let ctaText = "";
  let closing = "";

  try {
    const parsed = extractJSON<ParsedBody>(raw);
    if (parsed && typeof parsed === "object" && parsed.body) {
      greeting = parsed.greeting ?? "";
      opening = parsed.opening ?? "";
      body = parsed.body;
      ctaText = parsed.ctaText ?? "";
      closing = parsed.closing ?? "";
    }
  } catch (err) {
    logger.warn({ err }, "[send.agent] parseBody JSON extraction failed, falling back to regex");
  }

  if (!body) body = raw;

  const inlineGreetingMatch = body.match(/^(?:Hi|Hello|Hey|Dear)\b[^\n,.]*[,.]?/i);
  if (inlineGreetingMatch) {
    if (!greeting) {
      greeting = inlineGreetingMatch[0].trim();
    }
    body = body.slice(inlineGreetingMatch[0].length).trim();
  }

  if (!greeting && !opening) {
    const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length > 0 && GREETING_RE.test(lines[0])) {
      greeting = lines[0];
      body = lines.slice(1).join("\n\n");
    }
  }

  const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 0) {
    const lastLine = lines[lines.length - 1];
    if (CLOSING_RE.test(lastLine)) {
      if (!closing) closing = lastLine;
      body = lines.slice(0, -1).join("\n\n");
    }
  }

  if (!closing) closing = "Best,";

  return {
    greeting,
    opening,
    body,
    ctaText,
    closing,
  };
}

interface LeadVariableContext {
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  website?: string | null;
}

function replaceTemplateVars(template: string, ctx: LeadVariableContext): string {
  const firstName = ctx.firstName?.trim() || "there";
  const lastName = ctx.lastName?.trim() || "";
  const companyName = ctx.companyName?.trim() || "your company";
  const website = ctx.website?.trim() || "";

  return template
    .replace(/\{\{\s*(?:first_name|firstName)\s*\}\}/gi, firstName)
    .replace(/\{\{\s*(?:last_name|lastName)\s*\}\}/gi, lastName)
    .replace(/\{\{\s*(?:company_name|companyName|company)\s*\}\}/gi, companyName)
    .replace(/\{\{\s*(?:website|url)\s*\}\}/gi, website)
    .replace(/\s+([,.!?])/g, "$1");
}

function formatMessageIdHeader(rawId: string | null | undefined): string | undefined {
  if (!rawId) return undefined;
  const cleaned = rawId.trim().replace(/^<+|>+$/g, "");
  return cleaned ? `<${cleaned}>` : undefined;
}

const SPAM_TRIGGER_PATTERNS: RegExp[] = [
  /\b100%\s*free\b/i,
  /\bact\s*now\b/i,
  /\blimited\s*time\s*offer\b/i,
  /\bclick\s*here\s*immediately\b/i,
  /\bno\s*obligation\b/i,
  /\brisk[\s-]*free\b/i,
  /\bcongratulations!?\s*you\b/i,
  /\bdouble\s*your\b/i,
  /\bmillion\s*dollars\b/i,
  /\b(?:buy|order)\s*now\b/i,
  /\bdon'?t\s*miss\s*out\b/i,
  /\bexclusive\s*deal\b/i,
  /\bfree\s*(?:gift|money|access|trial)\b/i,
  /\bguaranteed\b/i,
  /\bno\s*(?:cost|catch|strings)\b/i,
  /\bwinner\b/i,
  /\burgent\b/i,
  /\bunsubscribe\b/i,
  /\b(?:cash|money)\s*(?:back|bonus)\b/i,
  /\blowest\s*price\b/i,
];

function scoreSpamRisk(text: string): number {
  let hits = 0;
  for (const pattern of SPAM_TRIGGER_PATTERNS) {
    if (pattern.test(text)) hits++;
  }
  return hits;
}

const CROSS_CAMPAIGN_DEDUP_TTL = 86400;

const MX_CHECK_TIMEOUT_MS = 3_000;

async function hasMxRecord(domain: string, cache: Map<string, boolean>): Promise<boolean> {
  const cached = cache.get(domain);
  if (cached !== undefined) return cached;

  try {
    const result = await Promise.race([
      dns.resolveMx(domain),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`MX timeout: ${domain}`)), MX_CHECK_TIMEOUT_MS)
      ),
    ]);
    const hasMx = Array.isArray(result) && result.length > 0;
    cache.set(domain, hasMx);
    return hasMx;
  } catch {
    cache.set(domain, false);
    return false;
  }
}

const MAX_RETRIES = 3;
const PAUSE_CHECK_INTERVAL = 25;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WARMUP_DAYS = 28;
const MIN_WARMUP_SEND = 5;

const SEND_JITTER_MIN_MS = 90_000;
const SEND_JITTER_RANGE_MS = 150_000;
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
const SAFE_UTC_WINDOW_START = 14;
const SAFE_UTC_WINDOW_END = 18;

async function tryRotateWithCooldown(campaignId: string): Promise<boolean> {
  const key = `rotation-lock:${campaignId}`;
  const acquired = await redis.set(key, "1", "EX", ROTATION_COOLDOWN_SEC, "NX");
  return !!acquired;
}

function pickWeightedRandomMailbox<T extends { remainingToday: number }>(items: T[]): T {
  if (items.length === 1) return items[0];
  const totalWeight = items.reduce((sum, item) => sum + Math.max(1, item.remainingToday), 0);
  let randomWeight = Math.random() * totalWeight;
  for (const item of items) {
    randomWeight -= Math.max(1, item.remainingToday);
    if (randomWeight <= 0) return item;
  }
  return items[0];
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
  const calculatedLimit = Math.floor(
    MIN_WARMUP_SEND + (domain.dailyLimit - MIN_WARMUP_SEND) * progress,
  );

  const healthMultiplier =
    domain.health === "HEALTHY" ? 1.0 :
      domain.health === "WARNING" ? 0.6 :
        domain.health === "DEGRADED" ? 0.25 : 0;

  const healthCappedLimit = Math.floor(domain.dailyLimit * healthMultiplier);
  return Math.max(0, Math.min(calculatedLimit, healthCappedLimit));
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

const DEFAULT_SEND_WINDOW_START = 9;
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

const LOCATION_TIMEZONE_MAP: Array<{ pattern: RegExp; timezone: string }> = [
  { pattern: /\b(?:California|San Francisco|Los Angeles|San Diego|San Jose|Palo Alto|Sacramento|Oakland|Irvine|Santa Clara|Sunnyvale)\b|,\s*CA\b/i, timezone: "America/Los_Angeles" },
  { pattern: /\b(?:Seattle|Spokane|Tacoma|Bellevue)\b|,\s*WA\b/i, timezone: "America/Los_Angeles" },
  { pattern: /\b(?:Oregon|Portland|Eugene)\b|,\s*OR\b/i, timezone: "America/Los_Angeles" },
  { pattern: /\b(?:New York|NYC|Brooklyn|Manhattan|Buffalo|Rochester)\b|,\s*NY\b/i, timezone: "America/New_York" },
  { pattern: /\b(?:Massachusetts|Boston|Cambridge|Worcester)\b|,\s*MA\b/i, timezone: "America/New_York" },
  { pattern: /\b(?:Florida|Miami|Orlando|Tampa|Jacksonville)\b|,\s*FL\b/i, timezone: "America/New_York" },
  { pattern: /\b(?:Georgia|Atlanta|Savannah)\b|,\s*GA\b/i, timezone: "America/New_York" },
  { pattern: /\b(?:New Jersey|Jersey City|Newark)\b|,\s*NJ\b/i, timezone: "America/New_York" },
  { pattern: /\b(?:Pennsylvania|Philadelphia|Pittsburgh)\b|,\s*PA\b/i, timezone: "America/New_York" },
  { pattern: /\b(?:North Carolina|Charlotte|Raleigh)\b|,\s*NC\b/i, timezone: "America/New_York" },
  { pattern: /\b(?:Virginia|Richmond|Arlington)\b|,\s*VA\b/i, timezone: "America/New_York" },
  { pattern: /\b(?:Washington DC|D\.C\.|District of Columbia)\b/i, timezone: "America/New_York" },
  { pattern: /\b(?:Texas|Austin|Dallas|Houston|San Antonio|Fort Worth)\b|,\s*TX\b/i, timezone: "America/Chicago" },
  { pattern: /\b(?:Illinois|Chicago|Naperville)\b|,\s*IL\b/i, timezone: "America/Chicago" },
  { pattern: /\b(?:Minnesota|Minneapolis|Saint Paul|St\.?\s*Paul)\b|,\s*MN\b/i, timezone: "America/Chicago" },
  { pattern: /\b(?:Colorado|Denver|Boulder|Colorado Springs)\b|,\s*CO\b/i, timezone: "America/Chicago" },
  { pattern: /\b(?:Missouri|St\.?\s*Louis|Kansas City)\b|,\s*MO\b/i, timezone: "America/Chicago" },
  { pattern: /\b(?:Kansas)\b|,\s*KS\b/i, timezone: "America/Chicago" },
  { pattern: /\b(?:Indiana|Indianapolis)\b|,\s*IN\s*,\s*(?:USA?|United States)\b/i, timezone: "America/Indiana/Indianapolis" },
  { pattern: /\b(?:Arizona|Phoenix|Scottsdale|Tucson)\b|,\s*AZ\b/i, timezone: "America/Phoenix" },
  { pattern: /\b(?:Nevada|Las Vegas|Reno)\b|,\s*NV\b/i, timezone: "America/Phoenix" },
  { pattern: /\b(?:Utah|Salt Lake City|Provo)\b|,\s*UT\b/i, timezone: "America/Phoenix" },
  { pattern: /\b(?:Canada|Toronto|Ottawa|Hamilton|Halifax)\b|,\s*CA\s*,\s*Canada\b/i, timezone: "America/Toronto" },
  { pattern: /\b(?:Vancouver|Calgary|Edmonton|Winnipeg)\b/i, timezone: "America/Vancouver" },
  { pattern: /\b(?:Montreal|Montréal|Quebec|Québec)\b/i, timezone: "America/Toronto" },
  { pattern: /\b(?:Mexico|México|Mexico City|CDMX|Guadalajara|Monterrey)\b|,\s*MX\b/i, timezone: "America/Mexico_City" },
  { pattern: /\b(?:Brazil|Brasil|São Paulo|Sao Paulo|Rio de Janeiro|Brasília|Curitiba)\b|,\s*BR\b/i, timezone: "America/Sao_Paulo" },
  { pattern: /\b(?:Argentina|Buenos Aires|Chile|Santiago)\b/i, timezone: "America/Argentina/Buenos_Aires" },
  { pattern: /\b(?:Colombia|Bogota|Bogotá|Peru|Lima|Ecuador|Quito|Venezuela|Caracas)\b/i, timezone: "America/Bogota" },
  { pattern: /\b(?:United Kingdom|London|England|Ireland|Dublin|Scotland|Wales|Edinburgh|Manchester|Birmingham|Belfast)\b|,\s*(?:UK|GB)\b/i, timezone: "Europe/London" },
  { pattern: /\b(?:Germany|Deutschland|Berlin|Munich|München|Frankfurt|Hamburg|Cologne|Köln|Stuttgart|Düsseldorf)\b|,\s*DE\b/i, timezone: "Europe/Berlin" },
  { pattern: /\b(?:France|Paris|Lyon|Marseille|Toulouse|Nice)\b|,\s*FR\b/i, timezone: "Europe/Paris" },
  { pattern: /\b(?:Spain|España|Madrid|Barcelona|Valencia|Seville)\b|,\s*ES\b/i, timezone: "Europe/Madrid" },
  { pattern: /\b(?:Italy|Italia|Rome|Roma|Milan|Milano|Turin|Naples)\b|,\s*IT\b/i, timezone: "Europe/Rome" },
  { pattern: /\b(?:Netherlands|Holland|Amsterdam|Rotterdam|The Hague|Utrecht)\b|,\s*NL\b/i, timezone: "Europe/Amsterdam" },
  { pattern: /\b(?:Sweden|Sverige|Stockholm|Gothenburg|Malmö)\b|,\s*SE\b/i, timezone: "Europe/Stockholm" },
  { pattern: /\b(?:Norway|Norge|Oslo|Bergen)\b|,\s*NO\b/i, timezone: "Europe/Oslo" },
  { pattern: /\b(?:Denmark|Danmark|Copenhagen|København)\b|,\s*DK\b/i, timezone: "Europe/Copenhagen" },
  { pattern: /\b(?:Finland|Suomi|Helsinki)\b|,\s*FI\b/i, timezone: "Europe/Helsinki" },
  { pattern: /\b(?:Poland|Polska|Warsaw|Warszawa|Kraków|Cracow|Wrocław)\b|,\s*PL\b/i, timezone: "Europe/Warsaw" },
  { pattern: /\b(?:Switzerland|Schweiz|Zurich|Zürich|Geneva|Genève|Basel|Bern)\b|,\s*CH\b/i, timezone: "Europe/Zurich" },
  { pattern: /\b(?:Austria|Österreich|Vienna|Wien)\b|,\s*AT\b/i, timezone: "Europe/Vienna" },
  { pattern: /\b(?:Belgium|België|Belgique|Brussels|Bruxelles|Antwerp)\b|,\s*BE\b/i, timezone: "Europe/Brussels" },
  { pattern: /\b(?:Turkey|Türkiye|Istanbul|Ankara)\b|,\s*TR\b/i, timezone: "Europe/Istanbul" },
  { pattern: /\b(?:South Africa|Johannesburg|Cape Town|Durban|Pretoria|Nigeria|Lagos|Abuja|Kenya|Nairobi|Ghana|Accra)\b|,\s*ZA\b/i, timezone: "Africa/Johannesburg" },
  { pattern: /\b(?:Egypt|Cairo|Alexandria)\b|,\s*EG\b/i, timezone: "Africa/Cairo" },
  { pattern: /\b(?:Israel|Tel Aviv|Jerusalem|Haifa)\b|,\s*IL\b/i, timezone: "Asia/Jerusalem" },
  { pattern: /\b(?:UAE|United Arab Emirates|Dubai|Abu Dhabi|Saudi Arabia|Riyadh|Qatar|Doha|Bahrain|Kuwait)\b/i, timezone: "Asia/Dubai" },
  { pattern: /\b(?:India|Bharat|Mumbai|Delhi|New Delhi|Bangalore|Bengaluru|Hyderabad|Chennai|Kolkata|Calcutta|Pune|Ahmedabad|Jaipur|Surat|Noida|Gurgaon|Gurugram)\b|,\s*IN\b/i, timezone: "Asia/Kolkata" },
  { pattern: /\b(?:Pakistan|Karachi|Lahore|Bangladesh|Dhaka|Sri Lanka|Colombo)\b/i, timezone: "Asia/Colombo" },
  { pattern: /\b(?:Singapore)\b|,\s*SG\b/i, timezone: "Asia/Singapore" },
  { pattern: /\b(?:Malaysia|Kuala Lumpur|KL|Philippines|Manila|Indonesia|Jakarta|Bali)\b/i, timezone: "Asia/Singapore" },
  { pattern: /\b(?:Vietnam|Ho Chi Minh|Hanoi|Thailand|Bangkok)\b/i, timezone: "Asia/Bangkok" },
  { pattern: /\b(?:China|Beijing|Shanghai|Shenzhen|Guangzhou|Chengdu|Hangzhou)\b|,\s*CN\b/i, timezone: "Asia/Shanghai" },
  { pattern: /\b(?:Hong Kong|HK)\b/i, timezone: "Asia/Hong_Kong" },
  { pattern: /\b(?:South Korea|Korea|Seoul|Busan|Incheon)\b|,\s*KR\b/i, timezone: "Asia/Seoul" },
  { pattern: /\b(?:Japan|Nippon|Nihon|Tokyo|Osaka|Kyoto|Yokohama|Nagoya)\b|,\s*JP\b/i, timezone: "Asia/Tokyo" },
  { pattern: /\b(?:Australia|Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra)\b|,\s*AU\b/i, timezone: "Australia/Sydney" },
  { pattern: /\b(?:New Zealand|Auckland|Wellington|Christchurch)\b|,\s*NZ\b/i, timezone: "Pacific/Auckland" },
];

const TLD_TIMEZONE_MAP: Array<{ tld: string; timezone: string }> = [
  { tld: ".co.uk", timezone: "Europe/London" },
  { tld: ".uk", timezone: "Europe/London" },
  { tld: ".ie", timezone: "Europe/London" },
  { tld: ".de", timezone: "Europe/Berlin" },
  { tld: ".at", timezone: "Europe/Berlin" },
  { tld: ".ch", timezone: "Europe/Berlin" },
  { tld: ".fr", timezone: "Europe/Paris" },
  { tld: ".be", timezone: "Europe/Brussels" },
  { tld: ".nl", timezone: "Europe/Amsterdam" },
  { tld: ".es", timezone: "Europe/Madrid" },
  { tld: ".it", timezone: "Europe/Rome" },
  { tld: ".se", timezone: "Europe/Stockholm" },
  { tld: ".no", timezone: "Europe/Oslo" },
  { tld: ".dk", timezone: "Europe/Copenhagen" },
  { tld: ".fi", timezone: "Europe/Helsinki" },
  { tld: ".pl", timezone: "Europe/Warsaw" },
  { tld: ".cz", timezone: "Europe/Prague" },
  { tld: ".ca", timezone: "America/Toronto" },
  { tld: ".com.au", timezone: "Australia/Sydney" },
  { tld: ".au", timezone: "Australia/Sydney" },
  { tld: ".nz", timezone: "Pacific/Auckland" },
  { tld: ".in", timezone: "Asia/Kolkata" },
  { tld: ".sg", timezone: "Asia/Singapore" },
  { tld: ".jp", timezone: "Asia/Tokyo" },
  { tld: ".co.jp", timezone: "Asia/Tokyo" },
  { tld: ".kr", timezone: "Asia/Seoul" },
  { tld: ".co.kr", timezone: "Asia/Seoul" },
  { tld: ".hk", timezone: "Asia/Hong_Kong" },
  { tld: ".cn", timezone: "Asia/Shanghai" },
  { tld: ".com.br", timezone: "America/Sao_Paulo" },
  { tld: ".br", timezone: "America/Sao_Paulo" },
  { tld: ".mx", timezone: "America/Mexico_City" },
  { tld: ".za", timezone: "Africa/Johannesburg" },
  { tld: ".ae", timezone: "Asia/Dubai" },
  { tld: ".il", timezone: "Asia/Jerusalem" },
];

function resolveTimezoneFromWebsite(website: string): string | null {
  try {
    const raw = website.trim();
    const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const host = new URL(href).hostname.toLowerCase();
    for (const entry of TLD_TIMEZONE_MAP) {
      if (host.endsWith(entry.tld)) return entry.timezone;
    }
  } catch { }
  return null;
}

export function resolveLeadTimezone(
  location: string | null | undefined,
  fallbackTimezone: string | null,
  website?: string | null,
  companyLocation?: string | null,
): string | null {
  const primaryLoc = location?.trim();
  if (primaryLoc) {
    for (const entry of LOCATION_TIMEZONE_MAP) {
      if (entry.pattern.test(primaryLoc)) return entry.timezone;
    }
  }
  const secondaryLoc = companyLocation?.trim();
  if (secondaryLoc) {
    for (const entry of LOCATION_TIMEZONE_MAP) {
      if (entry.pattern.test(secondaryLoc)) return entry.timezone;
    }
  }
  if (website) {
    const tldTz = resolveTimezoneFromWebsite(website);
    if (tldTz) return tldTz;
  }
  if (fallbackTimezone && fallbackTimezone.trim().length > 0) return fallbackTimezone;
  return "America/New_York";
}

export function isLeadInSendWindow(
  leadLocation: string | null | undefined,
  campaign: SendWindowCampaign,
  leadWebsite?: string | null,
  companyLocation?: string | null,
): boolean {
  const targetTimezone = resolveLeadTimezone(leadLocation, campaign.timezone, leadWebsite, companyLocation);
  if (!targetTimezone) {
    logger.info(
      { leadLocation, leadWebsite, companyLocation },
      "[send.agent] Timezone unresolved for lead — defaulting to safe UTC business hour window"
    );
  }
  return isWithinSendWindow({
    ...campaign,
    timezone: targetTimezone,
  });
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

type FailureCategory = "permanent" | "reputation_block" | "retryable";

function classifyFailure(errorMsg: string): FailureCategory {
  const normalized = errorMsg.toLowerCase();
  if (
    normalized.includes("5.7.1") ||
    normalized.includes("spamhaus") ||
    normalized.includes("ip blocked") ||
    normalized.includes("blacklisted") ||
    normalized.includes("client host blocked") ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("reputation")
  ) {
    return "reputation_block";
  }
  if (
    normalized.includes("5.1.1") ||
    normalized.includes("550 5.1.") ||
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

function isTransientMailboxError(errorMsg?: string | null): boolean {
  if (!errorMsg) return false;
  const n = errorMsg.toLowerCase();
  return (
    n.includes("429") ||
    n.includes("451") ||
    n.includes("535") ||
    n.includes("554") ||
    n.includes("5.7.") ||
    n.includes("4.7.") ||
    n.includes("invalid_grant") ||
    n.includes("unauthorized") ||
    n.includes("authentication failed") ||
    n.includes("rate limit") ||
    n.includes("quota exceeded") ||
    n.includes("econnreset") ||
    n.includes("etimedout") ||
    n.includes("eauth") ||
    n.includes("token expired") ||
    n.includes("provider unavailable")
  );
}

async function coolOffMailbox(mailboxId: string): Promise<void> {
  const failKey = `mailbox:failcount:${mailboxId}`;
  const coolKey = `mailbox:cooloff:${mailboxId}`;
  const failCount = await redis.incr(failKey);
  if (failCount === 1) {
    await redis.expire(failKey, 3600);
  }
  const backoffSec = Math.min(900 * Math.pow(2, Math.max(0, failCount - 1)), 7200);
  await redis.set(coolKey, "1", "EX", backoffSec);
  logger.warn(
    { mailboxId, failCount, backoffSec },
    "[send.agent] Mailbox hit transient failure — cool-off circuit breaker activated"
  );
}

async function verifyEmailAddress(email: string): Promise<"VALID" | "INVALID" | "UNKNOWN"> {
  if (process.env.ZEROBOUNCE_API_KEY) {
    try {
      const res = await fetch(
        `https://api.zerobounce.net/v2/validate?api_key=${process.env.ZEROBOUNCE_API_KEY}&email=${encodeURIComponent(email)}&ip_address=`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (res.ok) {
        const data = (await res.json()) as { status?: string };
        const status = data.status?.toLowerCase();
        if (status === "invalid" || status === "spamtrap" || status === "abuse" || status === "do_not_mail") {
          return "INVALID";
        }
        return "VALID";
      }
    } catch (err) {
      logger.warn({ err, email }, "[send.agent] ZeroBounce real-time verification failed");
    }
  }

  if (process.env.NEVERBOUNCE_API_KEY) {
    try {
      const res = await fetch(
        `https://api.neverbounce.com/v4/single/check?key=${process.env.NEVERBOUNCE_API_KEY}&email=${encodeURIComponent(email)}`,
        { signal: AbortSignal.timeout(10000) }
      );
      if (res.ok) {
        const data = (await res.json()) as { result?: string };
        const result = data.result?.toLowerCase();
        if (result === "invalid" || result === "disposable") {
          return "INVALID";
        }
        return "VALID";
      }
    } catch (err) {
      logger.warn({ err, email }, "[send.agent] NeverBounce real-time verification failed");
    }
  }

  return "UNKNOWN";
}

export async function runSendAgent(campaignId: string): Promise<void> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      senderDomain: true,
      senderMailbox: true,
      senderMailboxes: true,
      createdBy: true,
    },
  });

  if (!campaign) throw new Error("Campaign not found");

  let poolMailboxes = campaign.senderMailboxes;
  if (poolMailboxes.length === 0 && campaign.senderMailbox) {
    poolMailboxes = [campaign.senderMailbox];
  }

  const domain = campaign.senderDomain;

  if (poolMailboxes.length === 0 && !domain) {
    logger.error(
      {
        campaignId: campaign.id,
        status: campaign.status,
        linkedInAccountId: campaign.linkedInAccountId ?? null,
      },
      "[send.agent] No email sender configured — likely a scheduler routing bug",
    );
    throw new Error("No sender mailbox or domain configured");
  }

  if (poolMailboxes.length === 0) {
    throw new Error(
      "No sender mailbox configured for this campaign. " +
      "Domain-only sending is not currently supported."
    );
  }

  if (!["QUEUED", "SENDING", "PAUSED"].includes(campaign.status)) {
    throw new Error(`Invalid campaign state: ${campaign.status}`);
  }

  if (campaign.status === "PAUSED") return;

  type CachedMailboxState = {
    health: Awaited<ReturnType<typeof enforceMailboxHealth>>;
    limits: { warmupLimit: number; effectiveDailyLimit: number; remainingToday: number };
  };

  const mailboxStateCache = new Map<string, CachedMailboxState>();
  const mailboxDomainCache = new Map<string, Awaited<ReturnType<typeof prisma.senderDomain.findFirst>>>();

  const getMailboxState = async (meta: typeof poolMailboxes[0]): Promise<CachedMailboxState> => {
    const cached = mailboxStateCache.get(meta.id);
    if (cached) return cached;

    const isCooledOff = await redis.get(`mailbox:cooloff:${meta.id}`);
    if (isCooledOff) {
      const state = {
        health: { canSend: false, effectiveRateMultiplier: 0, newHealth: meta.health },
        limits: { warmupLimit: 0, effectiveDailyLimit: 0, remainingToday: 0 },
      };
      mailboxStateCache.set(meta.id, state);
      return state;
    }

    const health = await enforceMailboxHealth(meta.id);
    if (!health.canSend) {
      const state = {
        health,
        limits: { warmupLimit: 0, effectiveDailyLimit: 0, remainingToday: 0 },
      };
      mailboxStateCache.set(meta.id, state);
      return state;
    }

    const effectiveHealth = health.newHealth ?? meta.health;
    const warmupLimit = getWarmupLimit({
      dailyLimit: meta.dailyLimit,
      warmupEnabled: meta.warmupEnabled,
      createdAt: meta.createdAt,
      bounceRate: meta.bounceRate,
      complaintRate: meta.complaintRate,
      health: effectiveHealth,
    });
    const absoluteMax = Math.max(
      1,
      parseInt(process.env.SEND_ABSOLUTE_MAX_PER_MAILBOX ?? "500", 10)
    );
    const dailyLimit = Math.max(0, Math.min(absoluteMax, meta.dailyLimit));
    if (meta.dailyLimit > absoluteMax) {
      logger.warn(
        { mailboxId: meta.id, configuredLimit: meta.dailyLimit, clampedTo: absoluteMax },
        "[send.agent] Mailbox dailyLimit exceeds SEND_ABSOLUTE_MAX_PER_MAILBOX ceiling — clamped"
      );
    }
    const effectiveDailyLimit = Math.floor(warmupLimit * health.effectiveRateMultiplier);
    const effectiveSent = await effectiveCurrentSent(prisma, "SenderMailbox", meta.id);
    const remainingToday = Math.max(0, Math.min(effectiveDailyLimit, dailyLimit) - effectiveSent);
    const state = {
      health,
      limits: { warmupLimit, effectiveDailyLimit, remainingToday },
    };
    mailboxStateCache.set(meta.id, state);
    return state;
  };

  const buildActivePool = async (mailboxes: typeof poolMailboxes) => {
    const pool = [];
    for (const mb of mailboxes) {
      const state = await getMailboxState(mb);
      if (!state.health.canSend) continue;
      if (state.limits.remainingToday > 0) {
        pool.push({
          mailbox: mb,
          health: state.health,
          warmupLimit: state.limits.warmupLimit,
          effectiveDailyLimit: state.limits.effectiveDailyLimit,
          remainingToday: state.limits.remainingToday,
        });
      }
    }
    return pool;
  };

  let activePool = await buildActivePool(poolMailboxes);

  if (activePool.length === 0 && campaign.senderMailboxes.length === 0 && campaign.senderMailbox) {
    logger.warn(
      { campaignId, oldMailboxId: campaign.senderMailboxId },
      "[send.agent] Legacy campaign mailbox is blocked or has no capacity. Attempting automatic failover..."
    );

    const legacyMailbox = campaign.senderMailbox;
    const legacyState = await getMailboxState(legacyMailbox);
    const legacyHealth = legacyState.health;

    const canRotate = await tryRotateWithCooldown(campaignId);
    if (canRotate) {
      const alternativeMailboxes = await prisma.senderMailbox.findMany({
        where: {
          createdById: campaign.createdById,
          health: { notIn: ["BLOCKED"] },
          id: { not: legacyMailbox.id },
        },
      });

      alternativeMailboxes.sort((a, b) =>
        (HEALTH_PRIORITY[a.health] ?? 3) - (HEALTH_PRIORITY[b.health] ?? 3) ||
        a.currentSent - b.currentSent
      );

      let chosenFailover = null;
      for (const candidate of alternativeMailboxes) {
        const candidateState = await getMailboxState(candidate);
        if (!candidateState.health.canSend) continue;
        if (candidateState.limits.remainingToday < MIN_ROTATION_BATCH) continue;
        chosenFailover = { mailbox: candidate, health: candidateState.health, limits: candidateState.limits };
        break;
      }

      if (chosenFailover) {
        const alternativeMailbox = chosenFailover.mailbox;
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

        if (dnsCheck.valid && mailboxDnsCheck.valid) {
          await prisma.campaign.update({
            where: { id: campaignId },
            data: {
              senderMailboxId: alternativeMailbox.id,
              ...(alternativeDomain && { senderDomainId: alternativeDomain.id }),
            },
          });

          await prisma.deliverabilityEvent.create({
            data: {
              type: "MAILBOX_ROTATED",
              severity: "INFO",
              ...(alternativeDomain && { senderDomainId: alternativeDomain.id }),
              metadata: {
                reason: !legacyHealth.canSend ? "health_failover" : "capacity_rotation",
                campaignId,
                fromMailboxId: legacyMailbox.id,
                toMailboxId: alternativeMailbox.id,
              },
            },
          }).catch(() => null);

          logger.info(
            { campaignId, oldMailboxId: legacyMailbox.id, newMailboxId: alternativeMailbox.id },
            "[send.agent] Successfully failed over legacy campaign to alternative mailbox"
          );

          poolMailboxes = [alternativeMailbox];
          activePool = [{
            mailbox: alternativeMailbox,
            health: chosenFailover.health,
            warmupLimit: chosenFailover.limits.warmupLimit,
            effectiveDailyLimit: chosenFailover.limits.effectiveDailyLimit,
            remainingToday: chosenFailover.limits.remainingToday,
          }];
        }
      }
    }
  }

  if (activePool.length === 0) {
    await prisma.campaign.update({
      where: { id: campaignId },
      data: { status: "PAUSED", previousStatus: campaign.status },
    });
    logger.warn(
      { campaignId },
      "[send.agent] No healthy sender mailbox with capacity available — campaign paused"
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

  const totalCampaignCapacityToday = activePool.reduce((sum, item) => sum + item.remainingToday, 0);
  const rawBatchSize = Math.min(campaign.dailySendLimit, totalCampaignCapacityToday);

  if (rawBatchSize === 0) {
    logger.info({ campaignId }, "[send.agent] Daily limit reached, skipping batch");
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

  const suppressions = await prisma.suppression.findMany({
    where: {
      OR: [
        { userId: campaign.createdById },
        ...(campaign.orgId ? [{ orgId: campaign.orgId }] : []),
      ],
    },
    select: { email: true, domain: true },
  });

  const suppressedEmails = new Set(
    suppressions.map((s) => s.email?.toLowerCase()).filter((e): e is string => Boolean(e))
  );
  const suppressedDomains = new Set(
    suppressions.map((s) => s.domain?.toLowerCase()).filter((d): d is string => Boolean(d))
  );

  const rawCandidatePool = await prisma.outreachMessage.findMany({
    where: approvedMessageWhere,
    select: {
      id: true,
      createdAt: true,
      body: true,
      subject: true,
      isFollowUp: true,
      leadId: true,
      lead: {
        select: {
          email: true,
          firstName: true,
          companyName: true,
          website: true,
          qualificationScore: true,
          signals: {
            select: { signalType: true, confidence: true, createdAt: true },
          },
        },
      },
    },
    orderBy: { createdAt: "asc" },
    take: rawBatchSize * CANDIDATE_POOL_MULTIPLIER,
  });

  const candidatePool = rawCandidatePool.filter((msg) => {
    const leadEmail = msg.lead.email?.toLowerCase() ?? "";
    const leadDomain = leadEmail.includes("@") ? leadEmail.split("@")[1] : "";
    if (suppressedEmails.has(leadEmail) || (leadDomain && suppressedDomains.has(leadDomain))) {
      prisma.outreachMessage.update({
        where: { id: msg.id },
        data: { deliveryState: DeliveryState.SUPPRESSED, claimToken: null },
      }).catch(() => null);
      return false;
    }
    return true;
  }) as CandidatePoolItem[];

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
      parentMessage: {
        select: { externalMessageId: true },
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

  const mxCache = new Map<string, boolean>();

  let sent = 0;
  let failed = 0;
  let consecutiveHardBounces = 0;
  const sentMailboxIds = new Set<string>();

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    if (i % PAUSE_CHECK_INTERVAL === 0) {
      const latest = await prisma.campaign.findUnique({ where: { id: campaignId }, select: { status: true } });
      if (latest?.status === "PAUSED") {
        const remainingIds = messages.slice(i).map((m) => m.id);
        await prisma.outreachMessage.updateMany({
          where: { id: { in: remainingIds }, deliveryState: DeliveryState.SENDING },
          data: { deliveryState: DeliveryState.QUEUED, claimToken: null },
        });
        logger.info(
          { campaignId, requeued: remainingIds.length },
          "[send.agent] Campaign paused mid-batch — messages requeued"
        );
        return;
      }

      const circuitResult = await checkBounceCircuitBreaker(campaignId);
      if (circuitResult === "blocked") {
        const remainingIds = messages.slice(i).map((m) => m.id);
        await prisma.outreachMessage.updateMany({
          where: { id: { in: remainingIds }, deliveryState: DeliveryState.SENDING },
          data: { deliveryState: DeliveryState.QUEUED, claimToken: null },
        });
        logger.warn(
          { campaignId, requeued: remainingIds.length },
          "[send.agent] Bounce circuit breaker triggered — campaign paused, messages requeued"
        );
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

    const dedupKey = `lead:contacted-today:${campaign.createdById}:${email.toLowerCase()}`;
    const dedupLockKey = `lead:contacted-today-lock:${campaign.createdById}:${email.toLowerCase()}`;
    const dedupLockToken = `${message.id}:${randomUUID()}`;
    const acquiredDedupLock = await redis.set(dedupLockKey, dedupLockToken, "EX", 600, "NX");
    if (!acquiredDedupLock) {
      await prisma.outreachMessage.update({
        where: { id: message.id },
        data: { deliveryState: DeliveryState.QUEUED, claimToken: null, nextRetryAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      });
      continue;
    }

    const alreadyContacted = await redis.get(dedupKey);
    if (alreadyContacted) {
      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        dedupLockKey,
        dedupLockToken,
      );
      await prisma.outreachMessage.update({
        where: { id: message.id },
        data: { deliveryState: DeliveryState.QUEUED, claimToken: null, nextRetryAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
      });
      continue;
    }

    const verificationResult = await verifyEmailAddress(email ?? "");
    if (verificationResult === "INVALID") {
      await prisma.outreachMessage.update({
        where: { id: message.id },
        data: {
          deliveryState: DeliveryState.FAILED,
          lastError: "Email verification failed: INVALID",
          claimToken: null,
        },
      });
      failed++;
      continue;
    }

    const recipientDomain = email.split("@")[1]?.toLowerCase() ?? "";
    if (recipientDomain) {
      const mxExists = await hasMxRecord(recipientDomain, mxCache);
      if (!mxExists) {
        logger.warn({ messageId: message.id, email, recipientDomain }, "[send.agent] No MX record for recipient domain — marking INVALID");
        await prisma.$transaction([
          prisma.outreachMessage.update({
            where: { id: message.id },
            data: { deliveryState: DeliveryState.FAILED, lastError: "No MX record for recipient domain", claimToken: null },
          }),
          prisma.lead.update({
            where: { id: message.leadId },
            data: { emailStatus: EmailStatus.INVALID },
          }),
        ]);
        failed++;
        continue;
      }
    }

    let chosenMailbox: (typeof activePool)[0]["mailbox"] | null = null;
    let mailboxDomain: Awaited<ReturnType<typeof prisma.senderDomain.findFirst>> | null = null;
    let result: SendResult | null = null;

    const maxAttempts = Math.min(3, activePool.length);
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const availableSenders = activePool.filter((item) => item.remainingToday > 0);

      if (availableSenders.length === 0) {
        break;
      }

      const target = pickWeightedRandomMailbox(availableSenders);

      const reserved = await reserveDailyCapacity(
        prisma,
        "SenderMailbox",
        target.mailbox.id,
        1,
        target.effectiveDailyLimit
      );

      if (!reserved) {
        target.remainingToday = 0;
        continue;
      }

      target.remainingToday--;
      const activeMailbox = target.mailbox;
      chosenMailbox = activeMailbox;

      const mailboxDomainStr = activeMailbox.emailAddress.split("@")[1];
      mailboxDomain = mailboxDomainCache.get(mailboxDomainStr) ?? null;
      if (mailboxDomain === null) {
        mailboxDomain = await prisma.senderDomain.findFirst({
          where: { domain: mailboxDomainStr, createdById: campaign.createdById },
        });
        mailboxDomainCache.set(mailboxDomainStr, mailboxDomain);
      }

      const fromAddress = `${brand.senderName} <${activeMailbox.emailAddress}>`;

      let provider: ReturnType<typeof createMailProvider> | null = null;
      let providerInitError: string | null = null;

      try {
        const rawCreds = decryptMailboxCredentials<MailboxCredentials>(activeMailbox.credentials, `mailbox:${activeMailbox.id}`);
        provider = createMailProvider(rawCreds, {
          outlook: {
            mailboxId: activeMailbox.id,
            redis,
            onTokenRotation: async (newRefreshToken: string) => {
              if (rawCreds.type === "OUTLOOK" && newRefreshToken !== rawCreds.refreshToken) {
                const rotated = { ...rawCreds, refreshToken: newRefreshToken };
                await prisma.senderMailbox.update({
                  where: { id: activeMailbox.id },
                  data: { credentials: encryptJson(rotated) },
                });
              }
            },
          },
        });
      } catch (err) {
        providerInitError = err instanceof Error ? err.message : "unknown error";
      }

      const leadCtx: LeadVariableContext = {
        firstName: message.lead.firstName,
        lastName: (message.lead as { lastName?: string | null }).lastName,
        companyName: message.lead.companyName,
        website: message.lead.website,
      };

      const substitutedSubject = replaceTemplateVars(message.subject, leadCtx);
      const substitutedBody = replaceTemplateVars(message.body, leadCtx);

      const spamScore = scoreSpamRisk(substitutedSubject + " " + substitutedBody);
      if (spamScore >= 3) {
        logger.warn(
          { messageId: message.id, spamScore },
          "[send.agent] Message flagged by spam keyword scorer — skipping dispatch",
        );
        await prisma.outreachMessage.update({
          where: { id: message.id },
          data: { deliveryState: DeliveryState.QUEUED, claimToken: null, lastError: `Spam risk score ${spamScore}/20 — content needs revision` },
        });
        result = null;
        break;
      }

      const content = parseBody(substitutedBody);
      const { html, text } = renderEmailTemplate(
        brand,
        {
          subject: substitutedSubject,
          greeting: content.greeting,
          opening: content.opening,
          body: content.body,
          ctaText: content.ctaText,
          closing: content.closing,
          ctaUrl: message.lead.website ?? undefined,
          messageId: message.id,
        },
        {
          style: (campaign.templateStyle as TemplateStyle | undefined) ?? "BRANDED",
          customTrackingDomain: (mailboxDomain as { customTrackingDomain?: string | null })?.customTrackingDomain ?? undefined,
        },
      );

      const sendIntentKey = buildSendIdempotencyKey(message.leadId, message.followUpStep ?? 1, message.id);
      const sendIntentResult = await createOrRecoverSendIntent({
        operationId: `send:${campaignId}:${message.id}`,
        leadId: message.leadId,
        outreachMessageId: message.id,
        sequenceStep: message.followUpStep ?? 1,
        idempotencyKey: sendIntentKey,
        provider: chosenMailbox.providerType ?? undefined,
      });

      if (sendIntentResult.alreadyAccepted) {
        logger.warn({ messageId: message.id, sendIntentKey }, "[send.agent] Skipping duplicate send — SendIntent already ACCEPTED");
        result = null;
        break;
      }

      if (sendIntentResult.requiresReconciliation) {
        logger.warn({ messageId: message.id, sendIntentKey }, "[send.agent] Skipping send — SendIntent requires reconciliation");
        result = null;
        break;
      }

      if (providerInitError || !provider) {
        result = { success: false, error: providerInitError ?? "Provider unavailable" };
      } else {
        try {
          const parentExternalId = formatMessageIdHeader(message.parentMessage?.externalMessageId);
          const mailHeaders = buildListUnsubscribeHeaders(message.id) ?? {};

          emitCampaignEvent({
            campaignId,
            type: "lead",
            jobName: "send-batch",
            label: "Sending Emails",
            email,
            leadStatus: "sending",
            detail: `Sending to ${email}…`,
          });

          result = await provider.sendEmail({
            to: email,
            from: fromAddress,
            subject: substitutedSubject,
            html,
            text,
            ...(parentExternalId && {
              inReplyTo: parentExternalId,
              references: parentExternalId,
            }),
            headers: mailHeaders,
          });
        } catch (err) {
          result = { success: false, error: err instanceof Error ? err.message : "unknown error" };
        }
      }

      if (!result.success && isTransientMailboxError(result.error)) {
        await coolOffMailbox(activeMailbox.id);
        target.remainingToday = 0;
        mailboxStateCache.delete(activeMailbox.id);
        logger.warn(
          { campaignId, mailboxId: activeMailbox.id, error: result.error },
          "[send.agent] Transient mailbox rejection — cooling off and failing over to secondary mailbox"
        );
        chosenMailbox = null;
        continue;
      }

      break;
    }

    if (!chosenMailbox || !result) {
      if (!chosenMailbox) {
        const sendIntentKey = buildSendIdempotencyKey(message.leadId, message.followUpStep ?? 1, message.id);
        // CAS-predicated write: guards on status = 'DISPATCHING' so a concurrent reconciler
        // that already transitioned to RECONCILING/terminal is not overwritten.
        const _unknownCas = await prisma.$executeRaw`
          UPDATE "SendIntent"
          SET    "status"       = 'UNKNOWN',
                 "errorMessage" = ${"All mailbox attempts exhausted — transient failures"},
                 "updatedAt"    = NOW() AT TIME ZONE 'utc'
          WHERE  "idempotencyKey" = ${sendIntentKey}
            AND  "status"         = 'DISPATCHING'
        `.catch((): number => 0);
        if (_unknownCas === 0) {
          logger.warn({ sendIntentKey }, "[send.agent] SendIntent UNKNOWN: 0 rows updated — already settled by another actor");
        }

        const remainingIds = messages.slice(i).map((m) => m.id);
        await prisma.outreachMessage.updateMany({
          where: { id: { in: remainingIds }, deliveryState: DeliveryState.SENDING },
          data: { deliveryState: DeliveryState.QUEUED, claimToken: null },
        });
        logger.info(
          { campaignId, skipped: remainingIds.length },
          "[send.agent] Reserved capacity exhausted mid-batch — remaining messages requeued"
        );
        break;
      }
      continue;
    }

    if (result.success) {
      const sendIntentKey = buildSendIdempotencyKey(message.leadId, message.followUpStep ?? 1, message.id);
      // CAS-predicated write: guards on status = 'DISPATCHING'.
      const _acceptedCas = await prisma.$executeRaw`
        UPDATE "SendIntent"
        SET    "status"            = 'ACCEPTED',
               "providerMessageId" = ${result.externalId ?? ""},
               "updatedAt"         = NOW() AT TIME ZONE 'utc'
        WHERE  "idempotencyKey" = ${sendIntentKey}
          AND  "status"         = 'DISPATCHING'
      `.catch((err: unknown) => {
        logger.warn({ err, messageId: message.id }, "[send.agent] Failed to record SendIntent ACCEPTED");
        return 0 as number;
      });
      if (_acceptedCas === 0) {
        logger.warn({ sendIntentKey, messageId: message.id }, "[send.agent] SendIntent ACCEPTED: 0 rows updated — already settled by another actor");
      }

      await prisma.outreachMessage.update({
        where: { id: message.id },
        data: {
          deliveryState: DeliveryState.SENT,
          sentAt: new Date(),
          externalMessageId: result.externalId,
          claimToken: null,
          senderMailboxId: chosenMailbox.id,
        },
      });
      sent++;
      consecutiveHardBounces = 0;
      sentMailboxIds.add(chosenMailbox.id);

      await logLeadJourneyEvent({
        leadId: message.leadId,
        eventType: "EMAIL_SENT",
        channel: "EMAIL",
        outreachMessageId: message.id,
        metadata: { isFollowUp: message.isFollowUp, followUpStep: message.followUpStep ?? undefined },
      });

      await redis.set(dedupKey, "1", "EX", CROSS_CAMPAIGN_DEDUP_TTL);
      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        dedupLockKey,
        dedupLockToken,
      );

      emitCampaignEvent({
        campaignId,
        type: "lead",
        jobName: "send-batch",
        label: "Sending Emails",
        email,
        leadStatus: "sent",
        detail: `Sent → ${email}`,
        progress: Math.round(((i + 1) / messages.length) * 100),
      });

      await prisma.senderMailbox.update({
        where: { id: chosenMailbox.id },
        data: { totalSent: { increment: 1 } },
      });

      logAudit({
        userId: campaign.createdById,
        action: AUDIT_EVENTS.EMAIL_SENT,
        entityType: "OutreachMessage",
        entityId: message.id,
        metadata: {
          leadId: message.leadId,
          email,
          externalId: result.externalId,
          mailboxId: chosenMailbox.id,
          campaignId,
        },
      }).catch(() => { });


      if (mailboxDomain) {
        await prisma.senderDomain.update({
          where: { id: mailboxDomain.id },
          data: { totalSent: { increment: 1 } },
        }).catch(() => null);
      }

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
      const isRepBlock = failureType === "reputation_block";
      const newCount = isPermanent ? MAX_RETRIES : (message.retryCount ?? 0) + 1;

      const sendIntentKey = buildSendIdempotencyKey(message.leadId, message.followUpStep ?? 1, message.id);
      // CAS-predicated write: guards on status = 'DISPATCHING'.
      const _failedCas = await prisma.$executeRaw`
        UPDATE "SendIntent"
        SET    "status"       = 'FAILED',
               "errorMessage" = ${errorMsg},
               "updatedAt"    = NOW() AT TIME ZONE 'utc'
        WHERE  "idempotencyKey" = ${sendIntentKey}
          AND  "status"         = 'DISPATCHING'
      `.catch((err: unknown) => {
        logger.warn({ err, messageId: message.id }, "[send.agent] Failed to record SendIntent FAILED");
        return 0 as number;
      });
      if (_failedCas === 0) {
        logger.warn({ sendIntentKey, messageId: message.id }, "[send.agent] SendIntent FAILED: 0 rows updated — already settled by another actor");
      }

      if (isPermanent) {
        consecutiveHardBounces++;
        if (consecutiveHardBounces >= 3) {
          const remainingIds = messages.slice(i + 1).map((m) => m.id);
          if (remainingIds.length > 0) {
            await prisma.outreachMessage.updateMany({
              where: { id: { in: remainingIds }, deliveryState: DeliveryState.SENDING },
              data: { deliveryState: DeliveryState.QUEUED, claimToken: null },
            });
          }
          await prisma.campaign.update({
            where: { id: campaignId },
            data: { status: "PAUSED" },
          });
          logger.warn(
            { campaignId, consecutiveHardBounces },
            "[send.agent] Campaign paused by circuit breaker — 3 consecutive hard bounces",
          );
          return;
        }
      }

      emitCampaignEvent({
        campaignId,
        type: "lead",
        jobName: "send-batch",
        label: "Sending Emails",
        email,
        leadStatus: "failed",
        detail: `Failed → ${email}: ${errorMsg.slice(0, 80)}`,
      });

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
          senderMailboxId: chosenMailbox.id,
        },
      });
      failed++;

      await prisma.senderMailbox.update({
        where: { id: chosenMailbox.id },
        data: { currentSent: { decrement: 1 } },
      });

      const cachedState = mailboxStateCache.get(chosenMailbox.id);
      if (cachedState) cachedState.limits.remainingToday++;

      if (mailboxDomain) {
        await prisma.senderDomain.update({
          where: { id: mailboxDomain.id },
          data: { currentSent: { decrement: 1 } },
        }).catch(() => null);
      }

      await redis.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        dedupLockKey,
        dedupLockToken,
      );
    }

    if (i < messages.length - 1) {
      await sleep(jitterMs());
    }
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
      totalCampaignCapacityToday,
      rawBatchSize,
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