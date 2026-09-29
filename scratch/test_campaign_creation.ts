import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    console.log("=== APPLICATION VERIFICATION: CAMPAIGN CREATION WITH COPYWRITING & INBOUND FIELDS ===");
    
    // Find an existing org and user to link the test campaign
    const org = await prisma.organization.findFirst();
    const user = await prisma.user.findFirst();

    if (!org || !user) {
        throw new Error("Cannot run test: No Organization or User found in DB.");
    }

    console.log(`Using Org ID: ${org.id}, User ID: ${user.id}`);

    const testCampaign = await prisma.campaign.create({
        data: {
            name: "Migration Test Campaign " + Date.now(),
            icpDescription: "ICP test description",
            businessDescription: "Automated B2B Outreach Platform for Mid-Market Enterprises",
            valueProposition: "Increase qualified meetings by 3x with AI copywriting intelligence",
            provenStats: { avgOpenRate: "68%", conversionLift: "+42%" },
            inboundEnabled: true,
            requireVerifiedEmailForGeneration: true,
            orgId: org.id,
            createdById: user.id,
        },
    });

    console.log("\n✅ Campaign successfully created! Record:");
    console.log({
        id: testCampaign.id,
        name: testCampaign.name,
        businessDescription: testCampaign.businessDescription,
        valueProposition: testCampaign.valueProposition,
        provenStats: testCampaign.provenStats,
        inboundEnabled: testCampaign.inboundEnabled,
        requireVerifiedEmailForGeneration: testCampaign.requireVerifiedEmailForGeneration,
    });

    // Verify retrieval
    const retrieved = await prisma.campaign.findUnique({
        where: { id: testCampaign.id },
    });

    if (
        retrieved?.businessDescription === "Automated B2B Outreach Platform for Mid-Market Enterprises" &&
        retrieved?.valueProposition === "Increase qualified meetings by 3x with AI copywriting intelligence" &&
        retrieved?.inboundEnabled === true &&
        retrieved?.requireVerifiedEmailForGeneration === true
    ) {
        console.log("\n✅ Retrieval verification PASSED: All fields match exact values stored.");
    } else {
        throw new Error("Retrieval verification failed: Stored values do not match expected input!");
    }

    // Cleanup test record
    await prisma.campaign.delete({
        where: { id: testCampaign.id },
    });
    console.log("\n✅ Cleaned up test campaign record.");
}

main()
    .catch((err) => {
        console.error("\n❌ CAMPAIGN CREATION TEST FAILED:", err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
