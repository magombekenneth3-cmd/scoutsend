import { prisma } from "../app/api/src/lib/prisma";
import { getOutreachMessages } from "../app/api/src/modules/messages/message.service";

async function main() {
  console.log("=== Testing getOutreachMessages() ===");

  const user = await prisma.user.findFirst();
  if (!user) {
    console.log("No user found");
    return;
  }
  const orgId = (user as any).orgId ?? undefined;
  console.log("Found user:", user.id, "orgId:", orgId);

  try {
    const res = await getOutreachMessages(
      { page: 1, limit: 50 },
      user.id,
      orgId
    );
    console.log("Result success:", res.meta);
  } catch (err: any) {
    console.error("EXACT EXCEPTION CAPTURED:");
    console.error(err);
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
    process.exit(0);
  })
  .catch(async (e) => {
    console.error("Fatal error:", e);
    await prisma.$disconnect();
    process.exit(1);
  });
