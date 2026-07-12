import { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { htmlToText } from "html-to-text";
import { prisma } from "../../lib/prisma";
import { createReply } from "../replies/replies.services";
import { logger } from "../../lib/logger";

export interface InboundEmailPayload {
    from: string;
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
    messageId?: string;
    inReplyTo?: string;
    headers?: Record<string, string>;
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

function extractEmail(from: string): string {
    const match = from.match(/<([^>]+)>/);
    return (match ? match[1] : from).trim().toLowerCase();
}

function stripQuotedLines(raw: string): string {
    return raw
        .split("\n")
        .filter((line) => !line.trimStart().startsWith(">"))
        .join("\n")
        .trim();
}

function extractPlainText(payload: InboundEmailPayload): string {
    if (payload.text) {
        return stripQuotedLines(payload.text);
    }
    if (payload.html) {
        return stripQuotedLines(htmlToText(payload.html, { wordwrap: false }));
    }
    return "";
}

function resolveMessageId(payload: InboundEmailPayload): string | undefined {
    return (
        payload.messageId ??
        payload.headers?.["message-id"] ??
        payload.headers?.["Message-ID"]
    );
}

function resolveInReplyTo(payload: InboundEmailPayload): string | undefined {
    return (
        payload.inReplyTo ??
        payload.headers?.["in-reply-to"] ??
        payload.headers?.["In-Reply-To"]
    );
}

export async function handleInboundEmail(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        if (!verifySecret(req)) {
            res.status(401).json({ error: "Invalid webhook secret" });
            return;
        }

        const payload = req.body as InboundEmailPayload;

        if (!payload?.from) {
            res.status(400).json({ error: "Missing from field" });
            return;
        }

        const senderEmail = extractEmail(payload.from);

        const lead = await prisma.lead.findFirst({
            where: { email: senderEmail, deletedAt: null },
            select: { id: true, email: true },
        });

        if (!lead) {
            res.status(200).json({ ok: true, skipped: "no_lead" });
            return;
        }

        const providerMessageId = resolveMessageId(payload);
        const inReplyTo = resolveInReplyTo(payload);

        if (providerMessageId) {
            const existingReply = await prisma.reply.findUnique({
                where: { providerMessageId },
                select: { id: true },
            });
            if (existingReply) {
                res.status(200).json({ ok: true, skipped: "duplicate" });
                return;
            }
        }

        let outreachMessage: { id: string } | null = null;

        if (inReplyTo) {
            outreachMessage = await prisma.outreachMessage.findUnique({
                where: { externalMessageId: inReplyTo },
                select: { id: true },
            });
        }

        if (!outreachMessage) {
            outreachMessage = await prisma.outreachMessage.findFirst({
                where: {
                    leadId: lead.id,
                    deliveryState: { in: ["SENT", "DELIVERED", "OPENED"] },
                },
                orderBy: { sentAt: "desc" },
                select: { id: true },
            });
        }

        if (!outreachMessage) {
            res.status(200).json({ ok: true, skipped: "no_message" });
            return;
        }

        const body = extractPlainText(payload);

        if (!body) {
            res.status(200).json({ ok: true, skipped: "empty_body" });
            return;
        }

        const reply = await createReply({
            body,
            outreachMessageId: outreachMessage.id,
            leadId: lead.id,
            providerMessageId,
        });

        logger.info({ replyId: reply.id, leadId: lead.id }, "[inbound] Reply created");

        res.status(201).json({ ok: true, replyId: reply.id });
    } catch (error) {
        next(error);
    }
}