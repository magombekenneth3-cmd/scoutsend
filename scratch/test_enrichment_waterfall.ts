import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";
import { runEnrichmentWaterfall } from "../app/api/src/modules/gemini/enrichment-waterfall.agent";

// Mock environment keys if not present
process.env.PDL_API_KEY = process.env.PDL_API_KEY || "mock_pdl_key";
process.env.PROXYCURL_API_KEY = process.env.PROXYCURL_API_KEY || "mock_proxycurl_key";
process.env.CRUNCHBASE_API_KEY = process.env.CRUNCHBASE_API_KEY || "mock_cb_key";

const originalFetch = globalThis.fetch;

// Setup fetch mock
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const urlStr = input.toString();

  // 1. People Data Labs
  if (urlStr.includes("api.peopledatalabs.com")) {
    if (urlStr.includes("/company/enrich")) {
      return new Response(
        JSON.stringify({
          name: "Acme Corp",
          website: "acme.com",
          industry: "Technology",
          employee_count: 100,
          founded: 2020,
          summary: "Acme is a technology company",
          linkedin_url: "linkedin.com/company/acme",
          location: { country: "United States" },
          technologies: ["React", "TypeScript"],
          total_funding_raised: 5000000,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (urlStr.includes("/person/enrich")) {
      return new Response(
        JSON.stringify({
          first_name: "Jane",
          last_name: "Doe",
          work_email: "jane@acme.com",
          job_title: "VP Engineering",
          job_company_industry: "Technology",
          linkedin_url: "linkedin.com/in/janedoe",
          mobile_phone: "+1234567890",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // 2. Proxycurl
  if (urlStr.includes("nubela.co/api/v1/linkedin")) {
    return new Response(
      JSON.stringify({
        first_name: "Jane",
        last_name: "Doe",
        occupation: "VP Engineering",
        personal_emails: ["jane.doe@personal.com"],
        personal_numbers: ["+1999999999"],
        experiences: [
          {
            title: "VP Engineering",
            company: "Acme Corp",
            starts_at: { year: 2024 },
            ends_at: null,
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // 3. Crunchbase
  if (urlStr.includes("api.crunchbase.com")) {
    if (urlStr.includes("/autocomplete")) {
      return new Response(
        JSON.stringify({
          entities: [{ identifier: { permalink: "acme-corp" } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (urlStr.includes("/entities/organizations/")) {
      return new Response(
        JSON.stringify({
          properties: {
            short_description: "Acme Corp is a startup built on Crunchbase API",
            funding_total: { value_usd: 6000000 },
            founded_on: { year: 2021 },
            categories: [{ value: "Software" }],
            num_employees_enum: "c_00051_00100",
            location_identifiers: [{ location_type: "country", value: "United States" }],
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  return new Response(JSON.stringify({}), { status: 404 });
};

async function runTest() {
  console.log("Starting Enrichment Waterfall integration tests...");

  // 1. Get test user
  const user = await prisma.user.findFirst();
  if (!user) {
    throw new Error("No user found in the database. Please seed or create a user first.");
  }
  console.log(`Using test user: ${user.email} (${user.id})`);

  // 2. Create test campaign
  const campaign = await prisma.campaign.create({
    data: {
      name: "Enrichment Test Campaign",
      icpDescription: "Test ICP",
      createdById: user.id,
    },
  });
  console.log(`Created test campaign: ${campaign.name} (${campaign.id})`);

  // 3. Create test lead
  const lead = await prisma.lead.create({
    data: {
      companyName: "Acme Corp",
      website: "acme.com",
      campaignId: campaign.id,
    },
  });
  console.log(`Created test lead: ${lead.companyName} (${lead.id})`);

  try {
    // 4. Run the enrichment waterfall
    const result = await runEnrichmentWaterfall(lead.id, user.id);
    console.log("Enrichment run result:", result);

    if (!result.companyHit || !result.personHit) {
      throw new Error(`Enrichment failed: companyHit=${result.companyHit}, personHit=${result.personHit}`);
    }

    // 5. Fetch updated lead and assert values
    const updatedLead = await prisma.lead.findUniqueOrThrow({
      where: { id: lead.id },
    });

    console.log("=== Updated Lead Columns ===");
    console.log("First Name:", updatedLead.firstName);
    console.log("Last Name:", updatedLead.lastName);
    console.log("Email:", updatedLead.email);
    console.log("Title:", updatedLead.title);
    console.log("Seniority:", updatedLead.seniority);
    console.log("Enrichment Data:", JSON.stringify(updatedLead.enrichmentData, null, 2));

    if (updatedLead.firstName !== "Jane" || updatedLead.lastName !== "Doe") {
      throw new Error("Person name did not promote to lead top-level columns");
    }
    if (updatedLead.email !== "jane@acme.com") {
      throw new Error("Email did not promote to lead top-level columns");
    }
    if (updatedLead.title !== "VP Engineering") {
      throw new Error("Job title did not promote to lead top-level columns");
    }
    if (updatedLead.seniority !== "VP") {
      throw new Error("Seniority was not correctly inferred");
    }

    const data = updatedLead.enrichmentData as any;
    if (!data?.company || !data?.person) {
      throw new Error("Enrichment data structure is incomplete");
    }

    // Verify company merging: PDL name should win, but Crunchbase short_description might be merged if PDL lacked it
    // Wait, in our mock, PDL has 'summary' (which maps to description), so description should be PDL's summary
    if (data.company.description !== "Acme is a technology company") {
      throw new Error("PDL description should have priority over Crunchbase");
    }
    if (data.company.providerMap.description.source !== "pdl") {
      throw new Error("Description source attribute should be pdl");
    }

    console.log("Integration test PASSED successfully!");
  } finally {
    // Restore fetch
    globalThis.fetch = originalFetch;

    // Cleanup
    await prisma.lead.delete({ where: { id: lead.id } }).catch(console.error);
    await prisma.campaign.delete({ where: { id: campaign.id } }).catch(console.error);
    await prisma.$disconnect();
    console.log("Cleaned up test data and disconnected from database.");
  }
}

runTest().catch((err) => {
  console.error("Test failed:", err);
  prisma.$disconnect().then(() => process.exit(1));
});
