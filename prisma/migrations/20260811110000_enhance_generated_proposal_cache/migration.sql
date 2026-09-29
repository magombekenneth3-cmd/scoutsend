-- AlterTable
ALTER TABLE "GeneratedProposalCache" 
ADD COLUMN "reasoning" TEXT,
ADD COLUMN "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '1 day',
ADD COLUMN "tokenInput" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "tokenOutput" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "tokenTotal" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "latencyMs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "leaseToken" TEXT,
ADD COLUMN "leaseExpiresAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "GeneratedProposalCache_leadId_campaignId_contextHash_idx" ON "GeneratedProposalCache"("leadId", "campaignId", "contextHash");

-- CreateIndex
CREATE INDEX "GeneratedProposalCache_persistenceStatus_updatedAt_idx" ON "GeneratedProposalCache"("persistenceStatus", "updatedAt");
