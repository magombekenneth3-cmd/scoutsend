import "dotenv/config";
import { Queue } from "bullmq";
import { prisma } from "../app/api/src/lib/prisma";
import { redisConnectionOptions } from "../app/api/src/lib/ioredis";

const STALL_THRESHOLD_MS = 15 * 60 * 1000;
const QUEUE_NAME = "email-enrichment";

async function main() {
  const stalledBefore = new Date(Date.now() - STALL_THRESHOLD_MS);

  const stuckLeads = await prisma.lead.findMany({
    where: {
      emailStatus: { in: ["PENDING", "PENDING_VERIFICATION"] },
      updatedAt: { lt: stalledBefore },
      deletedAt: null,
    },
    select: {
      id: true,
      emailStatus: true,
      updatedAt: true,
      campaign: { select: { createdById: true } },
    },
    orderBy: { updatedAt: "asc" },
  });

  console.log(`\nFound ${stuckLeads.length} leads stuck in PENDING/PENDING_VERIFICATION for >${STALL_THRESHOLD_MS / 60_000}m`);

  if (stuckLeads.length > 0) {
    const resetResult = await prisma.lead.updateMany({
      where: {
        id: { in: stuckLeads.map((l) => l.id) },
        emailStatus: { in: ["PENDING", "PENDING_VERIFICATION"] },
      },
      data: {
        emailStatus: "NOT_FOUND",
        lastEnrichedAt: new Date(),
      },
    });
    console.log(`Reset ${resetResult.count} leads to NOT_FOUND`);
  }

  const queue = new Queue(QUEUE_NAME, { connection: redisConnectionOptions });

  const [activeBefore, waitingBefore] = await Promise.all([
    queue.getActiveCount(),
    queue.getWaitingCount(),
  ]);
  console.log(`\nBullMQ "${QUEUE_NAME}" before clean: active=${activeBefore} waiting=${waitingBefore}`);

  const [cleanedActive, cleanedWaiting] = await Promise.all([
    queue.clean(STALL_THRESHOLD_MS, 100, "active"),
    queue.clean(STALL_THRESHOLD_MS, 100, "wait"),
  ]);
  console.log(`Cleaned ${cleanedActive.length} stalled active jobs, ${cleanedWaiting.length} stalled waiting jobs`);

  const [activeAfter, waitingAfter] = await Promise.all([
    queue.getActiveCount(),
    queue.getWaitingCount(),
  ]);
  console.log(`BullMQ "${QUEUE_NAME}" after clean:  active=${activeAfter} waiting=${waitingAfter}`);

  await queue.close();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
