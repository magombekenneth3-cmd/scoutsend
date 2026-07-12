import { prisma } from "../app/api/src/lib/prisma";

async function main() {
  const campaigns = await prisma.campaign.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      createdById: true,
      _count: {
        select: {
          leads: true,
        },
      },
    },
  });

  const leads = await prisma.lead.findMany({
    select: {
      id: true,
      companyName: true,
      campaignId: true,
      deletedAt: true,
    },
  });

  console.log("=== CAMPAIGNS ===");
  console.dir(campaigns, { depth: null });
  console.log("\n=== LEADS ===");
  console.dir(leads, { depth: null });
}

main().catch(console.error);
