import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../auth/auth.types";
import { UserRole } from "@prisma/client";
import { z } from "zod";
import * as UsersService from "./users.service";

const listQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().optional(),
    role: z.nativeEnum(UserRole).optional(),
});

const roleBodySchema = z.object({
    role: z.nativeEnum(UserRole),
});

export async function listUsers(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const query = listQuerySchema.parse(req.query);
        const result = await UsersService.listUsers(query);
        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
}

export async function getUserStats(
    _req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const stats = await UsersService.getUserStats();
        res.status(200).json(stats);
    } catch (error) {
        next(error);
    }
}

export async function updateUserRole(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const { id } = req.params as { id: string };
        const { role } = roleBodySchema.parse(req.body);
        const requesterId = req.user!.userId;
        const updated = await UsersService.updateUserRole(id, role, requesterId);
        res.status(200).json(updated);
    } catch (error) {
        const statusCode = (error as any).statusCode;
        if (statusCode) {
            res.status(statusCode).json({ error: (error as Error).message });
            return;
        }
        next(error);
    }
}

export async function forceLogoutUser(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const { id } = req.params as { id: string };
        const requesterId = req.user!.userId;
        await UsersService.forceLogoutUser(id, requesterId);
        res.status(204).send();
    } catch (error) {
        const statusCode = (error as any).statusCode;
        if (statusCode) {
            res.status(statusCode).json({ error: (error as Error).message });
            return;
        }
        next(error);
    }
}

const updateProfileBodySchema = z.object({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    currentPassword: z.string().min(1).optional(),
    newPassword: z.string().min(8).max(128).optional(),
});

export async function updateProfile(
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction,
): Promise<void> {
    try {
        const data = updateProfileBodySchema.parse(req.body);
        const updated = await UsersService.updateProfile(req.user!.userId, data);
        res.status(200).json(updated);
    } catch (error) {
        const statusCode = (error as any).statusCode;
        if (statusCode) {
            res.status(statusCode).json({ error: (error as Error).message });
            return;
        }
        next(error);
    }
}