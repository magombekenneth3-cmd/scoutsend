import { DateTime } from "luxon";
import { Prisma, PrismaClient } from "@prisma/client";

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