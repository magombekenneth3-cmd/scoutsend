import { z } from "zod";
import { Prisma } from "@prisma/client";
import dns from "node:dns/promises";
import { prisma } from "../../lib/prisma";
import { NotFoundError, ForbiddenError, ConflictError } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { createMailProvider, MailboxCredentials } from "../../lib/mail";
import { redis } from "../../lib/ioredis";

import {
  createSenderMailboxSchema,
  getSenderMailboxesQuerySchema,
  updateSenderMailboxSchema,
} from "./senderMailbox.schema";
import { decryptMailboxCredentials, encryptJson } from "../../lib/mail/crypto";


async function getMailboxOrThrow(id: string, userId: string, orgId?: string) {
  const mailbox = await prisma.senderMailbox.findUnique({ where: { id } });
  if (!mailbox) throw new NotFoundError("Sender mailbox");
  if (mailbox.orgId && orgId && mailbox.orgId === orgId) return mailbox;
  if (mailbox.createdById !== userId) throw new ForbiddenError();
  return mailbox;
}


function createProviderForMailbox(mailboxId: string, creds: MailboxCredentials) {
  return createMailProvider(creds, {
    outlook:
      creds.type === "OUTLOOK"
        ? {
          mailboxId,
          redis,
          onTokenRotation: async (refreshToken) => {
            await prisma.senderMailbox.update({
              where: { id: mailboxId },
              data: {
                credentials: encryptJson({
                  ...creds,
                  refreshToken,
                }),
              },
            });
          },
        }
        : undefined,
  });
}

export async function createSenderMailbox(
  data: z.infer<typeof createSenderMailboxSchema>,
  createdById: string,
  orgId?: string
) {
  const provider = createMailProvider(data.credentials as MailboxCredentials);
  const ok = await provider.verify();
  if (!ok) {
    throw new Error(
      "Could not connect to the mailbox with the provided credentials. Please check your settings and try again."
    );
  }

  try {
    return await prisma.senderMailbox.create({
      data: {
        label: data.label,
        emailAddress: data.emailAddress,
        providerType: data.credentials.type,
        credentials: encryptJson(data.credentials),
        dailyLimit: data.dailyLimit,
        baseDailyLimit: data.dailyLimit,
        warmupEnabled: data.warmupEnabled,
        warmupStartedAt: data.warmupEnabled ? new Date() : null,
        createdById,
        orgId,
      },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new ConflictError(
        `A mailbox with the address ${data.emailAddress} is already registered to your account`
      );
    }
    throw err;
  }
}

export async function getSenderMailboxes(
  query: z.infer<typeof getSenderMailboxesQuerySchema>,
  userId: string,
  orgId?: string
) {
  const { page, limit, providerType, health } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.SenderMailboxWhereInput = {
    ...(orgId ? { OR: [{ orgId }, { createdById: userId }] } : { createdById: userId }),
    ...(providerType && { providerType }),
    ...(health && { health }),
  };

  const [mailboxes, total] = await prisma.$transaction([
    prisma.senderMailbox.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        label: true,
        emailAddress: true,
        providerType: true,
        dailyLimit: true,
        currentSent: true,
        totalSent: true,
        warmupEnabled: true,
        health: true,
        bounceRate: true,
        complaintRate: true,
        reputationScore: true,
        lastReplyCheckedAt: true,
        createdAt: true,
        updatedAt: true,
        calendlyToken: true,
        _count: { select: { campaigns: true } },
      },
    }),
    prisma.senderMailbox.count({ where }),
  ]);

  return {
    data: mailboxes.map(({ calendlyToken, ...m }) => ({
      ...m,
      calendlyConnected: calendlyToken !== null,
    })),
    meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
}

export async function getSenderMailboxById(id: string, userId: string, orgId?: string) {
  await getMailboxOrThrow(id, userId, orgId);

  return prisma.senderMailbox.findUnique({
    where: { id },
    select: {
      id: true,
      label: true,
      emailAddress: true,
      providerType: true,
      dailyLimit: true,
      currentSent: true,
      totalSent: true,
      warmupEnabled: true,
      health: true,
      bounceRate: true,
      complaintRate: true,
      reputationScore: true,
      lastReplyCheckedAt: true,
      createdAt: true,
      updatedAt: true,
      calendlyToken: true,
      campaigns: {
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, status: true, dailySendLimit: true },
      },
      _count: { select: { campaigns: true } },
    },
  }).then((mailbox) => {
    if (!mailbox) return null;
    const { calendlyToken, ...rest } = mailbox;
    return { ...rest, calendlyConnected: calendlyToken !== null };
  });
}

export async function updateSenderMailbox(
  id: string,
  userId: string,
  data: z.infer<typeof updateSenderMailboxSchema>,
  orgId?: string
) {
  await getMailboxOrThrow(id, userId, orgId);

  const updateData: Prisma.SenderMailboxUpdateInput = {};
  if (data.label !== undefined) updateData.label = data.label;
  if (data.dailyLimit !== undefined) {
    updateData.dailyLimit = data.dailyLimit;
    updateData.baseDailyLimit = data.dailyLimit;
  }
  if (data.warmupEnabled !== undefined) {
    updateData.warmupEnabled = data.warmupEnabled;
    updateData.warmupStartedAt = data.warmupEnabled ? new Date() : null;
  }
  if (data.credentials !== undefined) {
    const provider = createMailProvider(data.credentials as MailboxCredentials);
    const ok = await provider.verify();
    if (!ok) {
      throw new Error("Could not connect to the mailbox with the updated credentials.");
    }
    updateData.credentials = encryptJson(data.credentials);
    updateData.providerType = data.credentials.type;
  }

  return prisma.senderMailbox.update({ where: { id }, data: updateData });
}

export async function deleteSenderMailbox(id: string, userId: string, orgId?: string) {
  await getMailboxOrThrow(id, userId, orgId);

  const active = await prisma.campaign.count({
    where: {
      senderMailboxId: id,
      status: { in: ["RESEARCHING", "GENERATING", "REVIEW", "QUEUED", "SENDING"] },
    },
  });

  if (active > 0) {
    throw new Error("Cannot delete a mailbox with active campaigns");
  }

  return prisma.senderMailbox.delete({ where: { id } });
}

export async function verifyMailboxConnection(id: string, userId: string, orgId?: string) {
  const mailbox = await getMailboxOrThrow(id, userId, orgId);
  const creds = decryptMailboxCredentials<MailboxCredentials>(mailbox.credentials, `mailbox:${mailbox.id}`);
  const provider = createProviderForMailbox(id, creds);
  const ok = await provider.verify();
  return { connected: ok };
}

export async function resetMailboxDailyCount(id: string, userId: string, orgId?: string) {
  await getMailboxOrThrow(id, userId, orgId);
  return prisma.senderMailbox.update({ where: { id }, data: { currentSent: 0 } });
}

export async function verifyMailboxDns(id: string, userId: string, orgId?: string) {
  const mailbox = userId === "SYSTEM"
    ? await prisma.senderMailbox.findUnique({ where: { id } })
    : await getMailboxOrThrow(id, userId, orgId);

  if (!mailbox) throw new NotFoundError("Sender mailbox");

  const sendingDomain = mailbox.emailAddress.split("@")[1]?.toLowerCase();

  if (!sendingDomain) {
    throw new Error(`SenderMailbox ${id} has an invalid emailAddress — cannot extract domain for DNS verification`);
  }

  const selector = mailbox.dkimSelector ?? "default";

  let spfValid = false;
  try {
    const txt = await dns.resolveTxt(sendingDomain);
    spfValid = txt.some((chunks) => chunks.join("").toLowerCase().startsWith("v=spf1"));
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code !== "ENOTFOUND" && code !== "ENODATA") {
      logger.warn({ err, sendingDomain }, "[mailbox.dns] SPF lookup failed unexpectedly");
    }
  }

  let dkimValid = false;
  try {
    const txt = await dns.resolveTxt(`${selector}._domainkey.${sendingDomain}`);
    dkimValid = txt.some((chunks) => chunks.join("").toLowerCase().includes("v=dkim1"));
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code !== "ENOTFOUND" && code !== "ENODATA") {
      logger.warn({ err, sendingDomain, selector }, "[mailbox.dns] DKIM lookup failed unexpectedly");
    }
  }

  let dmarcValid = false;
  try {
    const txt = await dns.resolveTxt(`_dmarc.${sendingDomain}`);
    dmarcValid = txt.some((chunks) => chunks.join("").toLowerCase().startsWith("v=dmarc1"));
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code !== "ENOTFOUND" && code !== "ENODATA") {
      logger.warn({ err, sendingDomain }, "[mailbox.dns] DMARC lookup failed unexpectedly");
    }
  }

  const dnsCheckedAt = new Date();

  const domainRecord = await prisma.senderDomain.findUnique({
    where: { domain: sendingDomain },
  });

  if (domainRecord) {
    await prisma.senderDomain.update({
      where: { id: domainRecord.id },
      data: { spfValid, dkimValid, dmarcValid, dnsCheckedAt },
    });
  }

  return { sendingDomain, spfValid, dkimValid, dmarcValid, dnsCheckedAt };
}