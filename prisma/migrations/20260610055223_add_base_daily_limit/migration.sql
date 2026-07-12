-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "enrichmentData" JSONB;

-- AlterTable
ALTER TABLE "SenderMailbox" ADD COLUMN     "baseDailyLimit" INTEGER NOT NULL DEFAULT 50;
