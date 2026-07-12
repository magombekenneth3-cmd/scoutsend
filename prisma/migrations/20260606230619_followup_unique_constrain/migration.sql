/*
  Warnings:

  - A unique constraint covering the columns `[leadId,followUpStep]` on the table `OutreachMessage` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "OutreachMessage_leadId_followUpStep_key" ON "OutreachMessage"("leadId", "followUpStep");
