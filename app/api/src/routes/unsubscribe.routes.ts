import { Router, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";
import { verifyHmacSignature } from "../lib/webhook-auth";
import { transitionState } from "../lib/state/transition-state";

export const unsubscribeRouter = Router();

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) throw new Error("[unsubscribe.routes] WEBHOOK_SECRET env var is not set");

const oneClickLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Too many requests" },
    skipSuccessfulRequests: false,
});

unsubscribeRouter.post("/one-click", oneClickLimiter, async (req: Request, res: Response) => {
  try {
    const messageId = (req.query.messageId ?? req.body.messageId) as string | undefined;
    const token = (req.query.token ?? req.body.token) as string | undefined;

    if (!messageId) {
      return res.status(400).json({ error: "Missing messageId" });
    }

    if (!token || !verifyHmacSignature(messageId, token, WEBHOOK_SECRET!)) {
      logger.warn(
        { messageId, tokenHead: token?.slice(0, 8) },
        "[unsubscribe.routes] one-click: invalid or missing token",
      );
      return res.status(200).send("ok");
    }

    const message = await prisma.outreachMessage.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        deliveryState: true,
        version: true,
        lead: {
          select: {
            id: true,
            email: true,
            leadState: true,
            version: true,
            campaign: { select: { createdById: true, orgId: true } },
          },
        },
      },
    });

    if (!message || !message.lead.email || !message.lead.campaign?.createdById) {
      return res.status(404).json({ error: "Invalid message record" });
    }

    const email = message.lead.email;
    const userId = message.lead.campaign.createdById;
    const orgId = message.lead.campaign.orgId ?? "org_default";

    await prisma.$transaction(async (tx) => {
      if (orgId) {
        const existing = await tx.suppression.findFirst({ where: { email, orgId } });
        if (!existing) {
          await tx.suppression.create({
            data: {
              email,
              reason: "RFC 8058 One-Click Unsubscribe",
              source: "one-click-unsubscribe",
              orgId,
              userId,
            },
          });
        }
      }

      // 1. Transition OutreachMessage -> SUPPRESSED
      const msgTransition = await transitionState(tx, {
        model: "OutreachMessage",
        entityId: message.id,
        expectedState: message.deliveryState,
        expectedVersion: message.version,
        nextState: "SUPPRESSED",
        authority: {
          actorType: "USER",
          actorId: "one-click-unsubscribe",
        },
      });

      // 2. Transition Lead -> UNSUBSCRIBED
      const leadTransition = await transitionState(tx, {
        model: "Lead",
        entityId: message.lead.id,
        expectedState: message.lead.leadState,
        expectedVersion: message.lead.version,
        nextState: "UNSUBSCRIBED",
        authority: {
          actorType: "USER",
          actorId: "one-click-unsubscribe",
        },
      });

      // 3. Emit OutboxEvent for Lead Unsubscribe
      await tx.outboxEvent.create({
        data: {
          organizationId: orgId,
          aggregateType: "Lead",
          aggregateId: message.lead.id,
          aggregateVersion: leadTransition.newVersion,
          eventType: "LEAD_UNSUBSCRIBED",
          payload: {
            leadId: message.lead.id,
            email,
            source: "one-click-unsubscribe",
          },
          operationId: `unsub:${message.id}`,
          idempotencyKey: `unsub:${message.id}:${message.lead.id}`,
        },
      });
    });

    logger.info({ email, userId, orgId, messageId }, "[unsubscribe] RFC 8058 one-click unsubscribe processed");
    return res.status(200).send("Unsubscribed successfully");
  } catch (err) {
    logger.error({ err }, "[unsubscribe] Error processing one-click unsubscribe");
    const correlationId = res.getHeader("X-Correlation-ID") as string | undefined;
    return res.status(500).json({
      error: "Internal server error",
      ...(correlationId ? { correlationId } : {}),
    });
  }
});
