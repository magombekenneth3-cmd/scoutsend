import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { ImapFlow } from "imapflow";
import { logger } from "../logger";
import {
    InboundReply,
    MailProvider,
    SendEmailParams,
    SendResult,
    SmtpCredentials,
} from "./types";

function parseFrom(from: string): { name: string; address: string } {
    const m = from.match(/^(.+?)\s*<(.+)>$/);
    if (m) return { name: m[1].trim(), address: m[2].trim() };
    const address = from.trim();
    return { name: address, address };
}

export class SmtpProvider implements MailProvider {
    readonly type = "SMTP" as const;
    private transport: Transporter | null = null;

    constructor(private creds: SmtpCredentials) { }

    private getTransport(): Transporter {
        if (!this.transport) {
            this.transport = nodemailer.createTransport({
                host: this.creds.smtpHost,
                port: this.creds.smtpPort,
                secure: this.creds.secure,
                auth: {
                    user: this.creds.username,
                    pass: this.creds.password,
                },
                pool: true,
                maxConnections: 5,
            });
        }
        return this.transport;
    }

    close(): void {
        this.transport?.close();
        this.transport = null;
    }

    async verify(): Promise<boolean> {
        try {
            await this.getTransport().verify();
            return true;
        } catch (err) {
            logger.error({ err }, "[SmtpProvider] verify failed");
            return false;
        }
    }

    async sendEmail(params: SendEmailParams): Promise<SendResult> {
        try {
            const from = parseFrom(params.from);
            const info = await this.getTransport().sendMail({
                from: { name: from.name, address: from.address },
                to: params.to,
                subject: params.subject,
                html: params.html,
                text: params.text,
                ...(params.inReplyTo ? { inReplyTo: params.inReplyTo } : {}),
                ...(params.references ? { references: params.references } : {}),
                // Forward List-Unsubscribe / List-Unsubscribe-Post and any
                // other caller-supplied headers (nodemailer accepts
                // Record<string, string | string[]> here)
                ...(params.headers ? { headers: params.headers } : {}),
            });

            const externalId: string =
                (info as { messageId?: string }).messageId ??
                `smtp_${Date.now()}_${Math.random().toString(36).slice(2)}`;

            return { success: true, externalId };
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            logger.error({ err }, "[SmtpProvider] sendEmail failed");
            return { success: false, error: msg };
        }
    }

    async fetchReplies(since: Date): Promise<InboundReply[]> {
        const imapHost = this.creds.imapHost ?? this.creds.smtpHost;
        const imapPort = this.creds.imapPort ?? 993;

        const client = new ImapFlow({
            host: imapHost,
            port: imapPort,
            secure: true,
            auth: {
                user: this.creds.username,
                pass: this.creds.password,
            },
            logger: false,
        });

        const replies: InboundReply[] = [];
        let connected = false;

        try {
            await client.connect();
            connected = true;

            const lock = await client.getMailboxLock("INBOX");

            try {
                const searchResult = await client.search(
                    { since },
                    { uid: true },
                );

                if (!searchResult || searchResult.length === 0) return [];

                const uids: number[] = searchResult;

                for await (const msg of client.fetch(
                    uids,
                    {
                        uid: true,
                        envelope: true,
                        bodyParts: ["text", "html"],
                        internalDate: true,
                    },
                    { uid: true },
                )) {
                    const envelope = msg.envelope as {
                        messageId?: string;
                        inReplyTo?: string;
                        from?: Array<{ address?: string }>;
                        subject?: string;
                    } | null;

                    const fromEmail = envelope?.from?.[0]?.address ?? "";
                    const subject = envelope?.subject ?? "";
                    const inReplyToId = envelope?.inReplyTo?.trim() ?? null;
                    const providerMessageId =
                        envelope?.messageId ??
                        `imap_${msg.uid ?? Date.now()}`;
                    let bodyText = "";
                    const textPart = msg.bodyParts?.get("text");
                    if (textPart) {
                        bodyText = textPart.toString("utf8");
                    } else {
                        const htmlPart = msg.bodyParts?.get("html");
                        if (htmlPart) {
                            bodyText = htmlPart.toString("utf8");
                        }
                    }

                    // Fix TS2322: ensure receivedAt is always a Date, never a string
                    const receivedAt: Date =
                        msg.internalDate instanceof Date
                            ? msg.internalDate
                            : new Date(msg.internalDate ?? Date.now());

                    replies.push({
                        providerMessageId,
                        inReplyToId,
                        fromEmail,
                        subject,
                        bodyText,
                        receivedAt,
                    });
                }
            } finally {
                lock.release();
            }
        } catch (err) {
            logger.error({ err }, "[SmtpProvider] fetchReplies failed");
        } finally {
            if (connected) {
                await client.logout().catch((err: unknown) =>
                    logger.error({ err }, "[SmtpProvider] logout failed"),
                );
            }
        }

        return replies;
    }
}