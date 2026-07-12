import { prisma } from "../../lib/prisma";
import { z } from "zod";
import { NotFoundError, ForbiddenError, ValidationError, ConflictError } from "../../lib/errors";
import {
  createCampaignSchema,
  updateCampaignSchema,
} from "./campaign.shema";
import { campaignQueue } from "../gemini/campaign.scheduler";

export async function createCampaign(
  data: z.infer<typeof createCampaignSchema>,
  createdById: string
) {
  return prisma.campaign.create({
    data: {
      ...data,
      createdById,
    },
  });
}

export async function getCampaigns(createdById: string) {
  return prisma.campaign.findMany({
    where: {
      createdById,
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
    },
  });
}

// FIX 6: filter soft-deleted leads in count and paginated include
export async function getCampaignById(
  id: string,
  createdById: string,
  leadsPage: number = 1,
  leadsLimit: number = 50
) {
  const skip = (leadsPage - 1) * leadsLimit;

  return prisma.campaign.findFirst({
    where: {
      id,
      createdById,
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
        },
      },
    },
  });
}

export async function updateCampaign(
  id: string,
  createdById: string,
  data: z.infer<typeof updateCampaignSchema>
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.campaign.findFirst({
      where: { id, createdById, deletedAt: null },
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

    return tx.campaign.update({ where: { id }, data });
  });
}

export async function deleteCampaign(
  id: string,
  createdById: string
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.campaign.findFirst({
      where: { id, createdById, deletedAt: null },
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
export async function runCampaign(id: string, createdById: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id, createdById, deletedAt: null },
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
    const exists = await prisma.campaign.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (exists && !exists.deletedAt) throw new ForbiddenError();
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
    { campaignId: id, triggeredBy: createdById },
    {
      jobId,
      removeOnComplete: { age: 300 },
      removeOnFail: { age: 3600 },
    }
  );

  return { campaignId: id, jobId, status: campaign.status };
}

const PAUSABLE_STATUSES = ["RESEARCHING", "GENERATING", "REVIEW", "QUEUED", "SENDING"] as const;

type PausedRow = { id: string; status: string; previousStatus: string };
type ResumedRow = { id: string; status: string };

export async function pauseCampaign(id: string, createdById: string): Promise<{ campaignId: string; status: string }> {
  const rows = await prisma.$queryRaw<PausedRow[]>`
    UPDATE "Campaign"
    SET
      status            = 'PAUSED'::"CampaignStatus",
      "previousStatus"  = status,
      "updatedAt"       = NOW()
    WHERE
      id               = ${id}
      AND "createdById" = ${createdById}
      AND status        = ANY(ARRAY['RESEARCHING','GENERATING','REVIEW','QUEUED','SENDING']::"CampaignStatus"[])
      AND "deletedAt"   IS NULL
    RETURNING id, status, "previousStatus"
  `;

  if (rows.length === 0) {
    const exists = await prisma.campaign.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, createdById: true, status: true },
    });
    if (!exists) throw new NotFoundError("Campaign");
    if (exists.createdById !== createdById) throw new ForbiddenError();
    throw new ConflictError(`Campaign cannot be paused from status "${exists.status}"`);
  }

  return { campaignId: rows[0].id, status: rows[0].status };
}

// FIX 7: null guard for previousStatus — refuses to resume without a recorded prior state
export async function resumeCampaign(
  id: string,
  createdById: string
): Promise<{ campaignId: string; status: string }> {
  const campaign = await prisma.campaign.findFirst({
    where: { id, createdById, status: "PAUSED", deletedAt: null },
    select: { id: true, previousStatus: true },
  });

  if (!campaign) {
    const exists = await prisma.campaign.findFirst({
      where: { id, deletedAt: null },
      select: { id: true, createdById: true, status: true },
    });
    if (!exists) throw new NotFoundError("Campaign");
    if (exists.createdById !== createdById) throw new ForbiddenError();
    throw new ConflictError(`Campaign cannot be resumed from status "${exists.status}"`);
  }

  if (!campaign.previousStatus) {
    throw new ConflictError(
      "Campaign has no previous status recorded — cannot resume safely. Re-run the campaign from DRAFT."
    );
  }

  const rows = await prisma.$queryRaw<ResumedRow[]>`
    UPDATE "Campaign"
    SET
      status           = ${campaign.previousStatus}::"CampaignStatus",
      "previousStatus" = NULL,
      "updatedAt"      = NOW()
    WHERE
      id               = ${id}
      AND "createdById" = ${createdById}
      AND status        = 'PAUSED'::"CampaignStatus"
      AND "deletedAt"   IS NULL
    RETURNING id, status
  `;

  if (rows.length === 0) {
    throw new ConflictError("Campaign resume conflict — another request may have already resumed it");
  }

  return { campaignId: rows[0].id, status: rows[0].status };
}

// FIX 15: replace 7 correlated subqueries with two GROUP BY aggregations + soft-delete filter
export async function getCampaignPipelineStats(campaignId: string, createdById: string) {
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, createdById, deletedAt: null },
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