import { prisma } from "./prisma";
import { NotFoundError, ForbiddenError } from "./errors";

export async function assertCampaignOwner(
  campaignId: string,
  userId: string
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
  userId: string
): Promise<void> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { campaign: { select: { createdById: true } } },
  });

  if (!lead) throw new NotFoundError("Lead");
  if (lead.campaign.createdById !== userId) throw new ForbiddenError();
}