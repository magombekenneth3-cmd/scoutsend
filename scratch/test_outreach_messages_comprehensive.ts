import { prisma } from "../app/api/src/lib/prisma";
import { getOutreachMessages } from "../app/api/src/modules/messages/message.service";

async function main() {
  console.log("=== Real DB Comprehensive Test for getOutreachMessages() ===");

  const user = await prisma.user.findFirst();
  if (!user) {
    console.log("No user found");
    return;
  }
  const orgId = (user as any).orgId ?? undefined;
  console.log("Found User ID:", user.id);

  // 1. Default request
  console.log("\n--- 1. Default Request ---");
  const resDefault = await getOutreachMessages({ page: 1, limit: 50 }, user.id, orgId);
  console.log("Meta:", JSON.stringify(resDefault.meta));
  console.log("Item count:", resDefault.data.length);
  if (resDefault.data.length > 0) {
    const item = resDefault.data[0];
    console.log("Sample item ID:", item.id);
    console.log("Sample item keys:", Object.keys(item));
    console.log("Sample lead:", JSON.stringify(item.lead));
    console.log("Sample approvedBy:", JSON.stringify(item.approvedBy));
    console.log("Sample _count:", JSON.stringify((item as any)._count));
  }

  // 2. Pagination test
  console.log("\n--- 2. Pagination Test (page: 1, limit: 2 vs page: 2, limit: 2) ---");
  const page1 = await getOutreachMessages({ page: 1, limit: 2 }, user.id, orgId);
  console.log("Page 1 meta:", JSON.stringify(page1.meta), "count:", page1.data.length);
  const page2 = await getOutreachMessages({ page: 2, limit: 2 }, user.id, orgId);
  console.log("Page 2 meta:", JSON.stringify(page2.meta), "count:", page2.data.length);

  // 3. Filter test: approvalStatus
  console.log("\n--- 3. Filter Test: approvalStatus=PENDING ---");
  const pendingRes = await getOutreachMessages({ approvalStatus: "PENDING", page: 1, limit: 10 }, user.id, orgId);
  console.log("Pending count:", pendingRes.meta.total, "items fetched:", pendingRes.data.length);

  // 4. Empty result test
  console.log("\n--- 4. Empty Result Test (nonexistent campaignId) ---");
  const emptyRes = await getOutreachMessages({ campaignId: "non_existent_campaign_12345", page: 1, limit: 10 }, user.id, orgId);
  console.log("Empty result meta:", JSON.stringify(emptyRes.meta), "data length:", emptyRes.data.length);

  console.log("\n=== ALL REAL DB TESTS COMPLETED SUCCESSFULLY ===");
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("Test failed with error:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
