-- CreateEnum
CREATE TYPE "PipelineStage" AS ENUM ('PROSPECT', 'ENGAGED', 'HOT', 'MEETING_BOOKED', 'DISQUALIFIED');

-- AlterTable
ALTER TABLE "DeliverabilityEvent" ADD COLUMN     "senderMailboxId" TEXT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "pipelineStage" "PipelineStage" NOT NULL DEFAULT 'PROSPECT',
ADD COLUMN     "pipelineStageUpdatedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Reply" ADD COLUMN     "meetingLinkInjected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "objectionCategory" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "DeliverabilityEvent_senderMailboxId_idx" ON "DeliverabilityEvent"("senderMailboxId");

-- CreateIndex
CREATE INDEX "Lead_pipelineStage_idx" ON "Lead"("pipelineStage");

-- CreateIndex
CREATE INDEX "Lead_campaignId_pipelineStage_idx" ON "Lead"("campaignId", "pipelineStage");

-- CreateIndex
CREATE INDEX "LearningEvent_outreachMessageId_idx" ON "LearningEvent"("outreachMessageId");

-- CreateIndex
CREATE INDEX "LearningEvent_eventType_idx" ON "LearningEvent"("eventType");

-- CreateIndex
CREATE INDEX "LearningEvent_createdAt_idx" ON "LearningEvent"("createdAt");

-- CreateIndex
CREATE INDEX "LossRecord_campaignId_idx" ON "LossRecord"("campaignId");

-- CreateIndex
CREATE INDEX "LossRecord_outreachMessageId_idx" ON "LossRecord"("outreachMessageId");

-- CreateIndex
CREATE INDEX "LossRecord_replyId_idx" ON "LossRecord"("replyId");

-- CreateIndex
CREATE INDEX "Reply_draftSentBy_idx" ON "Reply"("draftSentBy");

-- CreateIndex
CREATE INDEX "WinRecord_campaignId_idx" ON "WinRecord"("campaignId");

-- CreateIndex
CREATE INDEX "WinRecord_outreachMessageId_idx" ON "WinRecord"("outreachMessageId");

-- CreateIndex
CREATE INDEX "WinRecord_replyId_idx" ON "WinRecord"("replyId");

-- AddForeignKey
ALTER TABLE "Reply" ADD CONSTRAINT "Reply_draftSentBy_fkey" FOREIGN KEY ("draftSentBy") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WinRecord" ADD CONSTRAINT "WinRecord_outreachMessageId_fkey" FOREIGN KEY ("outreachMessageId") REFERENCES "OutreachMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WinRecord" ADD CONSTRAINT "WinRecord_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "Reply"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WinRecord" ADD CONSTRAINT "WinRecord_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WinRecord" ADD CONSTRAINT "WinRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LossRecord" ADD CONSTRAINT "LossRecord_outreachMessageId_fkey" FOREIGN KEY ("outreachMessageId") REFERENCES "OutreachMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LossRecord" ADD CONSTRAINT "LossRecord_replyId_fkey" FOREIGN KEY ("replyId") REFERENCES "Reply"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LossRecord" ADD CONSTRAINT "LossRecord_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverabilityEvent" ADD CONSTRAINT "DeliverabilityEvent_senderMailboxId_fkey" FOREIGN KEY ("senderMailboxId") REFERENCES "SenderMailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;
