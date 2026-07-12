import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../auth/auth.types";
import { logger } from "../../lib/logger";
import {
    getSystemHealth,
    getPlatformStats,
    suspendUser,
    deleteUser,
} from "./admin.service";

export async function systemHealth(
    _req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const health = await getSystemHealth();
        res.json(health);
    } catch (err) {
        next(err);
    }
}

export async function platformStats(
    _req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const stats = await getPlatformStats();
        res.json(stats);
    } catch (err) {
        next(err);
    }
}

export async function suspendUserHandler(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { id } = req.params as { id: string };
        const requesterId = req.user!.userId;
        await suspendUser(id, requesterId);
        logger.info({ targetId: id, requesterId }, "[admin] user suspended");
        res.status(204).send();
    } catch (err) {
        const statusCode = (err as any).statusCode;
        if (statusCode) {
            res.status(statusCode).json({ error: (err as Error).message });
            return;
        }
        next(err);
    }
}

export async function deleteUserHandler(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const { id } = req.params as { id: string };
        const requesterId = req.user!.userId;
        await deleteUser(id, requesterId);
        logger.info({ targetId: id, requesterId }, "[admin] user deleted");
        res.status(204).send();
    } catch (err) {
        const statusCode = (err as any).statusCode;
        if (statusCode) {
            res.status(statusCode).json({ error: (err as Error).message });
            return;
        }
        next(err);
    }
}