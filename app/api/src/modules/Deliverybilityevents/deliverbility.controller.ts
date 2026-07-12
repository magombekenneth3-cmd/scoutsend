import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { DeliveryState, Prisma } from "@prisma/client";
import { logger } from "../../lib/logger";
import { getDeliverabilityEventsQuerySchema, ingestDeliverabilityEventSchema } from "./deliverbility.schema";
import { getDeliverabilityEvents, getDeliverabilityStats, ingestDeliverabilityEvent, getCampaignDeliverabilityStats } from "./deliverbility.service";
import { AuthenticatedRequest } from "../auth/auth.types";

export interface ProviderDeliveryEvent {
  externalMessageId: string;
  event: "delivered" | "bounced" | "complained" | "opened";
  recipientEmail?: string;
  timestamp?: string;
}

function verifyWebhookSecret(req: Request): boolean {
  const expected = process.env.WEBHOOK_SECRET;
  if (!expected) return false;
  const raw = req.headers["x-webhook-secret"];
  const incoming = Array.isArray(raw) ? raw[0] : (raw ?? "");
  if (incoming.length === 0) return false;
  const a = Buffer.from(incoming.padEnd(Math.max(incoming.length, expected.length), "\0"));
  const b = Buffer.from(expected.padEnd(Math.max(incoming.length, expected.length), "\0"));
  return a.length === b.length && timingSafeEqual(a, b);
}

const EVENT_STATE_MAP: Record<ProviderDeliveryEvent["event"], DeliveryState> = {
  delivered: "DELIVERED",
  bounced: "BOUNCED",
  complained: "SPAM",
  opened: "OPENED",
};

const TERMINAL_STATES: DeliveryState[] = ["BOUNCED", "SPAM", "REPLIED"];

export async function handleProviderDeliveryEvent(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!verifyWebhookSecret(req)) {
      res.status(401).end();
      return;
    }

    const payload = req.body as ProviderDeliveryEvent;

    if (!payload?.externalMessageId || !payload?.event) {
      res.status(400).json({ error: "Missing externalMessageId or event" });
      return;
    }

    const newState = EVENT_STATE_MAP[payload.event];
    if (!newState) {
      res.status(400).json({ error: `Unknown event type: ${payload.event}` });
      return;
    }

    const eventTime = payload.timestamp ? new Date(payload.timestamp) : new Date();

    const updated = await prisma.outreachMessage.updateMany({
      where: {
        externalMessageId: payload.externalMessageId,
        deliveryState: { notIn: TERMINAL_STATES },
      },
      data: {
        deliveryState: newState,
        ...(newState === "OPENED" ? { openedAt: eventTime } : {}),
        ...(newState === "DELIVERED" ? { deliveredAt: eventTime } : {}),
      },
    });

    if (updated.count === 0) {
      logger.warn(
        { externalMessageId: payload.externalMessageId, event: payload.event },
        "[delivery-webhook] No matching outreach message found (or already terminal)"
      );
      res.status(200).end();
      return;
    }

    if (
      (newState === "BOUNCED" || newState === "SPAM") &&
      payload.recipientEmail
    ) {
      // Look up the campaign owner so the suppression is scoped to that
      // tenant only — not broadcast to every user on the platform.
      const ownerMsg = await prisma.outreachMessage.findFirst({
        where: { externalMessageId: payload.externalMessageId },
        select: {
          lead: {
            select: {
              campaign: { select: { createdById: true } },
            },
          },
        },
      });
      const ownerId = ownerMsg?.lead?.campaign?.createdById;

      if (ownerId) {
        await prisma.suppression.upsert({
          where: {
            email_userId: { email: payload.recipientEmail, userId: ownerId },
          },
          create: {
            email: payload.recipientEmail,
            reason: payload.event,
            source: "delivery-webhook",
            userId: ownerId,
          },
          update: {},
        });
      }

      const [mailboxResult, domainResult] = await Promise.all([
        updateMailboxDeliverabilityMetrics(payload.externalMessageId, newState),
        updateDomainDeliverabilityMetrics(payload.externalMessageId, newState),
      ]);

      logger.info(
        {
          externalMessageId: payload.externalMessageId,
          event: payload.event,
          recipientEmail: payload.recipientEmail,
          mailboxUpdated: mailboxResult,
          domainUpdated: domainResult,
        },
        "[delivery-webhook] Bounce/complaint processed"
      );
    }

    res.status(200).end();
  } catch (err) {
    next(err);
  }
}

async function updateMailboxDeliverabilityMetrics(
  externalMessageId: string,
  state: "BOUNCED" | "SPAM"
): Promise<boolean> {
  const message = await prisma.outreachMessage.findFirst({
    where: { externalMessageId },
    select: {
      lead: {
        select: {
          campaign: {
            select: {
              senderMailbox: {
                select: { id: true },
              },
            },
          },
        },
      },
    },
  });

  const mailboxId = message?.lead?.campaign?.senderMailbox?.id;
  if (!mailboxId) return false;

  await prisma.$transaction(async (tx) => {
    const mailbox = await tx.senderMailbox.findUnique({
      where: { id: mailboxId },
      select: { totalSent: true },
    });

    if (!mailbox || mailbox.totalSent === 0) return;

    const total = mailbox.totalSent;
    const rateField = state === "BOUNCED" ? "bounceRate" : "complaintRate";

    await tx.$executeRaw`
            UPDATE "SenderMailbox"
            SET ${Prisma.raw(`"${rateField}"`)} = (FLOOR(${Prisma.raw(`"${rateField}"`)} * ${total}) + 1.0) / ${total}
            WHERE id = ${mailboxId}
        `;
  });

  return true;
}

async function updateDomainDeliverabilityMetrics(
  externalMessageId: string,
  state: "BOUNCED" | "SPAM"
): Promise<boolean> {
  const message = await prisma.outreachMessage.findFirst({
    where: { externalMessageId },
    select: {
      lead: {
        select: {
          campaign: {
            select: {
              senderDomain: {
                select: { id: true },
              },
            },
          },
        },
      },
    },
  });

  const domainId = message?.lead?.campaign?.senderDomain?.id;
  if (!domainId) return false;


  await prisma.$transaction(async (tx) => {
    const domain = await tx.senderDomain.findUnique({
      where: { id: domainId },
      select: { totalSent: true },
    });

    if (!domain || domain.totalSent === 0) return;

    const total = domain.totalSent;
    const rateField = state === "BOUNCED" ? "bounceRate" : "complaintRate";

    await tx.$executeRaw`
            UPDATE "SenderDomain"
            SET ${Prisma.raw(`"${rateField}"`)} = (FLOOR(${Prisma.raw(`"${rateField}"`)} * ${total}) + 1.0) / ${total}
            WHERE id = ${domainId}
        `;
  });

  return true;
}



export async function ingestDeliverabilityEventHandler(
  req: Request, res: Response, next: NextFunction
): Promise<void> {
  try {
    if (!verifyWebhookSecret(req)) {
      res.status(401).end();
      return;
    }
    const data = ingestDeliverabilityEventSchema.parse(req.body);
    const event = await ingestDeliverabilityEvent(data);
    res.status(201).json(event);
  } catch (err) { next(err); }
}

export async function getDeliverabilityEventsHandler(
  req: AuthenticatedRequest, res: Response, next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.userId;
    const query = getDeliverabilityEventsQuerySchema.parse(req.query);
    const result = await getDeliverabilityEvents(query, userId);
    res.status(200).json(result);
  } catch (err) { next(err); }
}

export async function getDeliverabilityStatsHandler(
  req: AuthenticatedRequest, res: Response, next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.userId;
    const result = await getDeliverabilityStats(userId);
    res.status(200).json(result);
  } catch (err) { next(err); }
}

export async function getCampaignDeliverabilityStatsHandler(
  req: AuthenticatedRequest, res: Response, next: NextFunction
): Promise<void> {
  try {
    const userId = req.user!.userId;
    const campaignId = req.query.campaignId as string | undefined;
    if (!campaignId) {
      res.status(400).json({ error: "campaignId is required" });
      return;
    }
    const result = await getCampaignDeliverabilityStats(campaignId, userId);
    if (!result) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    res.status(200).json(result);
  } catch (err) { next(err); }
}