-- AlterTable
ALTER TABLE "QueueJob" ADD COLUMN IF NOT EXISTS "bullJobId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "QueueJob_bullJobId_key" ON "QueueJob"("bullJobId");
