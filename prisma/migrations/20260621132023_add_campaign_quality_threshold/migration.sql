-- CreateTable
CREATE TABLE "CampaignQualityThreshold" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "spamRiskMax" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "personalizationMin" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignQualityThreshold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignQualityThreshold_campaignId_key" ON "CampaignQualityThreshold"("campaignId");

-- CreateIndex
CREATE INDEX "CampaignQualityThreshold_campaignId_idx" ON "CampaignQualityThreshold"("campaignId");

-- AddForeignKey
ALTER TABLE "CampaignQualityThreshold" ADD CONSTRAINT "CampaignQualityThreshold_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
