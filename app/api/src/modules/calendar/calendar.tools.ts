import { prisma } from "../../lib/prisma";
import { encryptJson, decryptJson, isEncrypted } from "../../lib/mail/crypto";

interface CalendlyTokens {
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    expiresAt: number;
}

interface CalendlyUserResponse {
    resource: {
        scheduling_url: string;
        uri: string;
    };
}

const CALENDLY_API_BASE = "https://api.calendly.com";
const CALENDLY_AUTH_BASE = "https://auth.calendly.com";

function clientId(): string {
    const v = process.env.CALENDLY_CLIENT_ID;
    if (!v) throw new Error("CALENDLY_CLIENT_ID is not configured");
    return v;
}

function clientSecret(): string {
    const v = process.env.CALENDLY_CLIENT_SECRET;
    if (!v) throw new Error("CALENDLY_CLIENT_SECRET is not configured");
    return v;
}

function callbackUrl(): string {
    const base = process.env.APP_BASE_URL;
    if (!base) throw new Error("APP_BASE_URL is not configured");
    return `${base}/calendar/callback`;
}

export function buildCalendlyAuthUrl(mailboxId: string, userId: string): string {
    const state = encryptJson({ mailboxId, userId });
    const params = new URLSearchParams({
        client_id: clientId(),
        response_type: "code",
        redirect_uri: callbackUrl(),
        state,
    });
    return `https://calendly.com/oauth/authorize?${params.toString()}`;
}

export function decryptCalendlyState(raw: string): { mailboxId: string; userId: string } {
    return decryptJson<{ mailboxId: string; userId: string }>(raw);
}

async function exchangeCode(code: string): Promise<CalendlyTokens> {
    const res = await fetch(`${CALENDLY_AUTH_BASE}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: callbackUrl(),
            client_id: clientId(),
            client_secret: clientSecret(),
        }),
    });

    if (!res.ok) throw new Error(`Calendly token exchange failed: ${await res.text()}`);

    const d = await res.json();
    return {
        accessToken: d.access_token,
        refreshToken: d.refresh_token,
        tokenType: d.token_type,
        expiresAt: Math.floor(Date.now() / 1000) + (d.expires_in ?? 7200),
    };
}

async function doRefresh(tokens: CalendlyTokens): Promise<CalendlyTokens> {
    const res = await fetch(`${CALENDLY_AUTH_BASE}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: tokens.refreshToken,
            client_id: clientId(),
            client_secret: clientSecret(),
        }),
    });

    if (!res.ok) throw new Error(`Calendly token refresh failed: ${await res.text()}`);

    const d = await res.json();
    return {
        accessToken: d.access_token,
        refreshToken: d.refresh_token ?? tokens.refreshToken,
        tokenType: d.token_type,
        expiresAt: Math.floor(Date.now() / 1000) + (d.expires_in ?? 7200),
    };
}

function decryptTokens(raw: unknown): CalendlyTokens | null {
    if (!raw) return null;
    if (isEncrypted(raw)) return decryptJson<CalendlyTokens>(raw);
    return raw as CalendlyTokens;
}

export async function storeCalendlyTokens(mailboxId: string, code: string): Promise<void> {
    const tokens = await exchangeCode(code);
    await prisma.senderMailbox.update({
        where: { id: mailboxId },
        data: { calendlyToken: encryptJson(tokens) },
    });
}

export async function revokeCalendlyToken(mailboxId: string): Promise<void> {
    await prisma.senderMailbox.update({
        where: { id: mailboxId },
        data: { calendlyToken: null as any },
    });
}

export async function getCalendlySchedulingUrl(mailboxId: string): Promise<string | null> {
    const mailbox = await prisma.senderMailbox.findUnique({
        where: { id: mailboxId },
        select: { calendlyToken: true },
    });

    if (!mailbox?.calendlyToken) return null;

    let tokens = decryptTokens(mailbox.calendlyToken);
    if (!tokens) return null;

    const isExpired = tokens.expiresAt < Math.floor(Date.now() / 1000) + 60;
    if (isExpired) {
        try {
            tokens = await doRefresh(tokens);
            await prisma.senderMailbox.update({
                where: { id: mailboxId },
                data: { calendlyToken: encryptJson(tokens) },
            });
        } catch {
            return null;
        }
    }

    try {
        const res = await fetch(`${CALENDLY_API_BASE}/users/me`, {
            headers: { Authorization: `Bearer ${tokens.accessToken}` },
        });
        if (!res.ok) return null;
        const data = (await res.json()) as CalendlyUserResponse;
        return data.resource.scheduling_url ?? null;
    } catch {
        return null;
    }
}