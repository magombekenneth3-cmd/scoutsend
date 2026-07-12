import "dotenv/config";
import { prisma } from "./app/api/src/lib/prisma";

async function main() {
  const campaign = await prisma.campaign.findUnique({
    where: { id: "cmq5ne4n500013v1zhh7002jy" },
    select: { id: true, name: true, status: true, updatedAt: true },
  });
  console.log("\n=== Campaign ===");
  console.log(campaign);

  const runs = await prisma.discoveryRun.findMany({
    where: { campaignId: "cmq5ne4n500013v1zhh7002jy" },
    orderBy: { startedAt: "desc" },
    take: 3,
    select: {
      id: true,
      status: true,
      sourceType: true,
      leadsFound: true,
      companiesFound: true,
      signalsFound: true,
      errorMessage: true,
      startedAt: true,
      completedAt: true,
    },
  });
  console.log("\n=== Discovery Runs ===");
  console.table(runs.map(r => ({ ...r, startedAt: r.startedAt?.toISOString(), completedAt: r.completedAt?.toISOString() })));

  const leads = await prisma.lead.findMany({
    where: { campaignId: "cmq5ne4n500013v1zhh7002jy" },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      companyName: true,
      firstName: true,
      lastName: true,
      title: true,
      email: true,
      emailStatus: true,
      source: true,
      website: true,
      createdAt: true,
    },
  });
  console.log(`\n=== Leads (${leads.length} found) ===`);
  if (leads.length > 0) {
    console.table(leads.map(l => ({ ...l, createdAt: l.createdAt.toISOString() })));
  } else {
    console.log("No leads found in DB yet.");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
