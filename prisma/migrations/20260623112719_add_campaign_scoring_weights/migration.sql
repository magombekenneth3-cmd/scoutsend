-- CreateEnum
CREATE TYPE "ResearchStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETE', 'FAILED', 'STALE');

-- CreateTable
CREATE TABLE "CampaignScoringWeights" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "icpMatch" DOUBLE PRECISION NOT NULL DEFAULT 0.25,
    "intentStrength" DOUBLE PRECISION NOT NULL DEFAULT 0.30,
    "fundingSignals" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "hiringVelocity" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "techFit" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
    "recency" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignScoringWeights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadResearchReport" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "status" "ResearchStatus" NOT NULL DEFAULT 'PENDING',
    "errorMessage" TEXT,
    "companySnapshot" JSONB,
    "competitiveContext" JSONB,
    "icpAlignment" JSONB,
    "outreachAngle" JSONB,
    "newSignalsFound" JSONB,
    "triggeredById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "LeadResearchReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignScoringWeights_campaignId_key" ON "CampaignScoringWeights"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignScoringWeights_campaignId_idx" ON "CampaignScoringWeights"("campaignId");

-- CreateIndex
CREATE INDEX "LeadResearchReport_leadId_idx" ON "LeadResearchReport"("leadId");

-- CreateIndex
CREATE INDEX "LeadResearchReport_leadId_status_idx" ON "LeadResearchReport"("leadId", "status");

-- CreateIndex
CREATE INDEX "LeadResearchReport_expiresAt_idx" ON "LeadResearchReport"("expiresAt");

-- AddForeignKey
ALTER TABLE "CampaignScoringWeights" ADD CONSTRAINT "CampaignScoringWeights_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadResearchReport" ADD CONSTRAINT "LeadResearchReport_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadResearchReport" ADD CONSTRAINT "LeadResearchReport_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
