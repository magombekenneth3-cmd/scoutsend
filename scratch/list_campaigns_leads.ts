import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, firstName: true, lastName: true },
  });
  console.log("=== Users in DB ===");
  console.log(users);

  const campaigns = await prisma.campaign.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      createdById: true,
      _count: { select: { leads: true } },
    },
  });
  console.log("\n=== Campaigns in DB ===");
  console.log(campaigns);

  for (const campaign of campaigns) {
    const leadsCount = await prisma.lead.count({
      where: { campaignId: campaign.id, deletedAt: null },
    });
    console.log(`Campaign "${campaign.name}" (${campaign.id}) owned by user ${campaign.createdById} has ${leadsCount} active leads (total in db including deleted: ${campaign._count.leads})`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
