import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";

async function main() {
  console.log("=== Querying Users ===");
  try {
    const users = await prisma.user.findMany();
    for (const u of users) {
      console.log(`- ID: ${u.id}`);
      console.log(`  Email: ${u.email}`);
      console.log(`  FirstName: ${u.firstName}`);
      console.log(`  Role: ${u.role}`);
    }
  } catch (e: any) {
    console.error("[-] Error querying users:", e.message || e);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
