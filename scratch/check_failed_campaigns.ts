import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";

async function main() {
  const campaigns = await prisma.campaign.findMany({
    where: { createdById: "cmqtvsb7k0000ss1zlpgvsjxx" },
    select: {
      id: true,
      name: true,
      status: true,
      deletedAt: true,
      createdAt: true,
      _count: { select: { leads: true } },
    }
  });
  console.log("Campaigns:", campaigns);

  // Let's check if there are any errors logged in the AuditLog or Campaign events or elsewhere
  const auditLogs = await prisma.auditLog.findMany({
    where: {
      userId: "cmqtvsb7k0000ss1zlpgvsjxx",
      action: { contains: "FAIL" },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  console.log("Failed audit logs:", auditLogs);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
