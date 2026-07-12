import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, firstName: true, lastName: true }
  });
  console.log("=== Users ===");
  console.log(users);

  const mailboxes = await prisma.senderMailbox.findMany({
    select: { id: true, emailAddress: true, label: true, providerType: true, health: true }
  });
  console.log("\n=== Sender Mailboxes ===");
  console.log(mailboxes);

  const domains = await prisma.senderDomain.findMany({
    select: { id: true, domain: true, health: true }
  });
  console.log("\n=== Sender Domains ===");
  console.log(domains);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
