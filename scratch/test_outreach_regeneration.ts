import { prisma } from "../app/api/src/lib/prisma";

async function testOutreachQuery() {
  console.log("=== Testing OutreachMessage standard query ===");
  try {
    const res = await prisma.outreachMessage.findMany({
      where: {
        deliveryState: "DRAFT",
      },
      select: {
        id: true,
        subject: true,
        deliveryState: true,
        approvalStatus: true,
      },
      take: 5,
    });
    console.log("Result items count:", res.length);
    console.log("PASS: Query executed with zero errors!");
  } catch (err: any) {
    console.error("=== Exception caught ===");
    console.error("Error message:", err?.message);
  }
}

testOutreachQuery().finally(() => prisma.$disconnect());
