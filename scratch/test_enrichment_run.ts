import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";
import { initEnrichmentProviders } from "../app/api/src/lib/providers";
import { runEnrichmentWaterfall } from "../app/api/src/modules/gemini/enrichment-waterfall.agent";

async function main() {
  // 1. Initialize the providers
  initEnrichmentProviders();

  // 2. Identify target user
  const user = await prisma.user.findFirst({
    where: { email: "kennethdavid25@gm.com" },
  });
  if (!user) {
    console.error("User not found");
    return;
  }
  const userId = user.id;

  // 3. Find target campaign (must be active and belong to user)
  const campaign = await prisma.campaign.findFirst({
    where: { createdById: userId, deletedAt: null },
  });
  if (!campaign) {
    console.error("No active campaigns found for this user");
    return;
  }
  const campaignId = campaign.id;

  // 4. Find or create the lead in the active campaign
  let lead = await prisma.lead.findFirst({
    where: { email: "kennethdavid256@gmail.com", campaignId },
  });

  if (lead) {
    console.log("Found existing lead in active campaign, updating name & website...");
    lead = await prisma.lead.update({
      where: { id: lead.id },
      data: {
        firstName: "Kenneth",
        lastName: "David",
        companyName: "Aiseo",
        website: "aiseo.co",
        deletedAt: null,
      },
    });
  } else {
    console.log("Lead not found in active campaign, creating one...");
    lead = await prisma.lead.create({
      data: {
        campaignId,
        firstName: "Kenneth",
        lastName: "David",
        email: "kennethdavid256@gmail.com",
        companyName: "Aiseo",
        website: "aiseo.co",
      },
    });
  }

  console.log("Testing enrichment waterfall on lead:", {
    id: lead.id,
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    companyName: lead.companyName,
    website: lead.website,
  });

  // 5. Run the enrichment waterfall
  const result = await runEnrichmentWaterfall(lead.id, userId, { force: true });
  console.log("\n=== Waterfall Result ===");
  console.log(JSON.stringify(result, null, 2));

  // 6. Fetch final lead state from DB
  const updatedLead = await prisma.lead.findUnique({
    where: { id: lead.id },
  });
  console.log("\n=== Lead enrichmentData from DB ===");
  console.log(JSON.stringify(updatedLead?.enrichmentData, null, 2));
  console.log("\n=== Updated Lead Fields ===");
  console.log({
    firstName: updatedLead?.firstName,
    lastName: updatedLead?.lastName,
    title: updatedLead?.title,
    seniority: updatedLead?.seniority,
    department: updatedLead?.department,
    linkedinUrl: updatedLead?.linkedinUrl,
    lastEnrichedAt: updatedLead?.lastEnrichedAt,
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
