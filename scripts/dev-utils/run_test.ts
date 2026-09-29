import { runCampaign } from "../../app/api/src/modules/campaigns/campaigns.service";

async function main() {
  const campaignId = "cmq5ne4n500013v1zhh7002jy";
  const createdById = "cmq5n6ae500003v1z3e78fek6";
  const orgId = "default-org";
  console.log(`Starting campaign run for ID ${campaignId}...`);
  const result = await runCampaign(campaignId, createdById, orgId);
  console.log("Campaign run triggered successfully!", result);
}

main().catch(console.error);
