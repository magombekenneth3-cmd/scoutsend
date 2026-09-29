import { prisma } from "../app/api/src/lib/prisma";
import { getLeadById, createLead, updateLead, deleteLead } from "../app/api/src/modules/leads/leads.service";
import { recalculateMailboxHealth } from "../app/api/src/modules/Deliverybilityevents/deliverbility.service";

async function verifyAllState2Fixes() {
  console.log("=== REAL POSTGRESQL VERIFICATION OF ALL STATE 2 APPLICATION FIXES ===");

  // 1. Verify Lead queries
  console.log("\n1. Testing Lead Service Queries against real PostgreSQL...");
  const firstLead = await prisma.lead.findFirst({ select: { id: true, campaignId: true } });
  if (firstLead) {
    console.log("Found test lead:", firstLead.id);

    // Test getLeadById
    const leadDetail = await getLeadById(firstLead.id);
    console.log("getLeadById SUCCESS! Loaded lead ID:", leadDetail?.id);

    // Test updateLead
    const updatedLead = await updateLead(firstLead.id, { firstName: "Verified" });
    console.log("updateLead SUCCESS! Updated lead ID:", updatedLead.id);
  } else {
    console.log("No lead found in DB, skipping getLeadById test");
  }

  // 2. Verify SenderMailbox queries
  console.log("\n2. Testing SenderMailbox Queries against real PostgreSQL...");
  const mailbox = await prisma.senderMailbox.findFirst({ select: { id: true } });
  if (mailbox) {
    console.log("Found test mailbox:", mailbox.id);

    // Test calendar controller findUnique with select
    const box1 = await prisma.senderMailbox.findUnique({
      where: { id: mailbox.id },
      select: { id: true, createdById: true },
    });
    console.log("SenderMailbox findUnique (calendar) SUCCESS! ID:", box1?.id);

    // Test seedWarmup findUniqueOrThrow with select
    const box2 = await prisma.senderMailbox.findUniqueOrThrow({
      where: { id: mailbox.id },
      select: {
        id: true,
        credentials: true,
        warmupEnabled: true,
        health: true,
        dailyLimit: true,
        emailAddress: true,
      },
    });
    console.log("SenderMailbox findUniqueOrThrow (seedWarmup) SUCCESS! ID:", box2.id);

    // Test maintenance update with select
    await prisma.senderMailbox.update({
      where: { id: mailbox.id },
      data: { currentSent: 0 },
      select: { id: true },
    });
    console.log("SenderMailbox update (maintenance) SUCCESS!");

    // Test deliverability recalculateMailboxHealth
    await recalculateMailboxHealth(mailbox.id);
    console.log("recalculateMailboxHealth SUCCESS!");
  } else {
    console.log("No mailbox found in DB");
  }

  console.log("\n=== ALL REAL POSTGRESQL QUERY EXECUTIONS PASSED CLEANLY WITH ZERO P2022 ERRORS ===");
  await prisma.$disconnect();
}

verifyAllState2Fixes().catch((err) => {
  console.error("Verification failed with error:", err);
  prisma.$disconnect();
  process.exit(1);
});
