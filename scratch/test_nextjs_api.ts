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

  const res = await fetch("http://127.0.0.1:3000/api/leads?page=1&limit=20", {
    headers: {
      Cookie: `token=${token}`,
    },
  });
  console.log("Next.js response status:", res.status);
  const text = await res.text();
  console.log("Next.js response body:", text);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
