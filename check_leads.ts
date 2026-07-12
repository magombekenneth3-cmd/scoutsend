import "dotenv/config";
import { prisma } from "./app/api/src/lib/prisma";

async function main() {
  const leads = await prisma.lead.findMany({
    where: {
      createdAt: {
        gte: new Date("2026-06-14T15:53:00.000Z"),
      },
    },
    select: {
      id: true,
      companyName: true,
      qualificationScore: true,
      recommendedAction: true,
      emailStatus: true,
    },
  });
  console.log("=== Discovered Leads ===");
  console.log(leads);

  const jobs = await prisma.$queryRaw`
    SELECT id, name, status, "queueName" FROM "bullmq_jobs" LIMIT 10
  `;
  console.log("=== BullMQ Jobs ===");
  console.log(jobs);
}

main().catch(console.error);
