import { createHmac } from "crypto";
import { Request, Response } from "express";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";

// ─── shared helpers ───────────────────────────────────────────────────────────

function verifyToken(token: string, mid: string): boolean {
  const expected = createHmac("sha256", process.env.WEBHOOK_SECRET!)
    .update(mid)
    .digest("hex");
  return token === expected;
}

async function suppressEmail(mid: string): Promise<string | null> {
  const message = await prisma.outreachMessage.findUnique({
    where: { id: mid },
    include: {
      lead: {
        select: {
          email: true,
          campaign: { select: { createdById: true } },
        },
      },
    },
  });

  if (!message?.lead?.email) return null;

  const email = message.lead.email;
  const userId = message.lead.campaign.createdById;

  await prisma.suppression.upsert({
    where: { email_userId: { email, userId } },
    create: {
      email,
      reason: "User clicked unsubscribe link",
      source: "unsubscribe-link",
      userId,
    },
    update: {},
  });

  return email;
}

// ─── GET /unsubscribe/:token?mid=…  ──────────────────────────────────────────
// Validates token and renders a confirm-to-unsubscribe HTML form.
// Writes NO database rows — safe against crawler link prefetching.

export async function handleUnsubscribe(
  req: Request,
  res: Response
): Promise<void> {
  const { token } = req.params as { token: string };
  const { mid } = req.query as { mid?: string };

  if (!token || !mid) {
    res.status(400).send("<html><body><p>Invalid unsubscribe link.</p></body></html>");
    return;
  }

  if (!verifyToken(token, mid)) {
    logger.warn({ mid, token: token.slice(0, 8) + "..." }, "[unsubscribe] Invalid token");
    res.status(400).send("<html><body><p>Invalid or expired unsubscribe link.</p></body></html>");
    return;
  }

  const confirmAction = `/webhook/unsubscribe/${encodeURIComponent(token)}/confirm?mid=${encodeURIComponent(mid)}`;

  res.status(200).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Unsubscribe</title>
      <style>
        body { font-family: Arial, sans-serif; display: flex; justify-content: center;
               align-items: center; min-height: 100vh; margin: 0; background: #f4f4f7; }
        .card { background: white; padding: 48px; border-radius: 10px;
                text-align: center; max-width: 480px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
        h1 { color: #1a1a2e; margin-bottom: 12px; font-size: 22px; }
        p  { color: #666; line-height: 1.6; }
        .btn { display: inline-block; margin-top: 24px; padding: 12px 32px;
               background: #e53e3e; color: white; border: none; border-radius: 6px;
               font-size: 15px; cursor: pointer; font-family: inherit; }
        .btn:hover { background: #c53030; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>Confirm Unsubscribe</h1>
        <p>Are you sure you want to unsubscribe and stop receiving emails?</p>
        <form method="POST" action="${confirmAction}">
          <button type="submit" class="btn">Yes, unsubscribe me</button>
        </form>
        <p style="font-size:13px;color:#999;margin-top:24px">
          Simply close this page if you did not mean to unsubscribe.
        </p>
      </div>
    </body>
    </html>
  `);
}

// ─── POST /unsubscribe/:token/confirm?mid=…  ──────────────────────────────────
// Human confirms intent via form submit — commits suppression to database.

export async function handleUnsubscribeConfirm(
  req: Request,
  res: Response
): Promise<void> {
  const { token } = req.params as { token: string };
  const { mid } = req.query as { mid?: string };

  if (!token || !mid) {
    res.status(400).send("<html><body><p>Invalid unsubscribe link.</p></body></html>");
    return;
  }

  if (!verifyToken(token, mid)) {
    logger.warn({ mid, token: token.slice(0, 8) + "..." }, "[unsubscribe] Confirm — invalid token");
    res.status(400).send("<html><body><p>Invalid or expired unsubscribe link.</p></body></html>");
    return;
  }

  const email = await suppressEmail(mid);

  if (!email) {
    res.status(200).send("<html><body><p>You have been unsubscribed.</p></body></html>");
    return;
  }

  logger.info({ email, messageId: mid }, "[unsubscribe] Email suppressed via confirm form");

  res.status(200).send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Unsubscribed</title>
      <style>
        body { font-family: Arial, sans-serif; display: flex; justify-content: center;
               align-items: center; min-height: 100vh; margin: 0; background: #f4f4f7; }
        .card { background: white; padding: 48px; border-radius: 10px;
                text-align: center; max-width: 480px; box-shadow: 0 2px 12px rgba(0,0,0,0.08); }
        h1 { color: #1a1a2e; margin-bottom: 12px; }
        p  { color: #666; line-height: 1.6; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>You've been unsubscribed</h1>
        <p>You will no longer receive emails from us.</p>
        <p style="font-size:13px;color:#999;margin-top:24px">
          If this was a mistake, please reply to any previous email to re-subscribe.
        </p>
      </div>
    </body>
    </html>
  `);
}

// ─── POST /unsubscribe/:token?mid=…  ─────────────────────────────────────────
// RFC 8058 machine-initiated one-click.
//
// Mail clients (Gmail, Apple Mail, Yahoo) POST to this URL automatically when
// the user clicks "Unsubscribe" in their inbox UI.  The request body will
// contain `List-Unsubscribe=One-Click`.
//
// Requirements (RFC 8058 §3):
//   • Must respond 2xx with no redirect
//   • Must not require further user interaction
//   • Must process the unsubscribe immediately

export async function handleUnsubscribeOneClick(
  req: Request,
  res: Response
): Promise<void> {
  const { token } = req.params as { token: string };
  const { mid } = req.query as { mid?: string };

  if (!token || !mid) {
    res.status(400).end();
    return;
  }

  if (!verifyToken(token, mid)) {
    logger.warn({ mid, token: token.slice(0, 8) + "..." }, "[unsubscribe] RFC8058 invalid token");
    res.status(400).end();
    return;
  }

  const email = await suppressEmail(mid);

  if (!email) {
    // Unknown message — respond 200 so the mail client doesn't retry
    res.status(200).end();
    return;
  }

  logger.info({ email, messageId: mid }, "[unsubscribe] RFC 8058 one-click suppressed");

  // RFC 8058 §3: respond with 200, no body required
  res.status(200).end();
}