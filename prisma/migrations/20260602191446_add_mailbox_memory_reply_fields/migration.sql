-- CreateEnum
CREATE TYPE "SignalType" AS ENUM ('HIRING_SIGNAL', 'FUNDING_SIGNAL', 'GROWTH_SIGNAL', 'TECH_SIGNAL', 'INTENT_SIGNAL', 'RISK_SIGNAL', 'WEBSITE_COPY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MailProviderType" AS ENUM ('GMAIL', 'OUTLOOK', 'SMTP');

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "senderMailboxId" TEXT;

-- AlterTable
ALTER TABLE "OutreachMessage" ADD COLUMN     "deliveredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Reply" ADD COLUMN     "draftExternalId" TEXT,
ADD COLUMN     "draftSentAt" TIMESTAMP(3),
ADD COLUMN     "draftSentBy" TEXT;

-- CreateTable
CREATE TABLE "WinRecord" (
    "id" TEXT NOT NULL,
    "icpVertical" TEXT,
    "targetIndustry" TEXT,
    "targetRegion" TEXT,
    "signalType" "SignalType" NOT NULL,
    "signalValue" TEXT NOT NULL,
    "subjectPattern" TEXT NOT NULL,
    "bodyOpeningPattern" TEXT NOT NULL,
    "tone" TEXT,
    "replyIntent" TEXT NOT NULL,
    "sentimentScore" DOUBLE PRECISION,
    "outreachMessageId" TEXT NOT NULL,
    "replyId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WinRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LossRecord" (
    "id" TEXT NOT NULL,
    "icpVertical" TEXT,
    "targetIndustry" TEXT,
    "targetRegion" TEXT,
    "signalUsed" TEXT,
    "inferredObjection" TEXT NOT NULL,
    "bodyPattern" TEXT,
    "tone" TEXT,
    "replyIntent" TEXT NOT NULL,
    "sentimentScore" DOUBLE PRECISION,
    "outreachMessageId" TEXT NOT NULL,
    "replyId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LossRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SenderMailbox" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "providerType" "MailProviderType" NOT NULL,
    "credentials" JSONB NOT NULL,
    "dailyLimit" INTEGER NOT NULL DEFAULT 50,
    "currentSent" INTEGER NOT NULL DEFAULT 0,
    "totalSent" INTEGER NOT NULL DEFAULT 0,
    "warmupEnabled" BOOLEAN NOT NULL DEFAULT true,
    "health" "DomainHealth" NOT NULL DEFAULT 'HEALTHY',
    "bounceRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "complaintRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "reputationScore" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "lastReplyCheckedAt" TIMESTAMP(3),
    "lastDeliveryCheckedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SenderMailbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WinRecord_createdAt_idx" ON "WinRecord"("createdAt");

-- CreateIndex
CREATE INDEX "WinRecord_icpVertical_idx" ON "WinRecord"("icpVertical");

-- CreateIndex
CREATE INDEX "WinRecord_signalType_idx" ON "WinRecord"("signalType");

-- CreateIndex
CREATE INDEX "LossRecord_createdAt_idx" ON "LossRecord"("createdAt");

-- CreateIndex
CREATE INDEX "LossRecord_icpVertical_idx" ON "LossRecord"("icpVertical");

-- CreateIndex
CREATE INDEX "SenderMailbox_createdById_idx" ON "SenderMailbox"("createdById");

-- CreateIndex
CREATE INDEX "Reply_draftSentAt_idx" ON "Reply"("draftSentAt");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_senderMailboxId_fkey" FOREIGN KEY ("senderMailboxId") REFERENCES "SenderMailbox"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SenderMailbox" ADD CONSTRAINT "SenderMailbox_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
