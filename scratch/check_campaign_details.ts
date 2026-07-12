import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";

async function main() {
  const campaigns = await prisma.campaign.findMany({
    orderBy: { createdAt: "desc" },
  });
  console.log("=== All campaigns in database ===");
  console.log(JSON.stringify(campaigns, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
