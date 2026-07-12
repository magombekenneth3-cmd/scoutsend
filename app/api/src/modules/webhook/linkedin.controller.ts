import { Request, Response, NextFunction } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";


function verifyUnipileSignature(req: Request): boolean {
  const secret = process.env.UNIPILE_WEBHOOK_SECRET;
  if (!secret) return false;

  const raw = req.headers["x-unipile-signature"];
  const incoming = Array.isArray(raw) ? raw[0] : (raw ?? "");
  if (!incoming) return false;

  if (incoming.startsWith("sha256=")) {
    const rawBody: Buffer | undefined = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      logger.warn("[linkedin-webhook] rawBody unavailable — cannot verify HMAC signature");
      return false;
    }
    const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
    const a = Buffer.from(incoming.padEnd(expected.length));
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  const a = Buffer.from(incoming);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function handleLinkedInWebhook(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!verifyUnipileSignature(req)) {
      res.status(401).end();
      return;
    }

    const { event, provider_ref, account_id } = req.body as {
      event: string;
      provider_ref?: string;
      account_id?: string;
    };

    if (!provider_ref) {
      res.status(200).json({ ok: true, skipped: "no provider_ref" });
      return;
    }

    if (event === "connection_accepted") {
      await prisma.linkedInActivity.updateMany({
        where: { providerRef: provider_ref, status: "SENT" },
        data: { status: "ACCEPTED", acceptedAt: new Date() },
      });
      logger.info({ provider_ref }, "[linkedin-webhook] connection_accepted");


      const activity = await prisma.linkedInActivity.findFirst({
        where: { providerRef: provider_ref },
        select: { leadId: true },
      });

      if (activity?.leadId) {
        const leadId = activity.leadId;

        const lead = await prisma.lead.findUnique({
          where: { id: leadId },
          select: { campaignId: true },
        });

        if (lead?.campaignId) {
          const onAcceptSteps = await prisma.sequenceStep.findMany({
            where: {
              campaignId: lead.campaignId,
              trigger: "ON_CONNECT_ACCEPT",
            },
            select: { id: true, stepIndex: true, delayDays: true },
          });

          for (const step of onAcceptSteps) {
            const scheduledAt = new Date(
              Date.now() + step.delayDays * 24 * 60 * 60_000,
            );
            await prisma.leadStepStatus.upsert({
              where: { stepId_leadId: { stepId: step.id, leadId } },
              create: { stepId: step.id, leadId, status: "SCHEDULED", scheduledAt },
              update: { status: "SCHEDULED", scheduledAt },
            });
            logger.info(
              { leadId, stepId: step.id, stepIndex: step.stepIndex, scheduledAt },
              "[linkedin-webhook] ON_CONNECT_ACCEPT step scheduled",
            );
          }


          const fallbackSteps = await prisma.sequenceStep.findMany({
            where: {
              campaignId: lead.campaignId,
              trigger: "ON_NO_ACCEPT",
              channel: "EMAIL",
            },
            select: { id: true },
          });

          for (const step of fallbackSteps) {
            const cancelled = await prisma.leadStepStatus.updateMany({
              where: {
                stepId: step.id,
                leadId,
                status: { in: ["PENDING", "SCHEDULED"] },
              },
              data: {
                status: "SKIPPED",
                errorMsg: "Connection accepted — fallback email cancelled",
              },
            });

            if (cancelled.count > 0) {
              logger.info(
                { leadId, stepId: step.id },
                "[linkedin-webhook] ON_NO_ACCEPT fallback cancelled (connection accepted)",
              );
            }
          }
        }
      }
    } else if (event === "message_replied") {
      await prisma.linkedInActivity.updateMany({
        where: { providerRef: provider_ref },
        data: { status: "REPLIED", repliedAt: new Date() },
      });
      logger.info({ provider_ref }, "[linkedin-webhook] message_replied");
    } else {
      logger.debug({ event, provider_ref }, "[linkedin-webhook] unhandled event type");
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    next(err);
  }
}