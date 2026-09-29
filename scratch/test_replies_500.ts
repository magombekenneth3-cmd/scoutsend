import { prisma } from "../app/api/src/lib/prisma";
import { getRepliesForUser } from "../app/api/src/modules/replies/replies.services";

async function runTest() {
  try {
    console.log("=== Finding a valid userId from User table ===");
    const user = await prisma.user.findFirst();
    if (!user) {
      console.log("No user found in DB");
      return;
    }
    console.log("Found user:", user.id, user.email);

    console.log("=== Executing getRepliesForUser ===");
    const result = await getRepliesForUser(user.id, { page: 1, limit: 20 });
    console.log("Result:", JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.error("=== Exception caught during getRepliesForUser ===");
    console.error("Error name:", err?.name);
    console.error("Error message:", err?.message);
    console.error("Error code:", err?.code);
    console.error("Error meta:", err?.meta);
    console.error("Stack trace:\n", err?.stack);
  } finally {
    await prisma.$disconnect();
  }
}

runTest();
