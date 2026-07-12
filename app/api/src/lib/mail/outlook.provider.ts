import type { Redis } from "ioredis";
import { logger } from "../logger";
import {
    InboundReply,
    MailProvider,
    OutlookCredentials,
    SendEmailParams,
    SendResult,
} from "./types";

interface GraphMessage {
    id: string;
    subject: string;
    bodyPreview: string;
    body: { contentType: string; content: string };
    from: { emailAddress: { address: string } };
    receivedDateTime: string;
    conversationId: string;
    internetMessageId: string;
}

interface GraphToken {
    accessToken: string;
    expiresAt: number; // Unix timestamp in seconds
}

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const TOKEN_URL = (tenantId: string) =>
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

const TOKEN_EXPIRY_BUFFER_SECS = 60;

export interface OutlookProviderOptions {
    mailboxId?: string;
    redis?: Redis;
    onTokenRotation?: (newRefreshToken: string) => Promise<void>;
}

export class OutlookProvider implements MailProvider {
    readonly type = "OUTLOOK" as const;
    private cachedToken: GraphToken | null = null;

    constructor(
        private creds: OutlookCredentials,
        private opts: OutlookProviderOptions = {}
    ) { }

    private cacheKey(): string | null {
        return this.opts.mailboxId ? `outlook:token:${this.opts.mailboxId}` : null;
    }

    private isTokenFresh(token: GraphToken): boolean {
        return Math.floor(Date.now() / 1000) < token.expiresAt - TOKEN_EXPIRY_BUFFER_SECS;
    }

    private async getAccessToken(): Promise<string> {
        if (this.cachedToken && this.isTokenFresh(this.cachedToken)) {
            return this.cachedToken.accessToken;
        }

        const { redis } = this.opts;
        const key = this.cacheKey();

        if (redis && key) {
            try {
                const [cached, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
                if (cached && ttl > TOKEN_EXPIRY_BUFFER_SECS) {
                    this.cachedToken = {
                        accessToken: cached,
                        expiresAt: Math.floor(Date.now() / 1000) + ttl,
                    };
                    return cached;
                }
            } catch (err) {
                logger.warn({ err }, "[OutlookProvider] Redis unavailable, fetching fresh token");
            }
        }


        return this.refreshFromMicrosoft();
    }

    private async refreshFromMicrosoft(): Promise<string> {
        const { redis } = this.opts;
        const key = this.cacheKey();

        const body = new URLSearchParams({
            client_id: this.creds.clientId,
            client_secret: this.creds.clientSecret,
            refresh_token: this.creds.refreshToken,
            grant_type: "refresh_token",
            scope: "https://graph.microsoft.com/.default offline_access",
        });

        const res = await fetch(TOKEN_URL(this.creds.tenantId), {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
        });

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`[OutlookProvider] token refresh failed: ${text}`);
        }

        const data = (await res.json()) as {
            access_token: string;
            expires_in: number;
            refresh_token?: string;
        };

        const ttl = Math.max(data.expires_in - TOKEN_EXPIRY_BUFFER_SECS, 1);
        this.cachedToken = {
            accessToken: data.access_token,
            expiresAt: Math.floor(Date.now() / 1000) + ttl,
        };

        if (redis && key) {
            try {
                await redis.setex(key, ttl, data.access_token);
            } catch (err) {
                logger.warn({ err }, "[OutlookProvider] Redis write failed, continuing without cache");
            }
        }


        if (data.refresh_token && data.refresh_token !== this.creds.refreshToken) {
            this.creds = { ...this.creds, refreshToken: data.refresh_token };
            if (this.opts.onTokenRotation) {
                this.opts.onTokenRotation(data.refresh_token).catch((err) =>
                    logger.error({ err }, "[OutlookProvider] Failed to persist rotated refresh token")
                );
            }
        }

        return data.access_token;
    }

    private async invalidateToken(): Promise<void> {
        this.cachedToken = null;

        const { redis } = this.opts;
        const key = this.cacheKey();
        if (redis && key) {
            try {
                await redis.del(key);
            } catch (err) {
                logger.warn({ err }, "[OutlookProvider] Redis delete failed during token invalidation");
            }
        }
    }
    private async graphFetch<T>(
        path: string,
        options: RequestInit = {},
        retry = true,
    ): Promise<T> {
        const token = await this.getAccessToken();
        const res = await fetch(`${GRAPH_BASE}${path}`, {
            ...options,
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
                ...(options.headers ?? {}),
            },
        });

        if (res.status === 401 && retry) {
            await this.invalidateToken();
            return this.graphFetch<T>(path, options, false);
        }

        if (!res.ok) {
            const text = await res.text();
            throw new Error(`[OutlookProvider] Graph API ${path} → ${res.status}: ${text}`);
        }
        if (res.status === 204) return {} as T;
        return res.json() as Promise<T>;
    }

    async verify(): Promise<boolean> {
        try {
            await this.graphFetch<{ mail: string }>("/me?$select=mail");
            return true;
        } catch (err) {
            logger.error({ err }, "[OutlookProvider] verify failed");
            return false;
        }
    }

    async sendEmail(params: SendEmailParams): Promise<SendResult> {
        try {
            const message: Record<string, unknown> = {
                subject: params.subject,
                body: { contentType: "HTML", content: params.html },
                toRecipients: [{ emailAddress: { address: params.to } }],
            };

            const fromMatch = params.from.match(/^(.+?)\s*<(.+)>$/);
            if (fromMatch) {
                message.from = {
                    emailAddress: { name: fromMatch[1].trim(), address: fromMatch[2].trim() },
                };
            }

            const internetMessageHeaders: Array<{ name: string; value: string }> = [];
            if (params.inReplyTo) {
                internetMessageHeaders.push({ name: "In-Reply-To", value: params.inReplyTo });
            }
            if (params.references) {
                internetMessageHeaders.push({ name: "References", value: params.references });
            }
            if (params.headers) {
                for (const [name, value] of Object.entries(params.headers)) {
                    internetMessageHeaders.push({ name, value });
                }
            }
            if (internetMessageHeaders.length) {
                message.internetMessageHeaders = internetMessageHeaders;
            }

            const draft = await this.graphFetch<{ id: string }>(
                `/me/messages`,
                { method: "POST", body: JSON.stringify(message) },
            );

            await this.graphFetch(`/me/messages/${draft.id}/send`, { method: "POST" });

            return { success: true, externalId: draft.id };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error({ err }, "[OutlookProvider] sendEmail failed");
            return { success: false, error: msg };
        }
    }

    async fetchReplies(since: Date): Promise<InboundReply[]> {
        try {
            const filter = `receivedDateTime ge ${since.toISOString()}`;
            const res = await this.graphFetch<{ value: GraphMessage[] }>(
                `/me/mailFolders/Inbox/messages?$filter=${encodeURIComponent(filter)}&$top=100&$select=id,subject,body,from,receivedDateTime,internetMessageId,conversationId`,
            );

            return (res.value ?? []).map((msg) => ({
                providerMessageId: msg.id,
                inReplyToId: null,
                fromEmail: msg.from?.emailAddress?.address ?? "",
                subject: msg.subject ?? "",
                bodyText:
                    msg.body?.contentType === "text"
                        ? msg.body.content
                        : msg.body?.content?.replace(/<[^>]+>/g, " ").trim() ?? "",
                receivedAt: new Date(msg.receivedDateTime),
            }));
        } catch (err) {
            logger.error({ err }, "[OutlookProvider] fetchReplies failed");
            return [];
        }
    }
}