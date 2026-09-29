import { prisma } from "../app/api/src/lib/prisma";
import { getRepliesForUser } from "../app/api/src/modules/replies/replies.services";

async function verifyAllRepliesQueries() {
  console.log("=== Finding active user ===");
  const user = await prisma.user.findFirst();
  if (!user) {
    console.error("No user found in database");
    return;
  }
  const userId = user.id;
  console.log("Testing with userId:", userId);

  const testCases = [
    { name: "GET /api/replies?page=1&limit=1", query: { page: 1, limit: 1 } },
    { name: "GET /api/replies?page=1&limit=40", query: { page: 1, limit: 40 } },
    { name: "GET /api/replies?intent=POSITIVE&page=1&limit=1", query: { intent: "POSITIVE" as const, page: 1, limit: 1 } },
    { name: "GET /api/replies?intent=NOT_INTERESTED&page=1&limit=1", query: { intent: "NOT_INTERESTED" as const, page: 1, limit: 1 } },
    { name: "GET /api/replies?requiresHumanReview=true&page=1&limit=1", query: { requiresHumanReview: true, page: 1, limit: 1 } },
  ];

  for (const tc of testCases) {
    try {
      const res = await getRepliesForUser(userId, tc.query);
      console.log(`[PASS] ${tc.name} -> returned ${res.data.length} items (total: ${res.meta.total})`);
    } catch (err: any) {
      console.error(`[FAIL] ${tc.name} -> ${err?.message}`);
    }
  }
}

verifyAllRepliesQueries().finally(() => prisma.$disconnect());
