-- CreateTable
CREATE TABLE "CampaignStateStore" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "currentNode" TEXT NOT NULL,
    "regenAttemptsCount" INTEGER NOT NULL DEFAULT 0,
    "approvalStatuses" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignStateStore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignStateStore_campaignId_key" ON "CampaignStateStore"("campaignId");

-- AddForeignKey
ALTER TABLE "CampaignStateStore" ADD CONSTRAINT "CampaignStateStore_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
