/**
 * Resets the password for kennethdavid25@gm.com to a known value.
 * Run: npx tsx scratch/reset_password.ts
 */
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter, log: ["error"] });

async function main() {
  const NEW_PASSWORD = "ScoutSend2024!";
  const EMAIL = "kennethdavid25@gm.com";

  const hash = await bcrypt.hash(NEW_PASSWORD, 12);
  const user = await prisma.user.update({
    where: { email: EMAIL },
    data: { passwordHash: hash, tokenVersion: { increment: 1 } },
    select: { id: true, email: true, firstName: true },
  });

  console.log(`✅ Password reset for ${user.email} (${user.id})`);
  console.log(`   New password: ${NEW_PASSWORD}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
