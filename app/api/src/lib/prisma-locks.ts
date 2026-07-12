import { PrismaClient } from "@prisma/client";

type TransactionClient = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];

export async function acquireLeadLock(
  tx: TransactionClient,
  leadId: string
): Promise<{ id: string; emailStatus: string }> {
  const rows = await tx.$queryRaw<Array<{ id: string; emailStatus: string }>>`
    SELECT id, "emailStatus" FROM "Lead" WHERE id = ${leadId} FOR UPDATE
  `;

  if (rows.length === 0) {
    throw new Error(`[prisma-locks] Lead ${leadId} not found`);
  }

  return rows[0];
}
