import { prisma } from "./app/api/src/lib/prisma";

async function main() {
  const campaignId = "cmq5ne4n500013v1zhh7002jy";
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { status: true }
  });
  const queueJob = await prisma.queueJob.findFirst({
    where: { campaignId },
    orderBy: { createdAt: "desc" }
  });
  const leadCount = await prisma.lead.count({ where: { campaignId } });
  const runs = await prisma.discoveryRun.findMany({ where: { campaignId } });

  console.log(`Campaign Status: ${campaign?.status}`);
  console.log(`QueueJob Status: ${queueJob?.status}, Error: ${queueJob?.errorMessage || 'None'}`);
  console.log(`Leads Gathered: ${leadCount}`);
  console.log(`Discovery Runs:`, JSON.stringify(runs, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
