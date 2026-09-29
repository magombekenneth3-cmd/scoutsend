import { Router, Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { upsertSubscriptionFromStripe } from "./billing.service";
import { logger } from "../../lib/logger";
import { HttpError } from "../../lib/errors/http-error";

const router = Router();

router.post("/webhook", async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
        next(new HttpError(
            503,
            "STRIPE_WEBHOOK_SECRET is not configured",
            "PAYMENT_NOT_CONFIGURED",
            "Payment processing is not available. Please contact your administrator to configure billing."
        ));
        return;
    }

    const sig = req.headers["stripe-signature"] as string | undefined;
    if (!sig) {
        res.status(400).json({ error: "Missing stripe-signature header" });
        return;
    }

    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
        res.status(400).json({ error: "Raw body not available" });
        return;
    }

    const parts = sig.split(",");
    const tPart = parts.find((p) => p.startsWith("t="));
    const v1Part = parts.find((p) => p.startsWith("v1="));
    if (!tPart || !v1Part) {
        res.status(400).json({ error: "Malformed stripe-signature" });
        return;
    }

    const timestamp = tPart.slice(2);
    const expectedSig = v1Part.slice(3);
    const payload = `${timestamp}.${rawBody.toString("utf8")}`;
    const computed = crypto.createHmac("sha256", secret).update(payload).digest("hex");

    if (!crypto.timingSafeEqual(Buffer.from(computed, "hex"), Buffer.from(expectedSig, "hex"))) {
        res.status(400).json({ error: "Invalid signature" });
        return;
    }

    const tsSeconds = parseInt(timestamp, 10);
    const drift = Math.abs(Date.now() / 1000 - tsSeconds);
    if (drift > 300) {
        res.status(400).json({ error: "Timestamp too old" });
        return;
    }

    let event: { type: string; data: { object: Record<string, unknown> } };
    try {
        event = JSON.parse(rawBody.toString("utf8"));
    } catch {
        res.status(400).json({ error: "Invalid JSON" });
        return;
    }

    try {
        if (
            event.type === "customer.subscription.updated" ||
            event.type === "customer.subscription.deleted" ||
            event.type === "customer.subscription.created"
        ) {
            await upsertSubscriptionFromStripe(event as Parameters<typeof upsertSubscriptionFromStripe>[0]);
        }
        res.status(200).json({ received: true });
    } catch (err) {
        logger.error({ err, eventType: event.type }, "[billing] Stripe webhook processing failed");
        next(new HttpError(
            503,
            String(err),
            "PAYMENT_PROCESSING_FAILED",
            "Payment processing failed. Please try again — if the issue persists, contact support."
        ));
    }
});

router.get("/plans", (_req: Request, res: Response): void => {
    res.json({
        plans: [
            { tier: "FREE", seatLimit: 3, campaignLimit: 5, price: 0 },
            { tier: "STARTER", seatLimit: 10, campaignLimit: 20, price: 49 },
            { tier: "GROWTH", seatLimit: 30, campaignLimit: 100, price: 149 },
            { tier: "ENTERPRISE", seatLimit: -1, campaignLimit: -1, price: null },
        ],
    });
});

export default router;
