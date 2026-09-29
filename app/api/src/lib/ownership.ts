import { prisma } from "./prisma";
import { NotFoundError, ForbiddenError } from "./errors";
import { OrgRole } from "@prisma/client";

const WRITE_ROLES: OrgRole[] = [OrgRole.OWNER, OrgRole.ADMIN, OrgRole.MEMBER];
const DELETE_ROLES: OrgRole[] = [OrgRole.OWNER, OrgRole.ADMIN];

export async function assertCampaignAccess(
  campaignId: string,
  userId: string,
  orgId: string | undefined,
  requiredRoles: OrgRole[] = WRITE_ROLES,
): Promise<void> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId },
    select: { createdById: true, orgId: true },
  });

  if (!campaign) throw new NotFoundError("Campaign");

  if (campaign.orgId && orgId && campaign.orgId === orgId) {
    const membership = await prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId } },
      select: { role: true },
    });
    if (!membership || !requiredRoles.includes(membership.role)) throw new ForbiddenError();
    return;
  }

  if (campaign.createdById !== userId) throw new ForbiddenError();
}

export async function assertCampaignOwner(
  campaignId: string,
  userId: string,
): Promise<void> {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId },
    select: { createdById: true },
  });
  if (!campaign) throw new NotFoundError("Campaign");
  if (campaign.createdById !== userId) throw new ForbiddenError();
}

export async function assertLeadOwnership(
  leadId: string,
  userId: string,
): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { campaign: { select: { createdById: true } } },
  });

  if (!lead) throw new NotFoundError("Lead");
  if (lead.campaign.createdById !== userId) throw new ForbiddenError();
}

export function canDelete(orgRole: OrgRole | undefined): boolean {
  return !!orgRole && DELETE_ROLES.includes(orgRole);
}