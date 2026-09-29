import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { z } from "zod";
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from "../../lib/errors";
import {
  createCampaignSchema,
  updateCampaignSchema,
} from "./campaign.schema";
import { campaignQueue } from "../gemini/campaign.scheduler";

export async function createCampaign(
  data: z.infer<typeof createCampaignSchema>,
  createdById: string,
  orgId: string
) {
  const { provenStats, ...rest } = data;
  return prisma.campaign.create({
    data: {
      ...rest,
      createdById,
      orgId,
      ...(provenStats !== undefined && {
        provenStats: provenStats === null ? Prisma.DbNull : (provenStats as Prisma.InputJsonValue),
      }),
    },
  });
}

export async function getCampaigns(orgId: string) {
  return prisma.campaign.findMany({
    where: {
      orgId,
      deletedAt: null,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      name: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      createdById: true,
      deletedAt: true,
      dailySendLimit: true,
      targetIndustry: true,
      targetRegion: true,
      senderDomain: {
        select: {
          domain: true,
        },
      },
      leads: {
        where: { deletedAt: null },
        select: {
          id: true,
        },
      },
      queueJobs: {
        where: { status: "FAILED" },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { errorMessage: true, result: true },
      },
    },
  });
}

// FIX 6: filter soft-deleted leads in count and paginated include
export async function getCampaignById(
  id: string,
  orgId: string,
  leadsPage: number = 1,
  leadsLimit: number = 50
) {
  const skip = (leadsPage - 1) * leadsLimit;

  return prisma.campaign.findFirst({
    where: {
      id,
      orgId,
      deletedAt: null,
    },
    include: {
      _count: {
        select: {
          leads: { where: { deletedAt: null } },
        },
      },
      leads: {
        where: { deletedAt: null },
        skip,
        take: leadsLimit,
        orderBy: { qualificationScore: "desc" },
        select: { id: true },
      },

      senderMailbox: {
        select: {
          emailAddress: true,
          label: true,
        },
      },
      senderDomain: {
        select: {
          domain: true,
        },
      },
      queueJobs: {
        where: { status: "FAILED" },
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          errorMessage: true,
          result: true,
        },
      },
    },
  });
}

export async function updateCampaign(
  id: string,
  orgId: string,
  data: z.infer<typeof updateCampaignSchema>
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.campaign.findFirst({
      where: { id, orgId, deletedAt: null },
      select: { id: true },
    });

    if (!existing) {
      const exists = await tx.campaign.findUnique({
        where: { id },
        select: { id: true, deletedAt: true },
      });

      if (exists && !exists.deletedAt) {
        throw new ForbiddenError();
      }
      throw new NotFoundError("Campaign");
    }

    const { provenStats, ...rest } = data;
    return tx.campaign.update({
      where: { id },
      data: {
        ...rest,
        ...(provenStats !== undefined && {
          provenStats: provenStats === null ? Prisma.DbNull : (provenStats as Prisma.InputJsonValue),
        }),
      } as Prisma.CampaignUpdateInput,
    });
  });
}

export async function deleteCampaign(
  id: string,
  orgId: string
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.campaign.findFirst({
      where: { id, orgId, deletedAt: null },
      select: { id: true },
    });

    if (!existing) {
      const exists = await tx.campaign.findUnique({
        where: { id },
        select: { id: true, deletedAt: true },
      });

      if (exists && !exists.deletedAt) {
        throw new ForbiddenError();
      }
      throw new NotFoundError("Campaign");
    }

    return tx.campaign.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  });
}

// FIX 8: reinstate sender guard before queueing pipeline
export async function runCampaign(id: string, orgId: string, userId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id, orgId, createdById: userId, deletedAt: null },
    select: {
      id: true,
      status: true,
      name: true,
      senderMailboxId: true,
      senderDomainId: true,
      linkedInAccountId: true,
    },
  });

  if (!campaign) {
    const exists = await prisma.campaign.findFirst({
      where: { id, orgId, deletedAt: null },
      select: { id: true },
    });
    if (exists) throw new ForbiddenError();
    throw new NotFoundError("Campaign");
  }

  const runnableStatuses = ["DRAFT", "FAILED"];
  if (!runnableStatuses.includes(campaign.status)) {
    const err = new Error(
      `Campaign cannot be started from status "${campaign.status}". ` +
      `Only DRAFT or FAILED campaigns can be run. Use /pause or /resume for active campaigns.`
    );
    (err as NodeJS.ErrnoException).code = "NOT_RUNNABLE";
    throw err;
  }

  const leadCount = await prisma.lead.count({
    where: { campaignId: id, deletedAt: null },
  });
  if (leadCount === 0) {
    throw new ValidationError(
      `Campaign "${campaign.name}" has no leads. Add at least one lead before running.`
    );
  }

  if (
    !campaign.senderMailboxId &&
    !campaign.senderDomainId &&
    !campaign.linkedInAccountId
  ) {
    throw new ValidationError(
      `Campaign "${campaign.name}" has no sender configured. ` +
      `Set a senderMailboxId, senderDomainId, or linkedInAccountId before running.`
    );
  }

  const jobId = `run-pipeline-${id}`;
  await campaignQueue.add(
    "run-pipeline",
    { campaignId: id, triggeredBy: userId },
    {
      jobId,
      removeOnComplete: { age: 300 },
      removeOnFail: { age: 3600 },
    }
  );

  return { campaignId: id, jobId, status: campaign.status };
}

const PAUSABLE_STATUSES = ["RESEARCHING", "GENERATING", "REVIEW", "QUEUED", "SENDING"] as const;


export async function pauseCampaign(id: string, orgId: string): Promise<{ campaignId: string; status: string }> {
  return prisma.$transaction(async (tx) => {
    const campaign = await tx.campaign.findFirst({
      where: { id, orgId, status: { in: [...PAUSABLE_STATUSES] }, deletedAt: null },
      select: { id: true, status: true },
    });

    if (!campaign) {
      const exists = await tx.campaign.findFirst({
        where: { id, deletedAt: null },
        select: { id: true, orgId: true, status: true },
      });
      if (!exists) throw new NotFoundError("Campaign");
      if (exists.orgId !== orgId) throw new ForbiddenError();
      throw new ConflictError(`Campaign cannot be paused from status "${exists.status}"`);
    }

    await tx.campaign.update({
      where: { id },
      data: { status: "PAUSED", previousStatus: campaign.status },
    });

    return { campaignId: id, status: "PAUSED" };
  });
}

// FIX 7: null guard for previousStatus — refuses to resume without a recorded prior state
export async function resumeCampaign(
  id: string,
  orgId: string
): Promise<{ campaignId: string; status: string }> {
  const campaign = await prisma.campaign.findFirst({
    where: { id, orgId, status: "PAUSED", deletedAt: null },
    select: { id: true, previousStatus: true },
  });

  if (!campaign) {
    const exists = await prisma.campaign.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, orgId: true, status: true },
    });
    if (!exists) throw new NotFoundError("Campaign");
    if (exists.orgId !== orgId) throw new ForbiddenError();
    throw new ConflictError(`Campaign cannot be resumed from status "${exists.status}"`);
  }

  if (!campaign.previousStatus) {
    throw new ConflictError(
      "Campaign has no previous status recorded — cannot resume safely. Re-run the campaign from DRAFT."
    );
  }

  const updated = await prisma.campaign.updateMany({
    where: { id, orgId, status: "PAUSED", deletedAt: null },
    data: { status: campaign.previousStatus, previousStatus: null },
  });

  if (updated.count === 0) {
    throw new ConflictError("Campaign resume conflict — another request may have already resumed it");
  }

  return { campaignId: id, status: campaign.previousStatus };
}

// FIX 15: replace 7 correlated subqueries with two GROUP BY aggregations + soft-delete filter
export async function getCampaignPipelineStats(campaignId: string, orgId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, orgId, deletedAt: null },
    select: { id: true },
  });
  if (!campaign) {
    const exists = await prisma.campaign.findUnique({
      where: { id: campaignId },
      select: { id: true, deletedAt: true },
    });
    if (exists && !exists.deletedAt) throw new ForbiddenError();
    throw new NotFoundError("Campaign");
  }

  type DeliveryRow = { state: string; cnt: bigint };
  type ApprovalRow = { status: string; cnt: bigint };

  const [leadsTotal, deliveryRows, approvalRows, activeJob] = await Promise.all([
    prisma.lead.count({ where: { campaignId, deletedAt: null } }),
    prisma.$queryRaw<DeliveryRow[]>`
      SELECT om."deliveryState" AS state, COUNT(*) AS cnt
      FROM "OutreachMessage" om
      JOIN "Lead" l ON l.id = om."leadId"
      WHERE l."campaignId" = ${campaignId}
        AND l."deletedAt" IS NULL
      GROUP BY om."deliveryState"
    `,
    prisma.$queryRaw<ApprovalRow[]>`
      SELECT om."approvalStatus" AS status, COUNT(*) AS cnt
      FROM "OutreachMessage" om
      JOIN "Lead" l ON l.id = om."leadId"
      WHERE l."campaignId" = ${campaignId}
        AND l."deletedAt" IS NULL
      GROUP BY om."approvalStatus"
    `,
    prisma.queueJob.findFirst({
      where: { campaignId, status: "ACTIVE" },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        queueName: true,
        jobType: true,
        status: true,
        attempts: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  ]);

  const d = new Map(deliveryRows.map((r) => [r.state, Number(r.cnt)]));
  const a = new Map(approvalRows.map((r) => [r.status, Number(r.cnt)]));

  const emailsSent =
    (d.get("SENT") ?? 0) +
    (d.get("DELIVERED") ?? 0) +
    (d.get("OPENED") ?? 0) +
    (d.get("REPLIED") ?? 0);

  const emailsOpened = (d.get("OPENED") ?? 0) + (d.get("REPLIED") ?? 0);

  return {
    leadsTotal,
    messagesGenerated:
      (a.get("APPROVED") ?? 0) +
      (a.get("PENDING") ?? 0) +
      (a.get("REJECTED") ?? 0),
    messagesApproved: a.get("APPROVED") ?? 0,
    messagesPending: a.get("PENDING") ?? 0,
    messagesRejected: a.get("REJECTED") ?? 0,
    emailsQueued: d.get("QUEUED") ?? 0,
    emailsSent,
    emailsDelivered: d.get("DELIVERED") ?? 0,
    emailsOpened,
    emailsReplied: d.get("REPLIED") ?? 0,
    emailsBounced: d.get("BOUNCED") ?? 0,
    activeJob: activeJob ?? null,
  };
}

export async function getCampaignPreflight(id: string, orgId: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id, orgId, deletedAt: null },
    select: {
      id: true,
      senderMailboxId: true,
      senderDomainId: true,
      linkedInAccountId: true,
      senderMailbox: {
        select: {
          id: true,
          health: true,
          emailAddress: true,
        }
      },
      senderDomain: {
        select: {
          id: true,
          health: true,
          domain: true,
          spfValid: true,
          dkimValid: true,
          dmarcValid: true,
        }
      },
      linkedInAccount: {
        select: {
          id: true,
          name: true,
        }
      }
    }
  });

  if (!campaign) {
    throw new NotFoundError("Campaign");
  }

  const [leadCount, stepCount] = await Promise.all([
    prisma.lead.count({ where: { campaignId: id, deletedAt: null } }),
    prisma.sequenceStep.count({ where: { campaignId: id } }),
  ]);

  const checks = {
    leads: {
      valid: leadCount > 0,
      count: leadCount,
    },
    sequence: {
      valid: stepCount > 0,
      count: stepCount,
    },
    sender: {
      configured: !!(campaign.senderMailboxId || campaign.senderDomainId || campaign.linkedInAccountId),
      type: campaign.senderMailboxId ? "mailbox" : campaign.senderDomainId ? "domain" : campaign.linkedInAccountId ? "linkedin" : "none",
      valid: false,
      details: null as any,
    },
    dns: {
      valid: false,
      spf: false,
      dkim: false,
      dmarc: false,
    }
  };

  if (campaign.senderMailbox) {
    const mailbox = campaign.senderMailbox;
    const healthOk = mailbox.health === "HEALTHY" || mailbox.health === "WARNING";
    checks.sender.valid = healthOk;
    checks.sender.details = { id: mailbox.id, email: mailbox.emailAddress, health: mailbox.health };
    if (campaign.senderDomain) {
      checks.dns.spf = !!campaign.senderDomain.spfValid;
      checks.dns.dkim = !!campaign.senderDomain.dkimValid;
      checks.dns.dmarc = !!campaign.senderDomain.dmarcValid;
      checks.dns.valid = checks.dns.spf && checks.dns.dkim && checks.dns.dmarc;
    } else {
      checks.dns.spf = false;
      checks.dns.dkim = false;
      checks.dns.dmarc = false;
      checks.dns.valid = false;
    }
  } else if (campaign.senderDomain) {
    const domain = campaign.senderDomain;
    const healthOk = domain.health === "HEALTHY" || domain.health === "WARNING";
    checks.sender.valid = healthOk;
    checks.sender.details = { id: domain.id, domain: domain.domain, health: domain.health };
    checks.dns.spf = !!domain.spfValid;
    checks.dns.dkim = !!domain.dkimValid;
    checks.dns.dmarc = !!domain.dmarcValid;
    checks.dns.valid = checks.dns.spf && checks.dns.dkim && checks.dns.dmarc;
  } else if (campaign.linkedInAccount) {
    checks.sender.valid = true;
    checks.sender.details = { id: campaign.linkedInAccount.id, name: campaign.linkedInAccount.name, health: "HEALTHY" };
    checks.dns.valid = true;
  }

  const ready = checks.leads.valid && checks.sequence.valid && checks.sender.valid && checks.dns.valid;

  return { ready, checks };
}