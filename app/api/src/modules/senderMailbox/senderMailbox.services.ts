import { z } from "zod";
import { Prisma } from "@prisma/client";
import dns from "node:dns/promises";
import { prisma } from "../../lib/prisma";
import { NotFoundError, ForbiddenError, ConflictError } from "../../lib/errors";
import { createMailProvider, MailboxCredentials } from "../../lib/mail";
import { redis } from "../../lib/ioredis";

import {
  createSenderMailboxSchema,
  getSenderMailboxesQuerySchema,
  updateSenderMailboxSchema,
} from "./senderMailbox.schema";
import { decryptJson, encryptJson, isEncrypted } from "../../lib/mail/crypto";


async function getMailboxOrThrow(id: string, userId: string) {
  const mailbox = await prisma.senderMailbox.findUnique({ where: { id } });
  if (!mailbox) throw new NotFoundError("Sender mailbox");
  if (mailbox.createdById !== userId) throw new ForbiddenError();
  return mailbox;
}

function decryptCredentials(raw: Prisma.JsonValue): MailboxCredentials {
  if (isEncrypted(raw)) {
    return decryptJson<MailboxCredentials>(raw);
  }
  return raw as unknown as MailboxCredentials;
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
  createdById: string
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
  userId: string
) {
  const { page, limit, providerType, health } = query;
  const skip = (page - 1) * limit;

  const where: Prisma.SenderMailboxWhereInput = {
    createdById: userId,
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

export async function getSenderMailboxById(id: string, userId: string) {
  await getMailboxOrThrow(id, userId);

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
  data: z.infer<typeof updateSenderMailboxSchema>
) {
  await getMailboxOrThrow(id, userId);

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

export async function deleteSenderMailbox(id: string, userId: string) {
  await getMailboxOrThrow(id, userId);

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

export async function verifyMailboxConnection(id: string, userId: string) {
  const mailbox = await getMailboxOrThrow(id, userId);
  const creds = decryptCredentials(mailbox.credentials);
  const provider = createProviderForMailbox(id, creds);
  const ok = await provider.verify();
  return { connected: ok };
}

export async function resetMailboxDailyCount(id: string, userId: string) {
  await getMailboxOrThrow(id, userId);
  return prisma.senderMailbox.update({ where: { id }, data: { currentSent: 0 } });
}

export async function verifyMailboxDns(id: string, userId: string) {
  const mailbox = userId === "SYSTEM"
    ? await prisma.senderMailbox.findUnique({ where: { id } })
    : await getMailboxOrThrow(id, userId);

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
  } catch {}

  let dkimValid = false;
  try {
    const txt = await dns.resolveTxt(`${selector}._domainkey.${sendingDomain}`);
    dkimValid = txt.some((chunks) => chunks.join("").toLowerCase().includes("v=dkim1"));
  } catch {}

  let dmarcValid = false;
  try {
    const txt = await dns.resolveTxt(`_dmarc.${sendingDomain}`);
    dmarcValid = txt.some((chunks) => chunks.join("").toLowerCase().startsWith("v=dmarc1"));
  } catch {}

  const dnsCheckedAt = new Date();

  await prisma.senderMailbox.update({
    where: { id },
    data: { spfValid, dkimValid, dmarcValid, dnsCheckedAt },
  });

  return { sendingDomain, spfValid, dkimValid, dmarcValid, dnsCheckedAt };
}