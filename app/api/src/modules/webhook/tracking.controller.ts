import { Request, Response } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";

const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

function generateOpenToken(messageId: string): string {
  return createHmac("sha256", process.env.WEBHOOK_SECRET!)
    .update(`open:${messageId}`)
    .digest("hex");
}

export function buildOpenTrackingPixelUrl(messageId: string): string | null {
  const appUrl = process.env.APP_URL;
  if (!appUrl || !messageId || !process.env.WEBHOOK_SECRET) return null;
  const token = generateOpenToken(messageId);
  return `${appUrl}/webhook/track/open/${token}?mid=${encodeURIComponent(messageId)}`;
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

  if (!messageId || !token || !process.env.WEBHOOK_SECRET) return;

  const expected = generateOpenToken(messageId);
  const tokenBuf = Buffer.from(token.padEnd(64, "0").slice(0, 64));
  const expectedBuf = Buffer.from(expected.padEnd(64, "0").slice(0, 64));

  if (!timingSafeEqual(tokenBuf, expectedBuf)) {
    logger.warn({ messageId }, "[tracking] Invalid open pixel token");
    return;
  }

  try {
    const updated = await prisma.outreachMessage.updateMany({
      where: {
        id: messageId,
        deliveryState: { in: ["SENT", "DELIVERED"] },
      },
      data: {
        deliveryState: "OPENED",
        openedAt: new Date(),
      },
    });

    if (updated.count > 0) {
      logger.info({ messageId }, "[tracking] Email open recorded");
    }
  } catch (err) {
    logger.error({ err, messageId }, "[tracking] Failed to record email open");
  }
}
