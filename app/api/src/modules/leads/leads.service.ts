import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { NotFoundError, ConflictError } from "../../lib/errors";
import {
  createLeadSchema,
  updateLeadSchema,
  getLeadsQuerySchema,
} from "./leads.schema";
import { extractDomain } from "../../lib/company/company.upsert";

export const physicalLeadSelect = {
  id: true,
  campaignId: true,
  companyId: true,
  firstName: true,
  lastName: true,
  email: true,
  title: true,
  companyName: true,
  website: true,
  linkedinUrl: true,
  department: true,
  seniority: true,
  location: true,
  country: true,
  city: true,
  state: true,
  timezone: true,
  emailStatus: true,
  emailSource: true,
  emailVerified: true,
  qualificationScore: true,
  qualificationReason: true,
  recommendedAction: true,
  pipelineStage: true,
  status: true,
  source: true,
  enrichmentData: true,
  enrichmentAttempts: true,
  lastEnrichedAt: true,
  breakdownScores: true,
  domain: true,
  externalId: true,
  competitorSignal: true,
  competitorTech: true,
  customAttributes: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
};

export async function createLead(data: z.infer<typeof createLeadSchema>) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: data.campaignId },
    select: { id: true },
  });

  if (!campaign) throw new NotFoundError("Campaign");

  const domain = extractDomain(data.website) || (data.email ? data.email.split("@")[1]?.toLowerCase() : null);

  try {
    return await prisma.lead.create({
      data: {
        ...data,
        domain,
        emailStatus: data.email ? "FOUND" : "NOT_ATTEMPTED",
        ...(data.email && { emailSource: "USER_PROVIDED", emailVerified: false }),
      },
      select: physicalLeadSelect,
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new ConflictError(
        "A lead with this email or domain already exists in this campaign"
      );
    }
    throw err;
  }
}

export async function getLeads(query: z.infer<typeof getLeadsQuerySchema> & { userId?: string }) {
  const { campaignId, page, limit, search, competitorSignal, recommendedAction, minScore, pipelineStage, emailStatus, userId } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.LeadWhereInput = {
    deletedAt: null,
    ...(campaignId ? { campaignId } : userId ? { campaign: { createdById: userId } } : {}),
    ...(search && {
      OR: [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
        { companyName: { contains: search, mode: "insensitive" } },
      ],
    }),
    ...(competitorSignal !== undefined && { competitorSignal }),
    ...(recommendedAction ? { recommendedAction: recommendedAction as Prisma.LeadWhereInput['recommendedAction'] } : {}),
    ...(pipelineStage ? { pipelineStage: pipelineStage as Prisma.LeadWhereInput['pipelineStage'] } : {}),
    ...(emailStatus ? { emailStatus: emailStatus as Prisma.LeadWhereInput['emailStatus'] } : {}),
    ...(minScore !== undefined ? { qualificationScore: { gte: minScore > 1 ? minScore / 100 : minScore } } : {}),
  };

  const [leads, total] = await prisma.$transaction([
    prisma.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        title: true,
        companyName: true,
        website: true,
        linkedinUrl: true,
        qualificationScore: true,
        qualificationReason: true,
        recommendedAction: true,
        pipelineStage: true,
        emailStatus: true,
        emailVerified: true,
        breakdownScores: true,
        enrichmentData: true,
        lastEnrichedAt: true,
        competitorSignal: true,
        competitorTech: true,
        createdAt: true,
        signals: true,
        campaign: { select: { id: true, name: true, status: true } },
        outreachMessages: {
          select: {
            id: true,
            approvalStatus: true,
            deliveryState: true,
            sentAt: true,
          },
        },
        stepStatuses: {
          select: {
            id: true,
            status: true,
          },
        },
        _count: { select: { outreachMessages: true, replies: true } },
      },
    }),
    prisma.lead.count({ where }),
  ]);

  return {
    data: leads,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

export async function getLeadById(leadId: string) {
  return prisma.lead.findFirst({
    where: { id: leadId, deletedAt: null },
    select: {
      ...physicalLeadSelect,
      signals: { orderBy: { createdAt: "desc" } },
      outreachMessages: {
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          subject: true,
          approvalStatus: true,
          deliveryState: true,
          spamRiskScore: true,
          personalizationScore: true,
          sentAt: true,
          openedAt: true,
          repliedAt: true,
          createdAt: true,
        },
      },
      replies: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          intent: true,
          sentimentScore: true,
          requiresHumanReview: true,
          createdAt: true,
        },
      },
      campaign: {
        select: { id: true, name: true, status: true },
      },
    },
  });
}

export async function updateLead(
  leadId: string,
  data: z.infer<typeof updateLeadSchema>
) {
  let domain: string | null | undefined = undefined;
  if (data.website !== undefined || data.email !== undefined) {
    const currentLead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { website: true, email: true },
    });
    if (currentLead) {
      const website = data.website !== undefined ? data.website : currentLead.website;
      const email = data.email !== undefined ? data.email : currentLead.email;
      domain = extractDomain(website) || (email ? email.split("@")[1]?.toLowerCase() : null);
    }
  }

  const emailStatusOverride =
    data.email !== undefined
      ? data.email
        ? ("FOUND" as const)
        : ("NOT_ATTEMPTED" as const)
      : undefined;

  return prisma.lead.update({
    where: { id: leadId },
    data: {
      ...data,
      ...(domain !== undefined && { domain }),
      ...(emailStatusOverride !== undefined && { emailStatus: emailStatusOverride }),
      enrichmentData: data.enrichmentData as Prisma.InputJsonValue,
    },
    select: {
      ...physicalLeadSelect,
      signals: true,
      campaign: { select: { id: true, name: true, status: true } },
    },
  });
}

export async function deleteLead(leadId: string) {
  return prisma.lead.update({
    where: { id: leadId },
    data: {
      deletedAt: new Date(),
      enrichmentData: Prisma.JsonNull,
    },
    select: { id: true, campaignId: true, email: true },
  });
}