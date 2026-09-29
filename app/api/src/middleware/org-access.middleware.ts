/**
 * Org Access Guard Middleware
 *
 * Reusable middleware factory that ensures the authenticated user belongs
 * to the organization that owns the resource identified by :id param.
 *
 * Usage:
 *   router.get("/:id", authMiddleware, orgAccessGuard("campaign"), handler)
 *   router.put("/:id", authMiddleware, orgAccessGuard("senderMailbox"), handler)
 *
 * Authorization model:
 *   User → Membership → Organization → Resource.orgId must match.
 *   createdById is metadata only — NOT an authorization boundary.
 */

import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../modules/auth/auth.types";
import { prisma } from "../lib/prisma";
import { logger } from "../lib/logger";

export type GuardableResource =
  | "campaign"
  | "lead"
  | "senderMailbox"
  | "senderDomain"
  | "crmIntegration"
  | "brandSettings"
  | "linkedInAccount"
  | "suppression";

/**
 * Resolves the owning orgId for a given resource type and ID.
 * Returns null if the resource does not exist.
 */
async function resolveResourceOrgId(
  resourceType: GuardableResource,
  resourceId: string,
): Promise<string | null> {
  switch (resourceType) {
    case "campaign": {
      const r = await prisma.campaign.findUnique({
        where: { id: resourceId },
        select: { orgId: true },
      });
      return r?.orgId ?? null;
    }

    case "lead": {
      // Lead doesn't have orgId directly — resolve through campaign
      const r = await prisma.lead.findUnique({
        where: { id: resourceId },
        select: { campaign: { select: { orgId: true } } },
      });
      return r?.campaign?.orgId ?? null;
    }

    case "senderMailbox": {
      const r = await prisma.senderMailbox.findUnique({
        where: { id: resourceId },
        select: { orgId: true },
      });
      return r?.orgId ?? null;
    }

    case "senderDomain": {
      const r = await prisma.senderDomain.findUnique({
        where: { id: resourceId },
        select: { orgId: true },
      });
      return r?.orgId ?? null;
    }

    case "crmIntegration": {
      const r = await prisma.crmIntegration.findUnique({
        where: { id: resourceId },
        select: { orgId: true },
      });
      return r?.orgId ?? null;
    }

    case "brandSettings": {
      const r = await prisma.brandSettings.findUnique({
        where: { id: resourceId },
        select: { orgId: true },
      });
      return r?.orgId ?? null;
    }

    case "linkedInAccount": {
      const r = await prisma.linkedInAccount.findUnique({
        where: { id: resourceId },
        select: { orgId: true },
      });
      return r?.orgId ?? null;
    }

    case "suppression": {
      const r = await prisma.suppression.findUnique({
        where: { id: resourceId },
        select: { orgId: true },
      });
      return r?.orgId ?? null;
    }

    default: {
      // Exhaustive check
      const _exhaustive: never = resourceType;
      throw new Error(`Unknown resource type: ${_exhaustive}`);
    }
  }
}

/**
 * Express middleware factory.
 *
 * @param resourceType - The type of resource being accessed
 * @param paramName - The request param containing the resource ID (default: "id")
 */
export function orgAccessGuard(
  resourceType: GuardableResource,
  paramName: string = "id",
) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const resourceId = req.params[paramName] as string | undefined;
    const orgId = req.user?.orgId;

    if (!orgId) {
      return res.status(403).json({ error: "Organization context required" });
    }

    if (!resourceId) {
      return res.status(400).json({ error: `Missing parameter: ${paramName}` });
    }

    try {
      const resourceOrgId = await resolveResourceOrgId(resourceType, resourceId);

      if (!resourceOrgId) {
        return res.status(404).json({ error: `${resourceType} not found` });
      }

      if (resourceOrgId !== orgId) {
        logger.warn(
          { resourceType, resourceId, userOrgId: orgId, resourceOrgId },
          "[org-access-guard] Cross-tenant access denied",
        );
        return res.status(403).json({ error: "Forbidden" });
      }

      next();
    } catch (err) {
      logger.error(
        { resourceType, resourceId, err },
        "[org-access-guard] Failed to resolve resource ownership",
      );
      const correlationId = res.getHeader("X-Correlation-ID") as string | undefined;
      return res.status(500).json({
        error: "Internal server error",
        ...(correlationId ? { correlationId } : {}),
      });
    }
  };
}
