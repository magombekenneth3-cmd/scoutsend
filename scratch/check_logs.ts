import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";

async function main() {
  console.log("=== User stats ===");
  const users = await prisma.user.findMany();
  for (const user of users) {
    const campaignsCount = await prisma.campaign.count({ where: { createdById: user.id } });
    const leadsCount = await prisma.lead.count({ where: { campaign: { createdById: user.id }, deletedAt: null } });
    console.log(`User: ${user.firstName} ${user.lastName} (${user.email}) | ID: ${user.id} | Campaigns: ${campaignsCount} | Active Leads: ${leadsCount}`);
  }

  console.log("\n=== Last 20 Audit Logs ===");
  const logs = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { user: { select: { email: true } } },
  });
  console.table(logs.map(log => ({
    id: log.id,
    action: log.action,
    email: log.user.email,
    entityType: log.entityType,
    entityId: log.entityId,
    createdAt: log.createdAt.toISOString()
  })));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
