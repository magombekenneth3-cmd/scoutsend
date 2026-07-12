import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";

async function main() {
  console.log("[+] Running migration 20260621200000_add_catchall_templatestyle...");
  
  // 1. Create CatchAllPolicy Enum
  try {
    await prisma.$executeRawUnsafe(`CREATE TYPE "CatchAllPolicy" AS ENUM ('SKIP', 'SEND', 'HOLD')`);
    console.log("  [✓] Created CatchAllPolicy ENUM type");
  } catch (e: any) {
    console.log("  [-] CatchAllPolicy ENUM might already exist:", e.message || e);
  }

  // 2. Create TemplateStyle Enum
  try {
    await prisma.$executeRawUnsafe(`CREATE TYPE "TemplateStyle" AS ENUM ('BRANDED', 'PLAIN')`);
    console.log("  [✓] Created TemplateStyle ENUM type");
  } catch (e: any) {
    console.log("  [-] TemplateStyle ENUM might already exist:", e.message || e);
  }

  // 3. Add emailCatchAll to Lead table
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Lead" ADD COLUMN "emailCatchAll" BOOLEAN NOT NULL DEFAULT false`);
    console.log("  [✓] Added emailCatchAll to Lead table");
  } catch (e: any) {
    console.log("  [-] Failed to add emailCatchAll to Lead table:", e.message || e);
  }

  // 4. Add catchAllPolicy to Campaign table
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Campaign" ADD COLUMN "catchAllPolicy" "CatchAllPolicy" NOT NULL DEFAULT 'SKIP'`);
    console.log("  [✓] Added catchAllPolicy to Campaign table");
  } catch (e: any) {
    console.log("  [-] Failed to add catchAllPolicy to Campaign table:", e.message || e);
  }

  // 5. Add templateStyle to Campaign table
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "Campaign" ADD COLUMN "templateStyle" "TemplateStyle" NOT NULL DEFAULT 'BRANDED'`);
    console.log("  [✓] Added templateStyle to Campaign table");
  } catch (e: any) {
    console.log("  [-] Failed to add templateStyle to Campaign table:", e.message || e);
  }

  console.log("\n[+] Running migration 20260621210000_add_dkim_fields...");

  // 6. Add dkimSelector to SenderDomain table
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "SenderDomain" ADD COLUMN "dkimSelector" TEXT`);
    console.log("  [✓] Added dkimSelector to SenderDomain table");
  } catch (e: any) {
    console.log("  [-] Failed to add dkimSelector to SenderDomain table:", e.message || e);
  }

  // 7. Add dkimPublicKey to SenderDomain table
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "SenderDomain" ADD COLUMN "dkimPublicKey" TEXT`);
    console.log("  [✓] Added dkimPublicKey to SenderDomain table");
  } catch (e: any) {
    console.log("  [-] Failed to add dkimPublicKey to SenderDomain table:", e.message || e);
  }

  console.log("\n[✓] Migrations finished.");
}

main()
  .catch((e) => {
    console.error("[-] Error executing migrations script:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
