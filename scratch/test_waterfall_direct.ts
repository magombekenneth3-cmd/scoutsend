import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";
import { runEnrichmentWaterfall } from "../app/api/src/modules/gemini/enrichment-waterfall.agent";

// Mock env
process.env.PDL_API_KEY = "mock_key";

globalThis.fetch = async (input, init) => {
  const urlStr = input.toString();
  if (urlStr.includes("api.peopledatalabs.com/v5/person/enrich")) {
    return new Response(JSON.stringify({
      first_name: "Jane",
      last_name: "Doe",
      work_email: "jane@acme.com",
      job_title: "VP Engineering",
      job_company_industry: "Technology",
      linkedin_url: "linkedin.com/in/janedoe",
      mobile_phone: "+1234567890",
    }));
  }
  return new Response(JSON.stringify({}));
};

async function main() {
  const user = await prisma.user.findFirst();
  if (!user) throw new Error("No user found");
  const campaign = await prisma.campaign.create({
    data: {
      name: "Temp Campaign",
      icpDescription: "ICP",
      createdById: user.id,
    }
  });
  const lead = await prisma.lead.create({
    data: {
      companyName: "Acme",
      website: "acme.com",
      campaignId: campaign.id
    }
  });
  try {
    const res = await runEnrichmentWaterfall(lead.id, user.id);
    console.log("RESULT:", res);
    const updated = await prisma.lead.findUnique({ where: { id: lead.id } });
    console.log("UPDATED LEAD:", JSON.stringify(updated, null, 2));
  } finally {
    await prisma.lead.delete({ where: { id: lead.id } }).catch(() => {});
    await prisma.campaign.delete({ where: { id: campaign.id } }).catch(() => {});
    await prisma.$disconnect();
  }
}
main().catch(console.error);
