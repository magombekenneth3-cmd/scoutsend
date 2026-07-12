import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";
import { runResearchAgent } from "../app/api/src/modules/gemini/research.agent";
import { ResearchStreamEvent } from "../app/api/src/lib/research/research.types";

async function testAgent() {
  console.log("Starting Lead Research Agent integration test...");

  // 1. Get test user
  const user = await prisma.user.findFirst();
  if (!user) {
    throw new Error("No user found in the database. Please seed or create a user first.");
  }
  console.log(`Using test user: ${user.email} (${user.id})`);

  // 2. Create test campaign
  const campaign = await prisma.campaign.create({
    data: {
      name: "Research Test Campaign",
      icpDescription: "High-growth B2B SaaS companies in North America using React and TypeScript, targeting engineering leadership (VP, Director, Head).",
      createdById: user.id,
    },
  });
  console.log(`Created test campaign: ${campaign.name} (${campaign.id})`);

  // 3. Create test lead
  const lead = await prisma.lead.create({
    data: {
      companyName: "Vercel",
      website: "vercel.com",
      campaignId: campaign.id,
      firstName: "Guillermo",
      lastName: "Rauch",
      title: "CEO",
      seniority: "C-Level",
      department: "Management",
    },
  });
  console.log(`Created test lead: ${lead.companyName} (${lead.id})`);

  // 4. Create pending report
  const report = await prisma.leadResearchReport.create({
    data: {
      leadId: lead.id,
      status: "PENDING",
    },
  });
  console.log(`Created pending report: ${report.id}`);

  const events: ResearchStreamEvent[] = [];

  try {
    // 5. Run research agent
    console.log("Running agent (this takes about 15-25 seconds due to multi-stage web searches and generative analysis)...");
    await runResearchAgent(lead.id, report.id, (e) => {
      console.log(`[Stream Event] type=${e.type}`);
      events.push(e);
    }, user.id);

    // 6. Assert results
    const updatedReport = await prisma.leadResearchReport.findUniqueOrThrow({
      where: { id: report.id },
    });

    console.log("\n=== Updated Report Status ===");
    console.log("Status:", updatedReport.status);
    console.log("Error Message:", updatedReport.errorMessage);
    console.log("Snapshot company:", (updatedReport.companySnapshot as any)?.name);
    console.log("Displacement Angle:", (updatedReport.competitiveContext as any)?.displacementAngle);
    console.log("ICP Score:", (updatedReport.icpAlignment as any)?.overallFitScore);
    console.log("Outreach Angle (Primary):", (updatedReport.outreachAngle as any)?.primaryAngle);

    if (updatedReport.status !== "COMPLETE") {
      throw new Error(`Report finished with status ${updatedReport.status}: ${updatedReport.errorMessage}`);
    }

    if (!(updatedReport.companySnapshot as any)?.name) {
      throw new Error("Company snapshot is empty or malformed");
    }

    if ((updatedReport.icpAlignment as any)?.overallFitScore == null) {
      throw new Error("ICP Alignment fit score is missing");
    }

    console.log("\nIntegration test PASSED successfully!");
  } finally {
    // Cleanup
    await prisma.leadResearchReport.deleteMany({ where: { leadId: lead.id } }).catch(console.error);
    await prisma.lead.delete({ where: { id: lead.id } }).catch(console.error);
    await prisma.campaign.delete({ where: { id: campaign.id } }).catch(console.error);
    await prisma.$disconnect();
    console.log("Cleaned up database records.");
  }
}

testAgent().catch((err) => {
  console.error("Test failed:", err);
  prisma.$disconnect().then(() => process.exit(1));
});
