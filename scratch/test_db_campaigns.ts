import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";

async function main() {
  console.log("=== Querying Campaigns from DB ===");
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
    });
    console.log(`[✓] Found ${campaigns.length} campaigns:`);
    for (const c of campaigns) {
      console.log(`- ID: ${c.id}`);
      console.log(`  Name: ${c.name}`);
      console.log(`  Status: ${c.status}`);
      console.log(`  Created By ID: ${c.createdById}`);
    }
  } catch (e: any) {
    console.error("[-] Error querying campaigns:", e.message || e);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
