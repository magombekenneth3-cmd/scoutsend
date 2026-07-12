import "dotenv/config";
import jwt from "jsonwebtoken";
import { prisma } from "../app/api/src/lib/prisma";
import { execSync } from "child_process";

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: "kennethdavid25@gm.com" },
  });
  if (!user) {
    console.error("User not found");
    return;
  }

  const JWT_SECRET = process.env.JWT_SECRET!;
  const token = jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      jti: "test-jti",
      tokenVersion: user.tokenVersion,
    },
    JWT_SECRET,
    { expiresIn: "1h" }
  );

  console.log("Token:", token);

  console.log("=== Curl to /api/campaigns ===");
  try {
    const resCampaigns = execSync(`curl -s -H "Cookie: token=${token}" http://localhost:3000/api/campaigns`);
    console.log(resCampaigns.toString());
  } catch (err: any) {
    console.error("Curl campaigns error:", err.message);
  }

  console.log("=== Curl to /api/leads ===");
  try {
    const resLeads = execSync(`curl -s -H "Cookie: token=${token}" "http://localhost:3000/api/leads?page=1&limit=20"`);
    console.log(resLeads.toString());
  } catch (err: any) {
    console.error("Curl leads error:", err.message);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
