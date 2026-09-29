import { Request, Response } from "express";
import { timingSafeEqual } from "crypto";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { logLeadJourneyEvent } from "../../lib/leads/lead-journey.service";
import {
  generateOpenToken,
  generateClickSignature,
  isRedirectableUrl,
  buildOpenTrackingPixelUrl,
  buildClickTrackingUrl,
} from "../../lib/emailTracking";

export { buildOpenTrackingPixelUrl, buildClickTrackingUrl };

const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

function safeTimingEqualHex(value: string, expected: string): boolean {
  if (!/^[0-9a-fA-F]+$/.test(value) || !/^[0-9a-fA-F]+$/.test(expected)) {
    return false;
  }

  const valueBuffer = Buffer.from(value, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");

  if (valueBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(valueBuffer, expectedBuffer);
}

export async function handleOpenTrackingPixel(
  req: Request,
  res: Response
): Promise<void> {
  res.set({
    "Content-Type": "image/gif",
    "Content-Length": String(TRANSPARENT_GIF.length),
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    Pragma: "no-cache",
    Expires: "0",
  });
  res.status(200).end(TRANSPARENT_GIF);

  const token = req.params.token as string;
  const rawMid = req.query.mid;
  const messageId = typeof rawMid === "string" ? rawMid : undefined;

  if (!messageId || !token || token.length !== 64) {
    return;
  }

  const expected = generateOpenToken(messageId);

  if (!safeTimingEqualHex(token, expected)) {
    logger.warn({ messageId }, "[tracking] Invalid open pixel token");
    return;
  }

  try {
    const updated = await prisma.outreachMessage.updateMany({
      where: {
        id: messageId,
        deliveryState: {
          in: ["SENT", "DELIVERED"],
        },
      },
      data: {
        deliveryState: "OPENED",
        openedAt: new Date(),
      },
    });

    if (updated.count === 0) {
      return;
    }

    logger.info({ messageId }, "[tracking] Email open recorded");

    const message = await prisma.outreachMessage.findUnique({
      where: {
        id: messageId,
      },
      select: {
        leadId: true,
      },
    });

    if (!message) {
      return;
    }

    await logLeadJourneyEvent({
      leadId: message.leadId,
      eventType: "EMAIL_OPENED",
      channel: "EMAIL",
      outreachMessageId: messageId,
    });
  } catch (err) {
    logger.error(
      { err, messageId },
      "[tracking] Failed to record email open"
    );
  }
}

interface ClickTokenPayload {
  url?: unknown;
  mid?: unknown;
  sig?: unknown;
}

export async function handleClickTrackingRedirect(
  req: Request,
  res: Response
): Promise<void> {
  const rawToken = req.params.token as string;
  const fallbackUrl = process.env.APP_URL ?? "/";

  let decoded: ClickTokenPayload | null = null;

  try {
    decoded = JSON.parse(
      Buffer.from(rawToken, "base64url").toString("utf8")
    );
  } catch {
    decoded = null;
  }

  const url =
    typeof decoded?.url === "string" ? decoded.url : undefined;
  const messageId =
    typeof decoded?.mid === "string" ? decoded.mid : undefined;
  const sig =
    typeof decoded?.sig === "string" ? decoded.sig : undefined;

  if (
    !url ||
    !messageId ||
    !sig ||
    !isRedirectableUrl(url)
  ) {
    logger.warn(
      { tokenLength: rawToken?.length },
      "[tracking] Malformed click token"
    );
    res.redirect(302, fallbackUrl);
    return;
  }

  const expected = generateClickSignature(messageId, url);

  if (!safeTimingEqualHex(sig, expected)) {
    logger.warn(
      { messageId },
      "[tracking] Invalid click token signature — refusing redirect target"
    );
    res.redirect(302, fallbackUrl);
    return;
  }

  res.redirect(302, url);

  try {
    const updated = await prisma.outreachMessage.updateMany({
      where: {
        id: messageId,
        deliveryState: {
          in: ["SENT", "DELIVERED", "OPENED"],
        },
      },
      data: {
        clicks: {
          increment: 1,
        },
      },
    });

    if (updated.count === 0) {
      return;
    }

    logger.info({ messageId }, "[tracking] Email click recorded");

    const message = await prisma.outreachMessage.findUnique({
      where: {
        id: messageId,
      },
      select: {
        leadId: true,
      },
    });

    if (!message) {
      return;
    }

    await logLeadJourneyEvent({
      leadId: message.leadId,
      eventType: "EMAIL_CLICKED",
      channel: "EMAIL",
      outreachMessageId: messageId,
      metadata: {
        url,
      },
    });
  } catch (err) {
    logger.error(
      { err, messageId },
      "[tracking] Failed to record email click"
    );
  }
}