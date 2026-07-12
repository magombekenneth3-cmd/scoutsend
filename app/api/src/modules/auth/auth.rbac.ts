import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "./auth.types";
import { UserRole } from "@prisma/client";

export function requireRole(...roles: UserRole[]) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
        const userRole = req.user?.role as UserRole | undefined;
        if (!userRole || !roles.includes(userRole)) {
            res.status(403).json({ error: "Forbidden" });
            return;
        }
        next();
    };
}

export const requireAdmin = requireRole(UserRole.ADMIN);
export const requireReviewerOrAdmin = requireRole(UserRole.ADMIN, UserRole.REVIEWER);
export const requireOperatorOrAbove = requireRole(UserRole.ADMIN, UserRole.REVIEWER, UserRole.OPERATOR);