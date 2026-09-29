-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "enrichmentBudgetCents" INTEGER;

-- CreateTable
CREATE TABLE "EnrichmentCostLedger" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EnrichmentCostLedger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EnrichmentCostLedger_campaignId_idx" ON "EnrichmentCostLedger"("campaignId");

-- CreateIndex
CREATE INDEX "EnrichmentCostLedger_leadId_idx" ON "EnrichmentCostLedger"("leadId");

-- CreateIndex
CREATE INDEX "EnrichmentCostLedger_createdAt_idx" ON "EnrichmentCostLedger"("createdAt");

-- AddForeignKey
ALTER TABLE "EnrichmentCostLedger" ADD CONSTRAINT "EnrichmentCostLedger_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnrichmentCostLedger" ADD CONSTRAINT "EnrichmentCostLedger_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
