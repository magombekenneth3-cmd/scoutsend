import { Request, Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../auth/auth.types";
import {
    buildCalendlyAuthUrl,
    decryptCalendlyState,
    storeCalendlyTokens,
    revokeCalendlyToken,
} from "./calendar.tools";
import { prisma } from "../../lib/prisma";
import { ForbiddenError, NotFoundError } from "../../lib/errors";

export async function getCalendlyAuthUrl(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { id } = req.params as { id: string };
        const userId = req.user!.userId;

        const mailbox = await prisma.senderMailbox.findUnique({ where: { id } });
        if (!mailbox) throw new NotFoundError("Sender mailbox");
        if (mailbox.createdById !== userId) throw new ForbiddenError();

        const authUrl = buildCalendlyAuthUrl(id, userId);
        res.json({ authUrl });
    } catch (err) {
        next(err);
    }
}

export async function handleCalendlyCallback(
    req: Request,
    res: Response
): Promise<void> {
    const { code, state, error } = req.query as {
        code?: string;
        state?: string;
        error?: string;
    };

    const frontendBase = process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_BASE_URL ?? "";
    const failUrl = `${frontendBase}/dashboard/mailboxes?calendly=error`;
    const okUrl = `${frontendBase}/dashboard/mailboxes?calendly=connected`;

    if (error || !code || !state) {
        res.redirect(failUrl);
        return;
    }

    try {
        const { mailboxId, userId } = decryptCalendlyState(state);

        const mailbox = await prisma.senderMailbox.findUnique({ where: { id: mailboxId } });
        if (!mailbox || mailbox.createdById !== userId) {
            res.redirect(failUrl);
            return;
        }

        await storeCalendlyTokens(mailboxId, code);
        res.redirect(okUrl);
    } catch {
        res.redirect(failUrl);
    }
}

export async function disconnectCalendly(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { id } = req.params as { id: string };
        const userId = req.user!.userId;

        const mailbox = await prisma.senderMailbox.findUnique({ where: { id } });
        if (!mailbox) throw new NotFoundError("Sender mailbox");
        if (mailbox.createdById !== userId) throw new ForbiddenError();

        await revokeCalendlyToken(id);
        res.status(204).send();
    } catch (err) {
        next(err);
    }
}