import { DateTime } from "luxon";
import { Prisma, PrismaClient, QuotaScope } from "@prisma/client";
import { prisma as defaultPrisma } from "./prisma";
import { logger } from "./logger";

export type QuotaTable = "SenderMailbox" | "SenderDomain";


type DelegateModel = {
  findUniqueOrThrow(args: {
    where: { id: string };
    select: Record<string, boolean>;
  }): Promise<Record<string, unknown>>;
};

export function mostRecentLocalMidnightUtc(timezone: string, now: Date = new Date()): Date {
  try {
    return DateTime.fromJSDate(now, { zone: timezone }).startOf("day").toUTC().toJSDate();
  } catch {
    return DateTime.fromJSDate(now, { zone: "utc" }).startOf("day").toUTC().toJSDate();
  }
}

export async function reserveDailyCapacity(
  prisma: PrismaClient,
  table: QuotaTable,
  id: string,
  amount: number,
  dailyLimit: number,
  now: Date = new Date(),
): Promise<{ currentSent: number } | null> {
  const model = (table === "SenderMailbox" ? prisma.senderMailbox : prisma.senderDomain) as unknown as DelegateModel;
  const row = await model.findUniqueOrThrow({ where: { id }, select: { timezone: true } });
  const cutoff = mostRecentLocalMidnightUtc(row.timezone as string, now);

  const result = await prisma.$queryRaw<{ currentSent: number }[]>(Prisma.sql`
    UPDATE ${Prisma.raw(`"${table}"`)}
    SET
      "currentSent" = CASE WHEN "lastResetAt" < ${cutoff} THEN ${amount} ELSE "currentSent" + ${amount} END,
      "lastResetAt" = CASE WHEN "lastResetAt" < ${cutoff} THEN ${now}  ELSE "lastResetAt"  END
    WHERE id = ${id}
      AND (CASE WHEN "lastResetAt" < ${cutoff} THEN 0 ELSE "currentSent" END) + ${amount} <= ${dailyLimit}
    RETURNING "currentSent"
  `);

  return result[0] ?? null;
}

export async function effectiveCurrentSent(
  prisma: PrismaClient,
  table: QuotaTable,
  id: string,
  now: Date = new Date(),
): Promise<number> {
  const model = (table === "SenderMailbox" ? prisma.senderMailbox : prisma.senderDomain) as unknown as DelegateModel;
  const row = await model.findUniqueOrThrow({
    where: { id },
    select: { currentSent: true, lastResetAt: true, timezone: true },
  });
  const cutoff = mostRecentLocalMidnightUtc(row.timezone as string, now);
  return (row.lastResetAt as Date) < cutoff ? 0 : (row.currentSent as number);
}

export async function reserveSmtpHostCapacity(
  redisClient: { incr(key: string): Promise<number>; expire(key: string, sec: number): Promise<number> },
  smtpHost: string,
  maxConcurrent: number = 10,
  windowSec: number = 60
): Promise<boolean> {
  if (!smtpHost) return true;
  const key = `smtp:rate_limit:${smtpHost.toLowerCase()}`;
  try {
    const current = await redisClient.incr(key);
    if (current === 1) {
      await redisClient.expire(key, windowSec);
    }
    return current <= maxConcurrent;
  } catch {
    return true;
  }
}

const RESERVATION_TTL_MS = 10 * 60_000;

export interface QuotaReservationResult {
  reservationId: string;
  status: "RESERVED" | "ALREADY_RESERVED";
}

export async function reserveQuota(params: {
  operationId: string;
  scope: QuotaScope;
  scopeId: string;
  amount?: number;
}): Promise<QuotaReservationResult | null> {
  const amount = params.amount ?? 1;
  const windowStart = mostRecentLocalMidnightUtc("UTC");
  const expiresAt = new Date(Date.now() + RESERVATION_TTL_MS);

  const existing = await defaultPrisma.quotaReservation.findUnique({
    where: {
      operationId_scope_scopeId: {
        operationId: params.operationId,
        scope: params.scope,
        scopeId: params.scopeId,
      },
    },
    select: { id: true, status: true },
  });

  if (existing) {
    if (existing.status === "CONSUMED") {
      return { reservationId: existing.id, status: "ALREADY_RESERVED" };
    }
    if (existing.status === "RESERVED" || existing.status === "HELD") {
      return { reservationId: existing.id, status: "ALREADY_RESERVED" };
    }
  }

  const reservation = await defaultPrisma.quotaReservation.create({
    data: {
      operationId: params.operationId,
      scope: params.scope,
      scopeId: params.scopeId,
      amount,
      status: "RESERVED",
      windowStart,
      expiresAt,
    },
    select: { id: true },
  });

  logger.info(
    { reservationId: reservation.id, operationId: params.operationId, scope: params.scope },
    "[quota] Reserved",
  );

  return { reservationId: reservation.id, status: "RESERVED" };
}

export async function consumeQuota(reservationId: string): Promise<boolean> {
  const updated = await defaultPrisma.quotaReservation.updateMany({
    where: { id: reservationId, status: "RESERVED" },
    data: { status: "CONSUMED" },
  });
  return updated.count > 0;
}

export async function releaseQuota(reservationId: string): Promise<boolean> {
  const updated = await defaultPrisma.quotaReservation.updateMany({
    where: { id: reservationId, status: { in: ["RESERVED", "HELD"] } },
    data: { status: "RELEASED" },
  });
  return updated.count > 0;
}

export async function holdQuota(reservationId: string): Promise<boolean> {
  const updated = await defaultPrisma.quotaReservation.updateMany({
    where: { id: reservationId, status: "RESERVED" },
    data: { status: "HELD" },
  });
  return updated.count > 0;
}

export async function reconcileExpiredReservations(): Promise<number> {
  const now = new Date();

  const expired = await defaultPrisma.quotaReservation.findMany({
    where: {
      status: { in: ["RESERVED", "HELD"] },
      expiresAt: { lt: now },
    },
    select: { id: true, operationId: true, scope: true, scopeId: true, amount: true },
    take: 200,
  });

  if (expired.length === 0) return 0;

  const operationIds = [...new Set(expired.map((r) => r.operationId))];
  const operations = await defaultPrisma.operation.findMany({
    where: { operationId: { in: operationIds } },
    select: { operationId: true, status: true },
  });

  const opMap = new Map(operations.map((o) => [o.operationId, o.status]));

  let released = 0;
  for (const reservation of expired) {
    const opStatus = opMap.get(reservation.operationId);

    if (opStatus === "SUCCEEDED") {
      await defaultPrisma.quotaReservation.updateMany({
        where: { id: reservation.id, status: { in: ["RESERVED", "HELD"] } },
        data: { status: "CONSUMED" },
      });
    } else {
      await defaultPrisma.quotaReservation.updateMany({
        where: { id: reservation.id, status: { in: ["RESERVED", "HELD"] } },
        data: { status: "RELEASED" },
      });
      released++;
    }
  }

  if (released > 0) {
    logger.warn(
      { released, total: expired.length },
      "[quota] Reconciled expired reservations",
    );
  }

  return released;
}