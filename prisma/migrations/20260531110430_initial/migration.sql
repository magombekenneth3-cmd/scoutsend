/*
  Warnings:

  - A unique constraint covering the columns `[externalMessageId]` on the table `OutreachMessage` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[providerMessageId]` on the table `Reply` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `createdById` to the `SenderDomain` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
ALTER TYPE "CampaignStatus" ADD VALUE 'CANCELED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DeliveryState" ADD VALUE 'SUPPRESSED';
ALTER TYPE "DeliveryState" ADD VALUE 'SENDING';

-- AlterEnum
ALTER TYPE "QueueJobStatus" ADD VALUE 'PAUSED';

-- AlterTable
ALTER TABLE "AITrace" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "costUsd" DOUBLE PRECISION,
ADD COLUMN     "promptVersion" TEXT;

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "previousStatus" "CampaignStatus";

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OutreachMessage" ADD COLUMN     "claimToken" TEXT,
ADD COLUMN     "followUpStep" INTEGER,
ADD COLUMN     "isFollowUp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "nextRetryAt" TIMESTAMP(3),
ADD COLUMN     "retryCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Reply" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "draftBody" TEXT,
ADD COLUMN     "draftSubject" TEXT,
ADD COLUMN     "normalizedBody" TEXT,
ADD COLUMN     "providerMessageId" TEXT;

-- AlterTable
ALTER TABLE "SenderDomain" ADD COLUMN     "createdById" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "AITrace_agentName_idx" ON "AITrace"("agentName");

-- CreateIndex
CREATE INDEX "AITrace_createdAt_idx" ON "AITrace"("createdAt");

-- CreateIndex
CREATE INDEX "AITrace_campaignId_idx" ON "AITrace"("campaignId");

-- CreateIndex
CREATE INDEX "Campaign_createdById_idx" ON "Campaign"("createdById");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE INDEX "Campaign_status_deletedAt_idx" ON "Campaign"("status", "deletedAt");

-- CreateIndex
CREATE INDEX "DeliverabilityEvent_campaignId_idx" ON "DeliverabilityEvent"("campaignId");

-- CreateIndex
CREATE INDEX "DeliverabilityEvent_senderDomainId_idx" ON "DeliverabilityEvent"("senderDomainId");

-- CreateIndex
CREATE INDEX "Lead_campaignId_idx" ON "Lead"("campaignId");

-- CreateIndex
CREATE INDEX "Lead_campaignId_deletedAt_idx" ON "Lead"("campaignId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutreachMessage_externalMessageId_key" ON "OutreachMessage"("externalMessageId");

-- CreateIndex
CREATE INDEX "OutreachMessage_leadId_idx" ON "OutreachMessage"("leadId");

-- CreateIndex
CREATE INDEX "OutreachMessage_deliveryState_idx" ON "OutreachMessage"("deliveryState");

-- CreateIndex
CREATE INDEX "OutreachMessage_approvalStatus_idx" ON "OutreachMessage"("approvalStatus");

-- CreateIndex
CREATE INDEX "OutreachMessage_externalMessageId_idx" ON "OutreachMessage"("externalMessageId");

-- CreateIndex
CREATE INDEX "OutreachMessage_isFollowUp_idx" ON "OutreachMessage"("isFollowUp");

-- CreateIndex
CREATE INDEX "OutreachMessage_leadId_isFollowUp_idx" ON "OutreachMessage"("leadId", "isFollowUp");

-- CreateIndex
CREATE INDEX "OutreachMessage_deliveryState_updatedAt_idx" ON "OutreachMessage"("deliveryState", "updatedAt");

-- CreateIndex
CREATE INDEX "QueueJob_status_idx" ON "QueueJob"("status");

-- CreateIndex
CREATE INDEX "QueueJob_queueName_status_idx" ON "QueueJob"("queueName", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Reply_providerMessageId_key" ON "Reply"("providerMessageId");

-- CreateIndex
CREATE INDEX "Reply_leadId_idx" ON "Reply"("leadId");

-- CreateIndex
CREATE INDEX "Reply_outreachMessageId_idx" ON "Reply"("outreachMessageId");

-- CreateIndex
CREATE INDEX "Reply_intent_idx" ON "Reply"("intent");

-- CreateIndex
CREATE INDEX "Reply_normalizedBody_idx" ON "Reply"("normalizedBody");

-- CreateIndex
CREATE INDEX "SenderDomain_createdById_idx" ON "SenderDomain"("createdById");

-- AddForeignKey
ALTER TABLE "SenderDomain" ADD CONSTRAINT "SenderDomain_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AITrace" ADD CONSTRAINT "AITrace_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
