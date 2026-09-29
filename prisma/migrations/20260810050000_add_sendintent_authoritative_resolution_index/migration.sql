-- CreateIndex
CREATE INDEX "SendIntent_campaignId_createdAt_id_idx" ON "SendIntent"("campaignId", "createdAt" DESC, "id" DESC);
