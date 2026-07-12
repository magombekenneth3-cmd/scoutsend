-- AlterTable
ALTER TABLE "SenderDomain" ADD COLUMN     "totalSent" INTEGER NOT NULL DEFAULT 0;

-- AddForeignKey
ALTER TABLE "LearningEvent" ADD CONSTRAINT "LearningEvent_outreachMessageId_fkey" FOREIGN KEY ("outreachMessageId") REFERENCES "OutreachMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
