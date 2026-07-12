import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";

async function main() {
  const settings = await prisma.brandSettings.findMany({});
  console.log("=== BRAND SETTINGS ===");
  console.dir(settings, { depth: null });
  await prisma.$disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
