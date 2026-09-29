import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const useSSL =
    process.env.DATABASE_SSL === "true" ||
    connectionString.includes("sslmode=require");

  // SECURITY FIX: removed rejectUnauthorized: false.
  // Set DATABASE_SSL_REJECT_UNAUTHORIZED=false only for dev environments
  // where a self-signed cert is intentional (e.g. local Docker Postgres).
  // In production this should always be true (default).
  const rejectUnauthorized =
    process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false";

  const adapter = new PrismaPg({
    connectionString,
    max: parseInt(process.env.DB_POOL_SIZE ?? "10", 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 20_000,
    ...(useSSL ? { ssl: { rejectUnauthorized } } : {}),
  } as any);

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "production"
      ? ["error", "warn"]
      : ["query", "error", "warn"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export { forTenant, forOrg } from "./prisma-tenant";