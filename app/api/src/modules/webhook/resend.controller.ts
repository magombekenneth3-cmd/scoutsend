import { Webhook } from "svix";
import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { DeliveryState } from "@prisma/client";
import { logger } from "../../lib/logger";

export async function handleResendWebhook(req: Request, res: Response): Promise<void> {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

  if (!webhookSecret) {
    logger.error("[resend-webhook] RESEND_WEBHOOK_SECRET is not set");
    res.status(500).end();
    return;
  }

  const svixId = req.headers["svix-id"] as string | undefined;
  const svixTimestamp = req.headers["svix-timestamp"] as string | undefined;
  const svixSignature = req.headers["svix-signature"] as string | undefined;

  if (!svixId || !svixTimestamp || !svixSignature) {
    res.status(401).end();
    return;
  }

  let event: { type: string; data: { email_id?: string; to?: string } };

  try {
    const wh = new Webhook(webhookSecret);
    event = wh.verify(req.body as Buffer, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    }) as typeof event;
  } catch (err) {
    logger.warn({ err }, "[resend-webhook] Signature verification failed");
    res.status(401).end();
    return;
  }

  const stateMap: Record<string, DeliveryState> = {
    "email.delivered": "DELIVERED",
    "email.bounced": "BOUNCED",
    "email.complained": "SPAM",
    "email.opened": "OPENED",
  };

  const newState = stateMap[event.type];

  if (!newState || !event.data?.email_id) {
    res.status(200).end();
    return;
  }

  await prisma.outreachMessage.updateMany({
    where: { externalMessageId: event.data.email_id },
    data: {
      deliveryState: newState,
      ...(newState === "OPENED" ? { openedAt: new Date() } : {}),
      ...(newState === "DELIVERED" ? { sentAt: new Date() } : {}),
    },
  });

  if (["BOUNCED", "SPAM"].includes(newState) && event.data.to) {
    const msg = await prisma.outreachMessage.findFirst({
      where: { externalMessageId: event.data.email_id },
      select: { lead: { select: { campaign: { select: { createdById: true } } } } },
    });
    const userId = msg?.lead?.campaign?.createdById;
    if (userId) {
      await prisma.suppression.upsert({
        where: { email_userId: { email: event.data.to, userId } },
        create: { email: event.data.to, reason: event.type, source: "resend-webhook", userId },
        update: {},
      });
    }
  }

  res.status(200).end();
}
