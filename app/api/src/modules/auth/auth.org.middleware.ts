import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "./auth.types";
import { OrgRole } from "@prisma/client";

export function requireOrgRole(...roles: OrgRole[]) {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
        if (!req.user?.orgId) {
            res.status(403).json({ error: "No workspace associated with this account" });
            return;
        }
        const orgRole = req.user.orgRole as OrgRole | undefined;
        if (!orgRole || !roles.includes(orgRole)) {
            res.status(403).json({ error: "Insufficient workspace permissions" });
            return;
        }
        next();
    };
}

export function requireOrgMembership(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
    if (!req.user?.orgId) {
        res.status(403).json({ error: "No workspace associated with this account" });
        return;
    }
    next();
}

export const requireOrgOwner = requireOrgRole(OrgRole.OWNER);
export const requireOrgAdmin = requireOrgRole(OrgRole.OWNER, OrgRole.ADMIN);
export const requireOrgMember = requireOrgRole(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.MEMBER);
export const requireAnyOrgRole = requireOrgRole(OrgRole.OWNER, OrgRole.ADMIN, OrgRole.MEMBER, OrgRole.VIEWER);
