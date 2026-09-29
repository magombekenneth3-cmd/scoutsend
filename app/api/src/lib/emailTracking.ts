import { createHmac } from "crypto";

function getWebhookSecret(): string {
    const secret = process.env.WEBHOOK_SECRET;

    if (!secret) {
        throw new Error("[email-tracking] WEBHOOK_SECRET env var is not set");
    }

    return secret;
}

function normalizeBaseUrl(value: string): string {
    return value.replace(/\/+$/, "");
}

export function isRedirectableUrl(value: string): boolean {
    try {
        const parsed = new URL(value);
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
        return false;
    }
}

export function generateOpenToken(messageId: string): string {
    return createHmac("sha256", getWebhookSecret())
        .update(`open:${messageId}`)
        .digest("hex");
}

export function buildOpenTrackingPixelUrl(
    messageId: string,
    appBaseUrl?: string | null
): string | null {
    const base = appBaseUrl || process.env.APP_URL;

    if (!base || !messageId || !isRedirectableUrl(base)) {
        return null;
    }

    const token = generateOpenToken(messageId);
    const normalizedBase = normalizeBaseUrl(base);

    return `${normalizedBase}/webhook/track/open/${token}?mid=${encodeURIComponent(
        messageId
    )}`;
}

export function generateClickSignature(
    messageId: string,
    url: string
): string {
    return createHmac("sha256", getWebhookSecret())
        .update(`click:${messageId}:${url}`)
        .digest("hex");
}

export function buildClickTrackingUrl(
    messageId: string,
    destinationUrl: string,
    trackingBaseUrl?: string | null
): string | null {
    const base = trackingBaseUrl || process.env.APP_URL;

    if (
        !base ||
        !messageId ||
        !destinationUrl ||
        !isRedirectableUrl(base) ||
        !isRedirectableUrl(destinationUrl)
    ) {
        return null;
    }

    const sig = generateClickSignature(messageId, destinationUrl);

    const token = Buffer.from(
        JSON.stringify({
            url: destinationUrl,
            mid: messageId,
            sig,
        }),
        "utf8"
    ).toString("base64url");

    const normalizedBase = normalizeBaseUrl(base);

    return `${normalizedBase}/webhook/track/click/${token}`;
}

export function generateUnsubscribeToken(messageId: string): string {
    return createHmac("sha256", getWebhookSecret())
        .update(`unsubscribe:${messageId}`)
        .digest("hex");
}