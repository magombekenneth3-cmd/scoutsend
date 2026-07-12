import { randomUUID } from "crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import {
  createOutreachMessageSchema,
  editOutreachMessageSchema,
  getOutreachMessagesQuerySchema,
} from "./message.schema";
import { campaignQueue } from "../gemini/campaign.scheduler";
import { NotFoundError, ConflictError } from "../../lib/errors";
import { createLearningEvent } from "../learning/learning.service";
import { LEARNING_EVENT_TYPES, LEARNING_OUTCOMES } from "../../lib/constants";
import { logger } from "../../lib/logger";
import { createMailProvider, MailboxCredentials, SendResult, OutlookCredentials } from "../../lib/mail";
import { decryptJson, isEncrypted, encryptJson } from "../../lib/mail/crypto";
import { buildListUnsubscribeHeaders, renderEmailTemplate, TemplateStyle } from "../../lib/emailTemplate";
import { getBrandSettingsOrDefault } from "../brandSettings/brandsettings.service";
import { reserveDailyCapacity } from "../../lib/daily-quota";
import { redis } from "../../lib/ioredis";
import { CacheService } from "../../lib/cache";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function decryptCredentials(raw: unknown): MailboxCredentials {
  if (isEncrypted(raw)) return decryptJson<MailboxCredentials>(raw as string);
  return raw as MailboxCredentials;
}

const GREETING_RE = /^(?:Hi|Hello|Hey|Dear)\b.{0,60}[,.]?\s*$/im;
const CLOSING_RE = /^(?:Best|Regards|Sincerely|Cheers|Thanks|Thank you|Kind regards|Warm regards)[,.]?\s*$/im;

function parseBody(raw: string) {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const greetingIdx = lines.findIndex((l) => GREETING_RE.test(l));
  if (greetingIdx !== -1) {
    const reversedClosingIdx = [...lines].reverse().findIndex((l) => CLOSING_RE.test(l));
    const closingIdx = reversedClosingIdx >= 0 ? lines.length - 1 - reversedClosingIdx : -1;
    const bodyStart = greetingIdx + 1;
    const bodyEnd = closingIdx > bodyStart ? closingIdx : lines.length;
    return {
      greeting: lines[greetingIdx],
      opening: "",
      body: lines.slice(bodyStart, bodyEnd).join("\n"),
      ctaText: "Let's connect",
      closing: closingIdx > 0 ? lines.slice(closingIdx).join("\n") : "Best,",
    };
  }
  return { greeting: "Hi there,", opening: "", body: raw, ctaText: "Let's connect", closing: "Best," };
}

const outreachMessageInclude = {
  lead: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      companyName: true,
      campaignId: true,
    },
  },
  approvedBy: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
} satisfies Prisma.OutreachMessageInclude;

export async function createOutreachMessage(
  data: z.infer<typeof createOutreachMessageSchema>
) {
  const lead = await prisma.lead.findUnique({
    where: { id: data.leadId },
    select: { id: true },
  });

  if (!lead) throw new NotFoundError("Lead");

  return prisma.outreachMessage.create({
    data,
    include: outreachMessageInclude,
  });
}

export async function getOutreachMessages(
  query: z.infer<typeof getOutreachMessagesQuerySchema>,
  userId: string
) {
  const { leadId, campaignId, approvalStatus, deliveryState, page, limit } = query;
  const skip = (page - 1) * limit;
  const orderBy = { createdAt: "desc" as const };

  const where: Prisma.OutreachMessageWhereInput = {
    lead: {
      campaign: { createdById: userId },
      deletedAt: null,
      ...(leadId && { id: leadId }),
      ...(campaignId && { campaignId }),
    },
    ...(approvalStatus && { approvalStatus }),
    ...(deliveryState && { deliveryState }),
  };

  const [total, pageIds] = await Promise.all([
    prisma.outreachMessage.count({ where }),
    prisma.outreachMessage.findMany({ where, select: { id: true }, orderBy, skip, take: limit }),
  ]);

  if (pageIds.length === 0) {
    return { data: [], meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  const messages = await prisma.outreachMessage.findMany({
    where: { id: { in: pageIds.map((m: { id: string }) => m.id) } },
    orderBy,
    include: {
      ...outreachMessageInclude,
      _count: { select: { replies: true } },
    },
  });

  return {
    data: messages,
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

export async function getOutreachMessageById(id: string, userId: string) {
  return prisma.outreachMessage.findFirst({
    where: {
      id,
      lead: { campaign: { createdById: userId } },
    },
    include: {
      ...outreachMessageInclude,
      replies: { orderBy: { createdAt: "desc" } },
    },
  });
}

export async function editOutreachMessage(
  id: string,
  data: z.infer<typeof editOutreachMessageSchema>,
  userId: string
) {
  const existing = await prisma.outreachMessage.findFirst({
    where: {
      id,
      lead: { campaign: { createdById: userId } },
    },
    select: {
      id: true,
      subject: true,
      body: true,
      originalSubject: true,
      originalBody: true,
      approvalStatus: true,
    },
  });

  if (!existing) throw new NotFoundError("Message");
  if (existing.approvalStatus === "APPROVED") {
    throw new ConflictError("Cannot edit an approved message");
  }

  const updated = await prisma.outreachMessage.updateMany({
    where: {
      id,
      approvalStatus: { not: "APPROVED" },
      lead: { campaign: { createdById: userId } },
    },
    data: {
      ...(data.subject && { subject: data.subject }),
      ...(data.body && { body: data.body }),
      originalSubject: existing.originalSubject ?? existing.subject,
      originalBody: existing.originalBody ?? existing.body,
      diffVector: buildDiffVector(existing, data),
    },
  });

  if (updated.count === 0) {
    throw new ConflictError("Message was approved concurrently, edit rejected");
  }

  return prisma.outreachMessage.findUniqueOrThrow({
    where: { id },
    include: outreachMessageInclude,
  });
}

export async function approveOutreachMessage(id: string, approverId: string) {
  const result = await prisma.$transaction(async (tx) => {
    const existing = await tx.outreachMessage.findFirst({
      where: {
        id,
        lead: { campaign: { createdById: approverId } },
      },
      select: {
        id: true,
        approvalStatus: true,
        subject: true,
        body: true,
        originalSubject: true,
        originalBody: true,
        spamRiskScore: true,
        personalizationScore: true,
        lead: {
          select: {
            campaignId: true,
            campaign: {
              select: { icpDescription: true, targetIndustry: true, targetRegion: true },
            },
          },
        },
      },
    });

    if (!existing) throw new NotFoundError("Message");
    if (existing.approvalStatus !== "PENDING") {
      throw new ConflictError(`Message is already ${existing.approvalStatus.toLowerCase()}`);
    }

    const updated = await tx.outreachMessage.updateMany({
      where: { id, approvalStatus: "PENDING" },
      data: {
        approvalStatus: "APPROVED",
        approvedById: approverId,
        deliveryState: "QUEUED",
      },
    });

    if (updated.count === 0) {
      throw new ConflictError("Message was already processed by a concurrent request");
    }

    const message = await tx.outreachMessage.findUniqueOrThrow({
      where: { id },
      include: outreachMessageInclude,
    });

    const campaignId = existing.lead?.campaignId ?? message.lead.campaignId;

    if (campaignId) {
      await tx.campaign.updateMany({
        where: {
          id: campaignId,
          status: { in: ["REVIEW", "PAUSED", "SENDING", "COMPLETED"] },
        },
        data: { status: "QUEUED" },
      });
    }

    // Determine whether a human edited the body/subject before approving
    const wasEdited =
      (existing.originalSubject != null && existing.originalSubject !== existing.subject) ||
      (existing.originalBody != null && existing.originalBody !== existing.body);

    const diff: Record<string, { from: string; to: string }> = {};
    if (wasEdited) {
      if (existing.originalSubject && existing.originalSubject !== existing.subject) {
        diff.subject = { from: existing.originalSubject, to: existing.subject };
      }
      if (existing.originalBody && existing.originalBody !== existing.body) {
        diff.body = { from: existing.originalBody, to: existing.body };
      }
    }

    return { message, campaignId, wasEdited, diff, existing };
  });

  // Fire-and-forget: capture learning event for the closed-loop self-tuning system
  createLearningEvent({
    eventType: result.wasEdited
      ? LEARNING_EVENT_TYPES.HUMAN_EDITED
      : LEARNING_EVENT_TYPES.HUMAN_APPROVED,
    originalOutput: JSON.stringify({
      subject: result.existing.originalSubject ?? result.existing.subject,
      body: result.existing.originalBody ?? result.existing.body,
    }),
    modifiedOutput: JSON.stringify({
      subject: result.existing.subject,
      body: result.existing.body,
    }),
    diffVector: result.wasEdited ? result.diff as any : undefined,
    outcome: result.wasEdited
      ? LEARNING_OUTCOMES.EDITED_AND_APPROVED
      : LEARNING_OUTCOMES.APPROVED,
    outreachMessageId: id,
    metadata: {
      resolvedBy: approverId,
      wasEdited: result.wasEdited,
      spamRiskScore: result.existing.spamRiskScore ?? undefined,
      personalizationScore: result.existing.personalizationScore ?? undefined,
      icpDescription: result.existing.lead?.campaign?.icpDescription,
      targetIndustry: result.existing.lead?.campaign?.targetIndustry ?? undefined,
      targetRegion: result.existing.lead?.campaign?.targetRegion ?? undefined,
    },
  }).catch((err) =>
    logger.warn({ err, messageId: id }, "[message.service] Non-fatal: LearningEvent capture failed")
  );

  if (result.campaignId) {
    const jobId = `send-batch-${result.campaignId}`;
    const existingJob = await campaignQueue.getJob(jobId);
    if (!existingJob) {
      await campaignQueue.add(
        "send-batch",
        { campaignId: result.campaignId },
        {
          jobId,
          removeOnComplete: { age: 300 },
          removeOnFail: { age: 3600 },
        }
      );
    }
  }

  if (result.campaignId) {
    await Promise.all([
      CacheService.invalidateVersioned(`version:campaigns:${approverId}`),
      CacheService.invalidateVersioned(`version:campaign:${result.campaignId}`),
    ]).catch(() => null);
  }

  return result.message;
}

export async function rejectOutreachMessage(id: string, approverId: string) {
  const existing = await prisma.outreachMessage.findFirst({
    where: {
      id,
      lead: { campaign: { createdById: approverId } },
    },
    select: {
      id: true,
      subject: true,
      body: true,
      approvalStatus: true,
    },
  });

  if (!existing) throw new NotFoundError("Message");
  if (existing.approvalStatus !== "PENDING") {
    throw new ConflictError(`Message is already ${existing.approvalStatus.toLowerCase()}`);
  }

  const updated = await prisma.outreachMessage.updateMany({
    where: { id, approvalStatus: "PENDING" },
    data: {
      approvalStatus: "REJECTED",
      approvedById: approverId,
    },
  });

  if (updated.count === 0) {
    throw new ConflictError("Message was already processed by a concurrent request");
  }

  // Fire-and-forget: capture rejection for self-tuning
  createLearningEvent({
    eventType: LEARNING_EVENT_TYPES.HUMAN_REJECTED,
    originalOutput: JSON.stringify({ subject: existing.subject, body: existing.body }),
    modifiedOutput: "",
    outcome: LEARNING_OUTCOMES.DISMISSED,
    outreachMessageId: id,
    metadata: { rejectedBy: approverId },
  }).catch((err) =>
    logger.warn({ err, messageId: id }, "[message.service] Non-fatal: LearningEvent capture failed")
  );

  const message = await prisma.outreachMessage.findUniqueOrThrow({
    where: { id },
    include: outreachMessageInclude,
  });

  if (message.lead.campaignId) {
    await Promise.all([
      CacheService.invalidateVersioned(`version:campaigns:${approverId}`),
      CacheService.invalidateVersioned(`version:campaign:${message.lead.campaignId}`),
    ]).catch(() => null);
  }

  return message;
}

export async function getChartStats(campaignId: string, days: number) {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  since.setUTCHours(0, 0, 0, 0);

  type ChartRow = { day: Date; sent: number; opens: number; replies: number };

  const rows = (await prisma.$queryRaw(
    Prisma.sql`
    SELECT
      DATE(COALESCE(m."sentAt", m."openedAt", m."repliedAt")) AS day,
      COUNT(*) FILTER (WHERE m."sentAt"    >= ${since})::int AS sent,
      COUNT(*) FILTER (WHERE m."openedAt"  >= ${since})::int AS opens,
      COUNT(*) FILTER (WHERE m."repliedAt" >= ${since})::int AS replies
    FROM "OutreachMessage" m
    INNER JOIN "Lead" l ON l."id" = m."leadId"
    WHERE l."campaignId" = ${campaignId}
      AND (
        m."sentAt"    >= ${since} OR
        m."openedAt"  >= ${since} OR
        m."repliedAt" >= ${since}
      )
    GROUP BY DATE(COALESCE(m."sentAt", m."openedAt", m."repliedAt"))
    ORDER BY day ASC
  `
  )) as ChartRow[];

  type BucketValue = { day: string; sent: number; opens: number; replies: number };
  const buckets: Map<string, BucketValue> = new Map();

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - i);
    d.setUTCHours(0, 0, 0, 0);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, {
      day: d.toLocaleDateString("en-US", {
        timeZone: "UTC",
        weekday: "short",
        month: "short",
        day: "numeric",
      }),
      sent: 0,
      opens: 0,
      replies: 0,
    });
  }

  for (const row of rows) {
    const key = new Date(row.day).toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.sent = row.sent;
      bucket.opens = row.opens;
      bucket.replies = row.replies;
    }
  }

  return Array.from(buckets.values());
}

function buildDiffVector(
  original: { subject: string; body: string },
  updated: { subject?: string; body?: string }
): Record<string, { from: string; to: string }> {
  const diff: Record<string, { from: string; to: string }> = {};

  if (updated.subject && updated.subject !== original.subject) {
    diff.subject = { from: original.subject, to: updated.subject };
  }
  if (updated.body && updated.body !== original.body) {
    diff.body = { from: original.body, to: updated.body };
  }

  return diff;
}

export interface BatchActionResult {
  succeeded: string[];
  failed: Array<{ id: string; reason: string }>;
}

export async function batchApproveMessages(
  campaignId: string,
  messageIds: string[],
  approverId: string
): Promise<BatchActionResult> {
  const messages = await prisma.outreachMessage.findMany({
    where: {
      id: { in: messageIds },
      approvalStatus: "PENDING",
      lead: { campaignId, campaign: { createdById: approverId } },
    },
    select: { id: true },
  });

  const ownedIds = new Set(messages.map((m) => m.id));

  const results = await Promise.allSettled(
    messageIds.map((id) => {
      if (!ownedIds.has(id)) {
        return Promise.reject(new Error("Not found or not pending"));
      }
      return approveOutreachMessage(id, approverId);
    })
  );

  const succeeded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];

  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      succeeded.push(messageIds[i]);
    } else {
      failed.push({
        id: messageIds[i],
        reason: r.reason instanceof Error ? r.reason.message : "Unknown error",
      });
    }
  });

  return { succeeded, failed };
}

export async function sendOutreachMessage(id: string, userId: string) {
  const message = await prisma.outreachMessage.findFirst({
    where: {
      id,
      approvalStatus: "APPROVED",
      deliveryState: { in: ["QUEUED", "FAILED"] },
      lead: { campaign: { createdById: userId } },
    },
    include: {
      lead: {
        select: {
          email: true,
          firstName: true,
          companyName: true,
          website: true,
          campaign: {
            include: {
              senderMailbox: true,
              createdBy: { select: { id: true } },
            },
          },
        },
      },
    },
  });

  if (!message) throw new NotFoundError("Message");

  const campaign = message.lead.campaign;
  const mailbox = campaign.senderMailbox;

  if (!mailbox) {
    throw new ConflictError("No sender mailbox configured for this campaign");
  }

  const email = message.lead.email;
  if (!email || !EMAIL_REGEX.test(email)) {
    throw new ConflictError("Lead has no valid email address");
  }

  const claimToken = `manual_${Date.now()}_${randomUUID()}`;
  const claimed = await prisma.outreachMessage.updateMany({
    where: {
      id,
      approvalStatus: "APPROVED",
      deliveryState: { in: ["QUEUED", "FAILED"] },
      claimToken: null,
    },
    data: { deliveryState: "SENDING", claimToken },
  });

  if (claimed.count === 0) {
    throw new ConflictError("Message is already being sent or is not eligible");
  }

  const reservation = await reserveDailyCapacity(prisma, "SenderMailbox", mailbox.id, 1, mailbox.dailyLimit);

  if (!reservation) {
    await prisma.outreachMessage.update({
      where: { id },
      data: { deliveryState: "QUEUED", claimToken: null },
    });
    throw new ConflictError("Daily send limit reached for this mailbox");
  }

  let rawCreds: MailboxCredentials;
  try {
    rawCreds = decryptCredentials(mailbox.credentials);
  } catch (err) {
    await prisma.outreachMessage.update({
      where: { id },
      data: { deliveryState: "FAILED", claimToken: null, lastError: "Credential decryption failed" },
    });
    await prisma.senderMailbox.update({
      where: { id: mailbox.id },
      data: { currentSent: { decrement: 1 } },
    }).catch(() => null);
    logger.error({ messageId: id, err }, "[message.service] Mailbox credential decryption failed");
    throw new ConflictError("Mailbox credentials are invalid or corrupted");
  }

  const provider = createMailProvider(rawCreds, {
    outlook: {
      mailboxId: mailbox.id,
      redis,
      onTokenRotation: async (newRefreshToken: string) => {
        if (rawCreds.type === "OUTLOOK" && newRefreshToken !== (rawCreds as OutlookCredentials).refreshToken) {
          const rotated: OutlookCredentials = { ...(rawCreds as OutlookCredentials), refreshToken: newRefreshToken };
          await prisma.senderMailbox.update({
            where: { id: mailbox.id },
            data: { credentials: encryptJson(rotated) },
          });
        }
      },
    },
  });

  const brand = await getBrandSettingsOrDefault(campaign.createdBy.id);
  const fromAddress = `${brand.senderName} <${mailbox.emailAddress}>`;

  const content = parseBody(message.body);
  const { html, text } = renderEmailTemplate(
    brand,
    {
      subject: message.subject,
      greeting: content.greeting,
      opening: content.opening,
      body: content.body,
      ctaText: content.ctaText,
      closing: content.closing,
      ctaUrl: message.lead.website ?? undefined,
      messageId: message.id,
    },
    { style: (campaign.templateStyle as TemplateStyle | undefined) ?? "BRANDED" },
  );

  let result: SendResult;
  try {
    result = await provider.sendEmail({
      to: email,
      from: fromAddress,
      subject: message.subject,
      html,
      text,
      headers: buildListUnsubscribeHeaders(message.id) ?? undefined,
    });
  } catch (err) {
    result = { success: false, error: err instanceof Error ? err.message : "unknown send error" };
  }

  if (result.success) {
    await prisma.$transaction([
      prisma.outreachMessage.update({
        where: { id },
        data: {
          deliveryState: "SENT",
          sentAt: new Date(),
          externalMessageId: result.externalId,
          claimToken: null,
        },
      }),
      prisma.senderMailbox.update({
        where: { id: mailbox.id },
        data: { totalSent: { increment: 1 } },
      }),
      ...(campaign.senderDomainId ? [
        prisma.senderDomain.update({
          where: { id: campaign.senderDomainId },
          data: { totalSent: { increment: 1 } },
        })
      ] : []),
    ]);

    await Promise.all([
      CacheService.invalidateVersioned(`version:campaigns:${userId}`),
      CacheService.invalidateVersioned(`version:campaign:${campaign.id}`),
    ]).catch(() => null);
  } else {
    await prisma.outreachMessage.update({
      where: { id },
      data: {
        deliveryState: "FAILED",
        lastError: result.error ?? "unknown error",
        claimToken: null,
        retryCount: { increment: 1 },
      },
    });
    await prisma.senderMailbox.update({
      where: { id: mailbox.id },
      data: { currentSent: { decrement: 1 } },
    }).catch(() => null);
    logger.warn({ messageId: id, error: result.error }, "[message.service] Manual send failed");
  }

  return prisma.outreachMessage.findUniqueOrThrow({
    where: { id },
    include: outreachMessageInclude,
  });
}

export async function batchRejectMessages(
  campaignId: string,
  messageIds: string[],
  approverId: string
): Promise<BatchActionResult> {
  const messages = await prisma.outreachMessage.findMany({
    where: {
      id: { in: messageIds },
      approvalStatus: "PENDING",
      lead: { campaignId, campaign: { createdById: approverId } },
    },
    select: { id: true },
  });

  const ownedIds = new Set(messages.map((m) => m.id));

  const results = await Promise.allSettled(
    messageIds.map((id) => {
      if (!ownedIds.has(id)) {
        return Promise.reject(new Error("Not found or not pending"));
      }
      return rejectOutreachMessage(id, approverId);
    })
  );

  const succeeded: string[] = [];
  const failed: Array<{ id: string; reason: string }> = [];

  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      succeeded.push(messageIds[i]);
    } else {
      failed.push({
        id: messageIds[i],
        reason: r.reason instanceof Error ? r.reason.message : "Unknown error",
      });
    }
  });

  return { succeeded, failed };
}