import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";

async function main() {
  console.log("[+] Running DeliverabilityEventType enum migration...");
  
  const queries = [
    `ALTER TYPE "DeliverabilityEventType" ADD VALUE IF NOT EXISTS 'HEALTH_WARNING'`,
    `ALTER TYPE "DeliverabilityEventType" ADD VALUE IF NOT EXISTS 'HEALTH_DEGRADED'`,
    `ALTER TYPE "DeliverabilityEventType" ADD VALUE IF NOT EXISTS 'HEALTH_BLOCKED'`
  ];

  for (const query of queries) {
    try {
      console.log(`[+] Executing: ${query}`);
      await prisma.$executeRawUnsafe(query);
      console.log(`  [✓] Success`);
    } catch (e: any) {
      console.log(`  [-] Error executing query:`, e.message || e);
    }
  }

  console.log("[✓] Finished executing migration queries.");
}

main()
  .catch((e) => {
    console.error("[-] Migration execution failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
