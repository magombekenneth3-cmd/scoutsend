import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  DELIVERABILITY_EVENT_TYPES,
  DOMAIN_HEALTH_THRESHOLDS,
  DeliverabilityEventType,
} from "../../lib/constants";
import { logger } from "../../lib/logger";
import {
  ingestDeliverabilityEventSchema,
  getDeliverabilityEventsQuerySchema,
} from "./deliverbility.schema";
import { redis } from "../../lib/ioredis";

function mapSeverity(severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"): "INFO" | "WARNING" | "CRITICAL" {
  switch (severity) {
    case "LOW": return "INFO";
    case "MEDIUM":
    case "HIGH": return "WARNING";
    case "CRITICAL": return "CRITICAL";
  }
}

const RECALC_LOCK_TTL_MS = 30_000;

async function coalesceRecalc(key: string, fn: () => Promise<void>): Promise<void> {
  const lockKey = `recalc:lock:${key}`;
  let acquired: string | null = null;
  try {
    acquired = await redis.set(lockKey, "1", "PX", RECALC_LOCK_TTL_MS, "NX");
  } catch (err) {
    logger.error({ err, key }, "Redis lock acquisition error");
  }

  if (!acquired) {
    try {
      await redis.set(`recalc:pending:${key}`, "1", "PX", RECALC_LOCK_TTL_MS * 2);
    } catch (err) {
      logger.error({ err, key }, "Redis pending status write error");
    }
    return;
  }

  try {
    await fn();
  } catch (err) {
    logger.error({ err, key }, "Recalculation execution error");
  } finally {
    let hasPending = null;
    try {
      await redis.del(lockKey);
      hasPending = await redis.get(`recalc:pending:${key}`);
      if (hasPending) {
        await redis.del(`recalc:pending:${key}`);
      }
    } catch (err) {
      logger.error({ err, key }, "Redis cleanup error");
    }
    if (hasPending) {
      coalesceRecalc(key, fn).catch((err) => {
        logger.error({ err, key }, "Error in deferred calculation retry");
      });
    }
  }
}

const VALID_TRANSITIONS: Readonly<Record<string, readonly string[]>> = {
  DRAFT: ["QUEUED", "SENT", "DELIVERED", "OPENED", "BOUNCED", "FAILED"],
  QUEUED: ["SENT", "DELIVERED", "OPENED", "BOUNCED", "FAILED"],
  SENT: ["DELIVERED", "OPENED", "BOUNCED", "FAILED", "SPAM"],
  DELIVERED: ["OPENED", "REPLIED", "BOUNCED", "SPAM"],
  OPENED: ["REPLIED", "SPAM"],
  REPLIED: [],
  BOUNCED: [],
  FAILED: [],
  SPAM: [],
};

function canTransition(from: string, to: string): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

async function recalculateDomainHealth(senderDomainId: string): Promise<void> {
  await coalesceRecalc(`domain:${senderDomainId}`, async () => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [bounceCount, complaintCount, sentLast30Days] = await Promise.all([
      prisma.deliverabilityEvent.count({
        where: {
          senderDomainId,
          type: {
            in: [
              DELIVERABILITY_EVENT_TYPES.BOUNCE,
              DELIVERABILITY_EVENT_TYPES.HARD_BOUNCE,
              DELIVERABILITY_EVENT_TYPES.SOFT_BOUNCE,
            ],
          },
          createdAt: { gte: since },
        },
      }),
      prisma.deliverabilityEvent.count({
        where: {
          senderDomainId,
          type: DELIVERABILITY_EVENT_TYPES.SPAM_COMPLAINT,
          createdAt: { gte: since },
        },
      }),
      prisma.outreachMessage.count({
        where: {
          lead: {
            campaign: { senderDomainId },
          },
          deliveryState: { notIn: ["DRAFT", "QUEUED"] },
          createdAt: { gte: since },
        },
      }),
    ]);

    if (sentLast30Days === 0) return;

    const bounceRate = bounceCount / sentLast30Days;
    const complaintRate = complaintCount / sentLast30Days;
    const T = DOMAIN_HEALTH_THRESHOLDS;

    let health: "HEALTHY" | "WARNING" | "DEGRADED" | "BLOCKED" = "HEALTHY";

    if (bounceRate >= T.BOUNCE_RATE_BLOCKED || complaintRate >= T.COMPLAINT_RATE_BLOCKED) {
      health = "BLOCKED";
    } else if (bounceRate >= T.BOUNCE_RATE_DEGRADED || complaintRate >= T.COMPLAINT_RATE_DEGRADED) {
      health = "DEGRADED";
    } else if (bounceRate >= T.BOUNCE_RATE_WARNING || complaintRate >= T.COMPLAINT_RATE_WARNING) {
      health = "WARNING";
    }

    await prisma.senderDomain.update({
      where: { id: senderDomainId },
      data: { bounceRate, complaintRate, health },
    });

    if (health === "BLOCKED") {
      await prisma.campaign.updateMany({
        where: {
          senderDomainId,
          status: { in: ["QUEUED", "SENDING"] },
        },
        data: { status: "PAUSED" },
      });

      logger.warn(
        { senderDomainId, bounceRate, complaintRate },
        "[deliverability] Domain BLOCKED — active campaigns paused"
      );
    }
  });
}

async function recalculateMailboxHealth(senderMailboxId: string): Promise<void> {
  await coalesceRecalc(`mailbox:${senderMailboxId}`, async () => {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const [bounceCount, complaintCount, sentLast30Days] = await Promise.all([
      prisma.deliverabilityEvent.count({
        where: {
          senderMailboxId,
          type: {
            in: [
              DELIVERABILITY_EVENT_TYPES.BOUNCE,
              DELIVERABILITY_EVENT_TYPES.HARD_BOUNCE,
              DELIVERABILITY_EVENT_TYPES.SOFT_BOUNCE,
            ],
          },
          createdAt: { gte: since },
        },
      }),
      prisma.deliverabilityEvent.count({
        where: {
          senderMailboxId,
          type: DELIVERABILITY_EVENT_TYPES.SPAM_COMPLAINT,
          createdAt: { gte: since },
        },
      }),
      prisma.outreachMessage.count({
        where: {
          lead: {
            campaign: { senderMailboxId },
          },
          deliveryState: { notIn: ["DRAFT", "QUEUED"] },
          createdAt: { gte: since },
        },
      }),
    ]);

    if (sentLast30Days === 0) return;

    const bounceRate = bounceCount / sentLast30Days;
    const complaintRate = complaintCount / sentLast30Days;
    const T = DOMAIN_HEALTH_THRESHOLDS;

    let health: "HEALTHY" | "WARNING" | "DEGRADED" | "BLOCKED" = "HEALTHY";

    if (bounceRate >= T.BOUNCE_RATE_BLOCKED || complaintRate >= T.COMPLAINT_RATE_BLOCKED) {
      health = "BLOCKED";
    } else if (bounceRate >= T.BOUNCE_RATE_DEGRADED || complaintRate >= T.COMPLAINT_RATE_DEGRADED) {
      health = "DEGRADED";
    } else if (bounceRate >= T.BOUNCE_RATE_WARNING || complaintRate >= T.COMPLAINT_RATE_WARNING) {
      health = "WARNING";
    }

    await prisma.senderMailbox.update({
      where: { id: senderMailboxId },
      data: { bounceRate, complaintRate, health },
    });

    logger.debug(
      { senderMailboxId, bounceRate, complaintRate, health },
      "[deliverability] Mailbox health recalculated"
    );
  });
}

async function autoSuppressIfNeeded(
  eventType: DeliverabilityEventType,
  metadata: Record<string, unknown>
): Promise<void> {
  const shouldSuppress =
    eventType === DELIVERABILITY_EVENT_TYPES.HARD_BOUNCE ||
    eventType === DELIVERABILITY_EVENT_TYPES.SPAM_COMPLAINT;

  if (!shouldSuppress) return;

  const email = metadata?.email as string | undefined;
  if (!email) return;

  let userId = metadata?.userId as string | undefined;

  if (!userId) {
    const campaignId = metadata?.campaignId as string | undefined;
    if (campaignId) {
      const c = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { createdById: true },
      });
      userId = c?.createdById;
    }
  }

  if (!userId) {
    logger.warn({ email, eventType }, "[deliverability] Cannot auto-suppress — no resolvable userId");
    return;
  }

  const existing = await prisma.suppression.findFirst({ where: { email, userId } });
  if (existing) return;

  await prisma.suppression.create({
    data: {
      email,
      reason:
        eventType === DELIVERABILITY_EVENT_TYPES.HARD_BOUNCE
          ? "Hard bounce — invalid address"
          : "Spam complaint",
      source: "deliverability-auto",
      userId,
    },
  });

  logger.info({ email, eventType }, "[deliverability] Auto-suppressed");
}

async function updateMessageDeliveryState(
  eventType: string,
  metadata: Record<string, unknown>
): Promise<void> {
  const externalMessageId = metadata?.email_id as string | undefined;
  if (!externalMessageId) return;

  const stateMap: Record<string, { state: string; timestamp?: string }> = {
    "email.delivered": { state: "DELIVERED" },
    "email.opened": { state: "OPENED", timestamp: "openedAt" },
    "email.bounced": { state: "BOUNCED" },
    "email.complained": { state: "SPAM" },
    HARD_BOUNCE: { state: "BOUNCED" },
    SOFT_BOUNCE: { state: "BOUNCED" },
    BOUNCE: { state: "BOUNCED" },
    SPAM_COMPLAINT: { state: "SPAM" },
    DELIVERY_FAILURE: { state: "FAILED" },
  };

  const mapped = stateMap[eventType];
  if (!mapped) return;

  const campaignId = metadata?.campaignId as string | undefined;

  const message = await prisma.outreachMessage.findFirst({
    where: {
      externalMessageId,
      ...(campaignId && { lead: { campaignId } }),
    },
    select: { id: true, deliveryState: true },
  });

  if (!message) return;

  if (!canTransition(message.deliveryState, mapped.state)) return;

  await prisma.outreachMessage.update({
    where: { id: message.id },
    data: {
      deliveryState: mapped.state as any,
      ...(mapped.timestamp === "openedAt" && { openedAt: new Date() }),
    },
  });

  logger.info(
    { messageId: message.id, from: message.deliveryState, to: mapped.state },
    "[deliverability] Message state updated"
  );
}

export async function ingestDeliverabilityEvent(
  data: z.infer<typeof ingestDeliverabilityEventSchema>
) {
  const event = await prisma.deliverabilityEvent.create({
    data: {
      type: data.type,
      severity: mapSeverity(data.severity),
      campaignId: data.campaignId,
      senderDomainId: data.senderDomainId,
      senderMailboxId: data.senderMailboxId,
      metadata: (data.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
    },
  });

  await Promise.allSettled([
    data.senderDomainId
      ? recalculateDomainHealth(data.senderDomainId)
      : Promise.resolve(),
    data.senderMailboxId
      ? recalculateMailboxHealth(data.senderMailboxId)
      : Promise.resolve(),
    autoSuppressIfNeeded(
      data.type as DeliverabilityEventType,
      (data.metadata ?? {}) as Record<string, unknown>
    ),
    updateMessageDeliveryState(
      data.type,
      (data.metadata ?? {}) as Record<string, unknown>
    ),
  ]);

  try {
    await redis.del("deliverability:stats");
  } catch (err) {
    logger.error({ err }, "Redis invalidation error");
  }

  return event;
}

export async function getDeliverabilityEvents(
  query: z.infer<typeof getDeliverabilityEventsQuerySchema>,
  userId: string
) {
  const { type, severity, campaignId, senderDomainId, from, to, page, limit } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.DeliverabilityEventWhereInput = {
    campaign: { createdById: userId },
    ...(type && { type }),
    ...(severity && { severity: mapSeverity(severity) }),
    ...(campaignId && { campaignId }),
    ...(senderDomainId && { senderDomainId }),
    ...((from || to) && {
      createdAt: {
        ...(from && { gte: from }),
        ...(to && { lte: to }),
      },
    }),
  };

  const [events, total] = await prisma.$transaction([
    prisma.deliverabilityEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      include: {
        campaign: { select: { id: true, name: true } },
        senderDomain: { select: { id: true, domain: true, health: true } },
      },
    }),
    prisma.deliverabilityEvent.count({ where }),
  ]);

  return {
    data: events,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

export async function getCampaignDeliverabilityStats(campaignId: string, userId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, createdById: userId, deletedAt: null },
    select: { id: true },
  });
  if (!campaign) return null;

  const [stateGroups, complaintCount] = await Promise.all([
    prisma.outreachMessage.groupBy({
      by: ["deliveryState"],
      where: {
        deliveryState: { notIn: ["DRAFT", "QUEUED"] },
        lead: { campaignId, deletedAt: null },
      },
      _count: { id: true },
    }),
    prisma.deliverabilityEvent.count({
      where: {
        campaignId,
        type: { in: ["SPAM_COMPLAINT"] },
      },
    }),
  ]);

  const d = new Map(stateGroups.map((r) => [r.deliveryState as string, r._count.id]));

  const bounces    = d.get("BOUNCED") ?? 0;
  const delivered  = (d.get("DELIVERED") ?? 0) + (d.get("OPENED") ?? 0) + (d.get("REPLIED") ?? 0);
  const opens      = (d.get("OPENED") ?? 0) + (d.get("REPLIED") ?? 0);
  const emailsSent = (d.get("SENT") ?? 0) + (d.get("SENDING") ?? 0) + delivered + bounces + (d.get("SPAM") ?? 0);

  return {
    emailsSent,
    delivered,
    opens,
    bounces,
    complaintCount,
    deliveryRate: emailsSent > 0 ? (delivered / emailsSent) * 100 : 0,
    openRate:     delivered > 0  ? (opens / delivered) * 100 : 0,
    bounceRate:   emailsSent > 0 ? (bounces / emailsSent) * 100 : 0,
  };
}

export async function getDeliverabilityStats(userId: string) {
  const cacheKey = `deliverability:stats:${userId}`;
  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    logger.error({ err }, "Redis read error");
  }

  const campaignFilter = { campaign: { createdById: userId } };

  const [byType, bySeverity, domainHealthSummary, recentCritical] =
    await Promise.all([
      prisma.deliverabilityEvent.groupBy({
        by: ["type"],
        where: campaignFilter,
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
      }),
      prisma.deliverabilityEvent.groupBy({
        by: ["severity"],
        where: campaignFilter,
        _count: { id: true },
      }),
      prisma.senderDomain.groupBy({
        by: ["health"],
        where: { campaigns: { some: { createdById: userId } } },
        _count: { id: true },
      }),
      prisma.deliverabilityEvent.findMany({
        where: {
          ...campaignFilter,
          severity: "CRITICAL",
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          senderDomain: { select: { domain: true, health: true } },
          campaign: { select: { id: true, name: true } },
        },
      }),
    ]);

  const stats = { byType, bySeverity, domainHealthSummary, recentCritical };

  try {
    await redis.set(cacheKey, JSON.stringify(stats), "EX", 60);
  } catch (err) {
    logger.error({ err }, "Redis write error");
  }

  return stats;
}