import Jwt from "jsonwebtoken";
import { prisma } from "../app/api/src/lib/prisma";

async function main() {
  console.log("Generating token for user...");
  const user = await prisma.user.findFirst({
    select: { id: true, email: true, role: true, tokenVersion: true }
  });

  if (!user) {
    console.log("No user found");
    return;
  }

  const jti = "test-jti-123456";
  const token = Jwt.sign(
    { userId: user.id, email: user.email, role: user.role, jti, tokenVersion: user.tokenVersion },
    process.env.JWT_SECRET!,
    { expiresIn: "7d" }
  );

  console.log(`Sending GET request to http://localhost:8080/replies?intent=QUESTION&page=1&limit=1`);
  const start = Date.now();
  try {
    const res = await fetch("http://localhost:8080/replies?intent=QUESTION&page=1&limit=1", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });
    const status = res.status;
    const body = await res.json();
    console.log(`Response status: ${status}`);
    console.log(`Response body:`, JSON.stringify(body, null, 2));
    console.log(`Time taken: ${Date.now() - start}ms`);
  } catch (error) {
    console.error("Request failed:", error);
    console.log(`Time taken until failure: ${Date.now() - start}ms`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
