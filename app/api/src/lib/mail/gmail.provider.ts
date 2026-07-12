import { google, gmail_v1 } from "googleapis";
import { logger } from "../logger";
import {
    GmailCredentials,
    InboundReply,
    MailProvider,
    SendEmailParams,
    SendResult,
} from "./types";

function makeRfc2822(params: SendEmailParams): string {
    const boundary = `----=_Part_${Date.now()}`;
    const lines: string[] = [
        `From: ${params.from}`,
        `To: ${params.to}`,
        `Subject: ${params.subject}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
    ];
    if (params.inReplyTo) lines.push(`In-Reply-To: ${params.inReplyTo}`);
    if (params.references) lines.push(`References: ${params.references}`);
    // RFC 8058: inject List-Unsubscribe and any other caller-supplied headers
    if (params.headers) {
        for (const [name, value] of Object.entries(params.headers)) {
            lines.push(`${name}: ${value}`);
        }
    }
    lines.push("");
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: text/plain; charset="UTF-8"`);
    lines.push("");
    lines.push(params.text);
    lines.push(`--${boundary}`);
    lines.push(`Content-Type: text/html; charset="UTF-8"`);
    lines.push("");
    lines.push(params.html);
    lines.push(`--${boundary}--`);
    return lines.join("\r\n");
}

function encodeBase64Url(str: string): string {
    return Buffer.from(str)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
}

function decodeBase64Url(str: string): string {
    return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function extractHeader(
    headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
    name: string
): string | null {
    if (!headers) return null;
    const h = headers.find((h) => h.name?.toLowerCase() === name.toLowerCase());
    return h?.value ?? null;
}

function extractPlainText(payload: gmail_v1.Schema$MessagePart | undefined): string {
    if (!payload) return "";
    if (payload.mimeType === "text/plain" && payload.body?.data) {
        return decodeBase64Url(payload.body.data);
    }
    if (payload.parts) {
        for (const part of payload.parts) {
            const text = extractPlainText(part);
            if (text) return text;
        }
    }
    return "";
}

export class GmailProvider implements MailProvider {
    readonly type = "GMAIL" as const;

    private auth;
    private gmail: gmail_v1.Gmail;

    constructor(private creds: GmailCredentials) {
        this.auth = new google.auth.OAuth2(creds.clientId, creds.clientSecret);
        this.auth.setCredentials({ refresh_token: creds.refreshToken });
        this.gmail = google.gmail({ version: "v1", auth: this.auth });
    }

    async verify(): Promise<boolean> {
        try {
            await Promise.race([
                this.gmail.users.getProfile({ userId: "me" }),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("verify timeout")), 5000)
                ),
            ]);
            return true;
        } catch (err) {
            logger.error({ err }, "[GmailProvider] verify failed");
            return false;
        }
    }

    async sendEmail(params: SendEmailParams): Promise<SendResult> {
        try {
            const raw = encodeBase64Url(makeRfc2822(params));
            const res = await this.gmail.users.messages.send({
                userId: "me",
                requestBody: { raw },
            });
            const externalId = res.data.id;
            if (!externalId) return { success: false, error: "No message id returned" };
            return { success: true, externalId };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error({ err }, "[GmailProvider] sendEmail failed");
            return { success: false, error: msg };
        }
    }

    async fetchReplies(since: Date): Promise<InboundReply[]> {
        try {
            const sinceEpoch = Math.floor(since.getTime() / 1000);
            const listRes = await this.gmail.users.messages.list({
                userId: "me",
                q: `in:inbox after:${sinceEpoch}`,
                maxResults: 100,
            });

            const messages = listRes.data.messages ?? [];
            const replies: InboundReply[] = [];

            for (const msg of messages) {
                if (!msg.id) continue;
                try {
                    const detail = await this.gmail.users.messages.get({
                        userId: "me",
                        id: msg.id,
                        format: "full",
                    });
                    const payload = detail.data.payload;
                    const headers = payload?.headers ?? [];

                    const inReplyTo = extractHeader(headers, "In-Reply-To");
                    const from = extractHeader(headers, "From") ?? "";
                    const subject = extractHeader(headers, "Subject") ?? "";
                    const dateStr = extractHeader(headers, "Date");
                    const receivedAt = dateStr ? new Date(dateStr) : new Date();
                    const bodyText = extractPlainText(payload ?? undefined);

                    // Extract email address from "Name <addr>" format
                    const fromMatch = from.match(/<([^>]+)>/) ?? [null, from.trim()];
                    const fromEmail = fromMatch[1] ?? from.trim();

                    replies.push({
                        providerMessageId: msg.id,
                        inReplyToId: inReplyTo ?? null,
                        fromEmail,
                        subject,
                        bodyText,
                        receivedAt,
                    });
                } catch (innerErr) {
                    logger.warn({ err: innerErr, msgId: msg.id }, "[GmailProvider] failed to fetch message detail");
                }
            }

            return replies;
        } catch (err) {
            logger.error({ err }, "[GmailProvider] fetchReplies failed");
            return [];
        }
    }
}