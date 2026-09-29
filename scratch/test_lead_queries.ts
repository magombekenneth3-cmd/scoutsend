import { prisma } from "../app/api/src/lib/prisma";

async function testLeadQueries() {
  console.log("=== Testing Lead queries ===");

  // 1. Without select
  try {
    console.log("1. Running prisma.lead.findMany() without select...");
    await prisma.lead.findMany({ take: 1 });
    console.log("SUCCESS without select");
  } catch (err: any) {
    console.log("FAILED without select:", err.code, err.message);
  }

  // 2. With select
  try {
    console.log("2. Running prisma.lead.findMany() WITH explicit select...");
    const res = await prisma.lead.findMany({
      take: 1,
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        companyName: true,
      },
    });
    console.log("SUCCESS WITH explicit select! Found:", res.length);
  } catch (err: any) {
    console.log("FAILED WITH select:", err.code, err.message);
  }

  await prisma.$disconnect();
}

testLeadQueries().catch((e) => {
  console.error("Fatal error:", e);
  prisma.$disconnect();
});
