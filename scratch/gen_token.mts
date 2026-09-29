import "dotenv/config";
import jwt from "jsonwebtoken";
import { prisma } from "../app/api/src/lib/prisma.js";

const user = await prisma.user.findFirst({
  select: { id: true, email: true, role: true, tokenVersion: true },
});
if (!user) { console.error("No user"); process.exit(1); }

const membership = await prisma.organizationMember.findFirst({
  where: { userId: user.id },
  orderBy: { createdAt: "asc" },
  select: { orgId: true, role: true },
});

const token = jwt.sign(
  {
    userId: user.id,
    email: user.email,
    role: user.role,
    jti: crypto.randomUUID(),
    tokenVersion: user.tokenVersion,
    orgId: membership?.orgId ?? undefined,
    orgRole: membership?.role ?? undefined,
    emailVerified: true,
  },
  process.env.JWT_SECRET!,
  { expiresIn: "15m" }
);
console.log("TOKEN=" + token);
console.log("USER_ID=" + user.id);
console.log("ORG_ID=" + (membership?.orgId ?? "none"));
await prisma.$disconnect();
