-- CreateEnums
CREATE TYPE "QuotaScope" AS ENUM ('ORGANIZATION', 'MAILBOX', 'DOMAIN', 'CAMPAIGN', 'GLOBAL', 'SMTP_HOST');
CREATE TYPE "QuotaReservationStatus" AS ENUM ('RESERVED', 'CONSUMED', 'HELD', 'RELEASED', 'EXPIRED', 'ACTIVE', 'COMMITTED');

-- CreateTable: QuotaReservation
CREATE TABLE "QuotaReservation" (
    "id" TEXT NOT NULL,
    "scope" "QuotaScope" NOT NULL,
    "targetId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "QuotaReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuotaReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuotaReservation_scope_targetId_status_idx" ON "QuotaReservation"("scope", "targetId", "status");
CREATE INDEX "QuotaReservation_expiresAt_idx" ON "QuotaReservation"("expiresAt");

-- CreateTable: CampaignRun
CREATE TABLE "CampaignRun" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CampaignRun_campaignId_idx" ON "CampaignRun"("campaignId");
CREATE INDEX "CampaignRun_status_idx" ON "CampaignRun"("status");

-- AddForeignKey
ALTER TABLE "CampaignRun" ADD CONSTRAINT "CampaignRun_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: CampaignRunLease
CREATE TABLE "CampaignRunLease" (
    "id" TEXT NOT NULL,
    "campaignRunId" TEXT NOT NULL,
    "leaseToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CampaignRunLease_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRunLease_campaignRunId_key" ON "CampaignRunLease"("campaignRunId");
CREATE INDEX "CampaignRunLease_expiresAt_idx" ON "CampaignRunLease"("expiresAt");

-- AddForeignKey
ALTER TABLE "CampaignRunLease" ADD CONSTRAINT "CampaignRunLease_campaignRunId_fkey"
    FOREIGN KEY ("campaignRunId") REFERENCES "CampaignRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
