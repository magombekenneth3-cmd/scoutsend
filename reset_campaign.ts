import "dotenv/config";
import { prisma } from "./app/api/src/lib/prisma";

async function main() {
  const updated = await prisma.campaign.updateMany({
    where: { status: "RESEARCHING" },
    data: { status: "DRAFT" },
  });
  console.log(`Reset ${updated.count} campaign(s) from RESEARCHING → DRAFT`);

  const campaigns = await prisma.campaign.findMany({
    select: { id: true, name: true, status: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  console.table(campaigns);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
