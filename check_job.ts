import { prisma } from "./app/api/src/lib/prisma";

async function main() {
  const jobs = await prisma.queueJob.findMany({
    where: { status: "ACTIVE" }
  });
  console.log(JSON.stringify(jobs, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
