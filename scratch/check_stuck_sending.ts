import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";

async function main() {
  const now = new Date();

  // Messages stuck in SENDING state
  const stuckMessages = await prisma.outreachMessage.findMany({
    where: { deliveryState: "SENDING" },
    select: {
      id: true,
      deliveryState: true,
      claimToken: true,
      externalMessageId: true,
      retryCount: true,
      updatedAt: true,
      lastError: true,
      lead: {
        select: {
          campaignId: true,
          email: true,
        },
      },
    },
    orderBy: { updatedAt: "asc" },
    take: 50,
  });

  console.log(`\n=== Messages stuck in SENDING (${stuckMessages.length} total) ===`);
  for (const m of stuckMessages) {
    const ageMin = Math.round((now.getTime() - m.updatedAt.getTime()) / 60_000);
    console.log({
      id: m.id.slice(0, 8) + "...",
      campaignId: m.lead.campaignId.slice(0, 8) + "...",
      email: m.lead.email,
      claimToken: m.claimToken ? m.claimToken.slice(0, 20) + "..." : null,
      externalMessageId: m.externalMessageId,
      retryCount: m.retryCount,
      ageMinutes: ageMin,
      lastError: m.lastError,
    });
  }

  // Campaigns in SENDING state
  const sendingCampaigns = await prisma.campaign.findMany({
    where: { status: "SENDING", deletedAt: null },
    select: { id: true, name: true, status: true, updatedAt: true, senderMailboxId: true },
  });
  console.log(`\n=== Campaigns in SENDING status (${sendingCampaigns.length}) ===`);
  for (const c of sendingCampaigns) {
    const ageMin = Math.round((now.getTime() - c.updatedAt.getTime()) / 60_000);
    console.log({ id: c.id.slice(0, 8) + "...", name: c.name, ageMinutes: ageMin, hasMailbox: !!c.senderMailboxId });
  }

  // Count by deliveryState
  const counts = await prisma.outreachMessage.groupBy({
    by: ["deliveryState"],
    _count: { _all: true },
  });
  console.log("\n=== OutreachMessage deliveryState breakdown ===");
  console.log(counts.map(c => ({ state: c.deliveryState, count: c._count._all })));

  // Check if any stuck messages have a claimToken set (actively claimed by a live worker)
  const withClaim = stuckMessages.filter(m => m.claimToken !== null);
  const withoutClaim = stuckMessages.filter(m => m.claimToken === null);
  const withExternalId = stuckMessages.filter(m => m.externalMessageId !== null);

  console.log(`\n=== Analysis ===`);
  console.log(`  With claimToken (actively being sent or leaked):  ${withClaim.length}`);
  console.log(`  Without claimToken (stuck without claim):         ${withoutClaim.length}`);
  console.log(`  With externalMessageId (actually sent already):   ${withExternalId.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
