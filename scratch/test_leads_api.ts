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

  console.log("Generated token:", token);

  async function testRoute(urlPath: string) {
    const fullUrl = `http://127.0.0.1:8080${urlPath}`;
    console.log(`\nFetching: ${fullUrl}`);
    try {
      const res = await fetch(fullUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
      console.log("Status:", res.status);
      const json = await res.json();
      console.log("Response:", JSON.stringify(json, null, 2));
    } catch (err) {
      console.error("Error fetching:", err);
    }
  }

  await testRoute("/campaigns");
  await testRoute("/leads");
  await testRoute("/leads?campaignId=cmqtw0z6v0000vc1ze5oxam6m");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
