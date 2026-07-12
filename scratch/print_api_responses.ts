import "dotenv/config";
import jwt from "jsonwebtoken";
import { prisma } from "../app/api/src/lib/prisma";

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

  const resCampaigns = await fetch("http://127.0.0.1:8080/campaigns", {
    headers: { Authorization: `Bearer ${token}` }
  });
  const campaigns = await resCampaigns.json() as any[];
  console.log("Campaigns returned by API:", campaigns.length);
  if (campaigns.length > 0) {
    console.log("First campaign:", JSON.stringify(campaigns[0], null, 2));
  }

  const resLeads = await fetch("http://127.0.0.1:8080/leads", {
    headers: { Authorization: `Bearer ${token}` }
  });
  const leads = await resLeads.json() as any;
  console.log("Leads returned by API (data count):", leads.data?.length);
  console.log("Leads meta:", leads.meta);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
