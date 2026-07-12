import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL!, max: 5 });
const prisma = new PrismaClient({ adapter });

const OLD_NAME = "AISales Platform — Outbound Launch";

async function main() {
  const owner = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true, email: true },
    orderBy: { createdAt: "asc" },
  });
  if (!owner) throw new Error("No ADMIN user found.");

  const old = await prisma.campaign.findFirst({
    where: { name: OLD_NAME, createdById: owner.id },
    select: { id: true },
  });

  if (!old) {
    console.log("Campaign not found — nothing to delete.");
    return;
  }

  await prisma.lead.deleteMany({ where: { campaignId: old.id } });
  await prisma.campaign.delete({ where: { id: old.id } });
  console.log(`✅  Deleted campaign: "${OLD_NAME}" (${old.id}) and all its leads.`);
}

main()
  .catch((e) => { console.error("❌", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
