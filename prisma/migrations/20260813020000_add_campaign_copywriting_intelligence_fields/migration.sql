-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN "businessDescription" TEXT,
ADD COLUMN "valueProposition" TEXT,
ADD COLUMN "provenStats" JSONB,
ADD COLUMN "inboundEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "requireVerifiedEmailForGeneration" BOOLEAN NOT NULL DEFAULT false;
