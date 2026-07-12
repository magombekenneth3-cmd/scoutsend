import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { redis } from "../../lib/ioredis";
import { DeliveryState } from "@prisma/client";
import { logger } from "../../lib/logger";
import { deliveryWebhookQueue } from "../gemini/campaign.queue";
import type { DeliveryWebhookJobData } from "./delivery.worker";

export interface ProviderDeliveryEvent {
    externalMessageId: string;
    event: "delivered" | "bounced" | "complained" | "opened";
    recipientEmail?: string;
    timestamp?: string;
    bounceType?: string;
    statusCode?: string | number;
    bounceSubType?: string;
    diagnosticCode?: string;
}

function verifySecret(req: Request): boolean {
    const expected = process.env.WEBHOOK_SECRET;
    if (!expected) return false;
    const raw = req.headers["x-webhook-secret"];
    const incoming = Array.isArray(raw) ? raw[0] : (raw ?? "");
    const a = Buffer.from(incoming);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
}

const EVENT_STATE_MAP: Record<ProviderDeliveryEvent["event"], DeliveryState> = {
    delivered: "DELIVERED",
    bounced: "BOUNCED",
    complained: "SPAM",
    opened: "OPENED",
};

const DEDUP_TTL_SECONDS = 86_400;

export async function handleProviderDeliveryEvent(
    req: Request,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        if (!verifySecret(req)) {
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

        const dedupKey = `wh:delivery:${payload.externalMessageId}:${payload.event}`;
        const acquired = await redis.set(dedupKey, "1", "EX", DEDUP_TTL_SECONDS, "NX");
        if (!acquired) {
            res.status(200).end();
            return;
        }

        const jobData: DeliveryWebhookJobData = { payload, newState, dedupKey };
        await deliveryWebhookQueue.add("process-delivery-event", jobData);

        logger.debug(
            { externalMessageId: payload.externalMessageId, event: payload.event },
            "[delivery-webhook] Enqueued",
        );

        res.status(200).end();
    } catch (err) {
        next(err);
    }
}