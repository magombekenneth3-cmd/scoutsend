-- AlterTable
ALTER TABLE "OutboxEvent" ADD COLUMN IF NOT EXISTS "leaseToken" TEXT,
ADD COLUMN IF NOT EXISTS "leaseExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OutboxEvent_status_leaseExpiresAt_idx" ON "OutboxEvent"("status", "leaseExpiresAt");
