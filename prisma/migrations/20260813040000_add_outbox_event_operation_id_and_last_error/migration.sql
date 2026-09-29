-- AlterTable
ALTER TABLE "OutboxEvent" ADD COLUMN "operationId" TEXT,
ADD COLUMN "lastError" TEXT;

-- CreateIndex
CREATE INDEX "OutboxEvent_operationId_idx" ON "OutboxEvent"("operationId");
