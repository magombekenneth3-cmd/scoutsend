import "dotenv/config";
import { prisma } from "./app/api/src/lib/prisma";
import { campaignQueue } from "./app/api/src/modules/gemini/campaign.queue";

const CAMPAIGN_ID = "cmq5ne4n500013v1zhh7002jy";

async function main() {
  const campaign = await prisma.campaign.findUnique({
    where: { id: CAMPAIGN_ID },
    select: { id: true, name: true, status: true, icpDescription: true, targetIndustry: true },
  });

  if (!campaign) {
    console.error("Campaign not found:", CAMPAIGN_ID);
    process.exit(1);
  }

  console.log("\n=== Campaign ===");
  console.log(`  Name: ${campaign.name}`);
  console.log(`  Status: ${campaign.status}`);
  console.log(`  ICP: ${campaign.icpDescription}`);
  console.log(`  Industry: ${campaign.targetIndustry}`);

  console.log("\n[+] Queuing run-multi-source-discovery job...");
  const job = await campaignQueue.add(
    "run-multi-source-discovery",
    { campaignId: CAMPAIGN_ID },
    {
      jobId: `discovery-manual-${CAMPAIGN_ID}-${Date.now()}`,
      removeOnComplete: { age: 3600 },
      removeOnFail: { age: 86400 },
    }
  );

  console.log(`[✓] Job queued: ${job.id}`);
  console.log("\n    The dev:api worker will process this job.");
  console.log("    Watch the API logs or run: pnpm tsx check_db.ts (in ~60 seconds)");

  await prisma.$disconnect();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
