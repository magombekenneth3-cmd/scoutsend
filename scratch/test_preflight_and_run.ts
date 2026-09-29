import { getCampaignPreflight, runCampaign } from "../app/api/src/modules/campaigns/campaigns.service";
import { prisma } from "../app/api/src/lib/prisma";

async function test() {
    const campaignId = "cmsrq9a2u01jhob1ze7uej7x8";

    console.log("=== Testing Campaign basic status ===");
    const basic = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { id: true, status: true, name: true, orgId: true, createdById: true }
    });
    console.log("Campaign basic status:", basic);

    if (!basic) {
        console.log("Campaign not found!");
        return;
    }

    console.log("\n=== Testing getCampaignPreflight() ===");
    try {
        const preflight = await getCampaignPreflight(campaignId, basic.orgId || "");
        console.log("getCampaignPreflight result:", JSON.stringify(preflight, null, 2));
    } catch (err: any) {
        console.error("PREFLIGHT QUERY FAILED WITH ERROR:");
        console.error(err.message || err);
    }

    console.log("\n=== Testing runCampaign() ===");
    try {
        await runCampaign(campaignId, basic.orgId || "", basic.createdById);
        console.log("runCampaign completed unexpected (should have thrown for 0 leads)");
    } catch (err: any) {
        console.log("runCampaign expectedly failed with error:");
        console.log(`[${err.code || err.name}] ${err.message}`);
    }
}

test().catch(console.error).finally(() => prisma.$disconnect());

