import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../auth/auth.types";
import * as NotificationsService from "./notifications.service";

export async function listNotifications(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const orgId = req.user!.orgId!;
        const list = await NotificationsService.listNotifications(orgId);
        res.status(200).json(list);
    } catch (error) {
        next(error);
    }
}

export async function markAsRead(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const orgId = req.user!.orgId!;
        const { id } = req.params as { id: string };
        const result = await NotificationsService.markAsRead(id, orgId);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
}

export async function markAllAsRead(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const orgId = req.user!.orgId!;
        await NotificationsService.markAllAsRead(orgId);
        res.status(204).end();
    } catch (error) {
        next(error);
    }
}
