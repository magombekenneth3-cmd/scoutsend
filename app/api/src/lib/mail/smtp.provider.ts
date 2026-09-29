import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { ImapFlow } from "imapflow";
import { logger } from "../logger";
import {
    InboundReply,
    MailProvider,
    ProviderCapabilities,
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

    getCapabilities(): ProviderCapabilities {
        return {
            // SMTP does not support client-supplied idempotency keys.
            supportsIdempotency: false,
            // There is no SMTP API to look up delivery status post-transmission.
            // UNKNOWN intents must be escalated to MANUAL_REVIEW.
            supportsLookup: false,
            reconciliationStrategy: "MANUAL_REVIEW",
        };
    }

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
                ...(this.creds.dkim ? { dkim: this.creds.dkim } : {}),
            });
        }
        return this.transport;
    }

    close(): void {
        this.transport?.close();
        this.transport = null;
    }

    async verify(): Promise<boolean> {
        const VERIFY_TIMEOUT_MS = 10_000;
        try {
            await Promise.race([
                this.getTransport().verify(),
                new Promise<never>((_, reject) =>
                    setTimeout(() => reject(new Error("SMTP verify timed out")), VERIFY_TIMEOUT_MS)
                ),
            ]);
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
                ...(params.attachments ? { attachments: params.attachments } : {}),
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

        // Fix B: Guard missing IMAP host explicitly — do NOT let ImapFlow
        // receive undefined, which Node resolves to localhost:993.
        if (!imapHost) {
            throw new Error(
                "[SmtpProvider] IMAP host is not configured " +
                "(imapHost and smtpHost are both missing or empty). " +
                "Set SmtpCredentials.imapHost to the IMAP server hostname.",
            );
        }

        const FETCH_TIMEOUT_MS = 45_000;
        const client = new ImapFlow({
            host: imapHost,
            port: imapPort,
            secure: true,
            auth: {
                user: this.creds.username,
                pass: this.creds.password,
            },
            connectionTimeout: 15_000,
            greetingTimeout: 10_000,
            socketTimeout: 30_000,
            logger: false,
        });

        const replies: InboundReply[] = [];
        let connected = false;

        const executeFetch = async (): Promise<InboundReply[]> => {
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
            } finally {
                if (connected) {
                    await client.logout().catch((logoutErr: unknown) => {
                        const safeLogoutErr = logoutErr instanceof Error
                            ? { message: logoutErr.message, name: logoutErr.name }
                            : String(logoutErr);
                        logger.error({ err: safeLogoutErr }, "[SmtpProvider] logout failed");
                    });
                }
            }
            return replies;
        };

        try {
            let timeoutId: NodeJS.Timeout | undefined;
            const timeoutPromise = new Promise<never>((_, reject) => {
                timeoutId = setTimeout(() => {
                    reject(new Error(`[SmtpProvider] IMAP fetchReplies timed out after ${FETCH_TIMEOUT_MS}ms`));
                }, FETCH_TIMEOUT_MS);
            });

            const result = await Promise.race([executeFetch(), timeoutPromise]);
            if (timeoutId) clearTimeout(timeoutId);
            return result;
        } catch (err: unknown) {
            const safeErr = err instanceof Error
                ? { message: err.message, name: err.name, code: (err as any).code }
                : String(err);
            logger.error(
                { err: safeErr, imapHost, imapPort },
                "[SmtpProvider] fetchReplies failed",
            );
            throw err;
        }
    }
}