import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../auth/auth.types";
import * as SenderMailboxService from "./senderMailbox.services";
import {
    createSenderMailboxSchema,
    getSenderMailboxesQuerySchema,
    updateSenderMailboxSchema,
} from "./senderMailbox.schema";
import { CacheService } from "../../lib/cache";

export async function createSenderMailbox(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const data = createSenderMailboxSchema.parse(req.body);
        const mailbox = await SenderMailboxService.createSenderMailbox(data, req.user!.userId);
        await CacheService.invalidateVersioned(`version:sender-mailboxes:${req.user!.userId}`);
        res.status(201).json(mailbox);
    } catch (error) {
        next(error);
    }
}

export async function getSenderMailboxes(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const userId = req.user!.userId;
        const query = getSenderMailboxesQuerySchema.parse(req.query);
        const baseKey = `cache:sender-mailboxes:${userId}:prov:${query.providerType ?? "any"}:h:${query.health ?? "any"}:p:${query.page}:l:${query.limit}`;
        const versionKey = `version:sender-mailboxes:${userId}`;
        const result = await CacheService.getOrSetVersioned(
            baseKey,
            versionKey,
            () => SenderMailboxService.getSenderMailboxes(query, userId)
        );
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
}

export async function getSenderMailboxById(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { id } = req.params as { id: string };
        const userId = req.user!.userId;
        const baseKey = `cache:sender-mailbox:${id}`;
        const versionKey = `version:sender-mailbox:${id}`;
        const mailbox = await CacheService.getOrSetVersioned(
            baseKey,
            versionKey,
            () => SenderMailboxService.getSenderMailboxById(id, userId)
        );
        if (!mailbox) {
            res.status(404).json({ error: "Sender mailbox not found" });
            return;
        }
        res.status(200).json(mailbox);
    } catch (error) {
        next(error);
    }
}

export async function updateSenderMailbox(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { id } = req.params as { id: string };
        const data = updateSenderMailboxSchema.parse(req.body);
        const mailbox = await SenderMailboxService.updateSenderMailbox(id, req.user!.userId, data);
        await Promise.all([
            CacheService.invalidateVersioned(`version:sender-mailboxes:${req.user!.userId}`),
            CacheService.invalidateVersioned(`version:sender-mailbox:${id}`)
        ]);
        res.status(200).json(mailbox);
    } catch (error) {
        next(error);
    }
}

export async function deleteSenderMailbox(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { id } = req.params as { id: string };
        await SenderMailboxService.deleteSenderMailbox(id, req.user!.userId);
        await Promise.all([
            CacheService.invalidateVersioned(`version:sender-mailboxes:${req.user!.userId}`),
            CacheService.invalidateVersioned(`version:sender-mailbox:${id}`)
        ]);
        res.status(204).send();
    } catch (error) {
        next(error);
    }
}

export async function verifyMailboxConnection(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { id } = req.params as { id: string };
        const result = await SenderMailboxService.verifyMailboxConnection(id, req.user!.userId);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
}

export async function resetMailboxDailyCount(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { id } = req.params as { id: string };
        const mailbox = await SenderMailboxService.resetMailboxDailyCount(id, req.user!.userId);
        await Promise.all([
            CacheService.invalidateVersioned(`version:sender-mailboxes:${req.user!.userId}`),
            CacheService.invalidateVersioned(`version:sender-mailbox:${id}`)
        ]);
        res.status(200).json(mailbox);
    } catch (error) {
        next(error);
    }
}

export async function verifyMailboxDns(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { id } = req.params as { id: string };
        const result = await SenderMailboxService.verifyMailboxDns(id, req.user!.userId);
        await Promise.all([
            CacheService.invalidateVersioned(`version:sender-mailboxes:${req.user!.userId}`),
            CacheService.invalidateVersioned(`version:sender-mailbox:${id}`)
        ]);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
}