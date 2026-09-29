-- AlterTable
ALTER TABLE "OutboxEvent" ADD COLUMN IF NOT EXISTS "nextRetryAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "OutboxEvent_status_nextRetryAt_idx" ON "OutboxEvent"("status", "nextRetryAt");
