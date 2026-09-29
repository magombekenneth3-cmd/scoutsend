-- Phase 1: Cleanup duplicate SendIntent fields & convert raw string statuses to enums
-- This migration is safe to run on a live database.

-- ============================================================================
-- 1. Remove duplicate SendIntent columns (attempts, lastError)
--    Data is preserved in the canonical columns (attemptCount, errorMessage).
-- ============================================================================

-- Copy any data from `attempts` → `attemptCount` where attemptCount is behind
UPDATE "SendIntent"
SET "attemptCount" = GREATEST("attemptCount", "attempts")
WHERE "attempts" > "attemptCount";

-- Copy any data from `lastError` → `errorMessage` where errorMessage is null
UPDATE "SendIntent"
SET "errorMessage" = "lastError"
WHERE "errorMessage" IS NULL AND "lastError" IS NOT NULL;

-- Drop the duplicate columns
ALTER TABLE "SendIntent" DROP COLUMN IF EXISTS "attempts";
ALTER TABLE "SendIntent" DROP COLUMN IF EXISTS "lastError";

-- ============================================================================
-- 2. Create OutboxEventStatus enum and migrate OutboxEvent.status
-- ============================================================================

CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'PUBLISHED', 'FAILED', 'DEAD_LETTER');

-- Add temporary enum column
ALTER TABLE "OutboxEvent" ADD COLUMN "status_new" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING';

-- Migrate existing data
UPDATE "OutboxEvent" SET "status_new" = "status"::text::"OutboxEventStatus";

-- Swap columns
ALTER TABLE "OutboxEvent" DROP COLUMN "status";
ALTER TABLE "OutboxEvent" RENAME COLUMN "status_new" TO "status";
ALTER TABLE "OutboxEvent" ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- Recreate indexes that reference status
DROP INDEX IF EXISTS "OutboxEvent_status_createdAt_idx";
DROP INDEX IF EXISTS "OutboxEvent_status_nextRetryAt_idx";
DROP INDEX IF EXISTS "OutboxEvent_status_leaseExpiresAt_idx";
DROP INDEX IF EXISTS "OutboxEvent_organizationId_status_idx";
DROP INDEX IF EXISTS "OutboxEvent_organizationId_status_nextRetryAt_idx";
DROP INDEX IF EXISTS "OutboxEvent_organizationId_status_leaseExpiresAt_idx";

CREATE INDEX "OutboxEvent_status_createdAt_idx" ON "OutboxEvent"("status", "createdAt");
CREATE INDEX "OutboxEvent_status_nextRetryAt_idx" ON "OutboxEvent"("status", "nextRetryAt");
CREATE INDEX "OutboxEvent_status_leaseExpiresAt_idx" ON "OutboxEvent"("status", "leaseExpiresAt");
CREATE INDEX "OutboxEvent_organizationId_status_idx" ON "OutboxEvent"("organizationId", "status");
CREATE INDEX "OutboxEvent_organizationId_status_nextRetryAt_idx" ON "OutboxEvent"("organizationId", "status", "nextRetryAt");
CREATE INDEX "OutboxEvent_organizationId_status_leaseExpiresAt_idx" ON "OutboxEvent"("organizationId", "status", "leaseExpiresAt");

-- ============================================================================
-- 3. Create CampaignRunStatus enum and migrate CampaignRun.status
-- ============================================================================

CREATE TYPE "CampaignRunStatus" AS ENUM ('CREATED', 'RUNNING', 'PAUSED', 'COMPLETED', 'FAILED', 'RECOVERING');

-- Add temporary enum column
ALTER TABLE "CampaignRun" ADD COLUMN "status_new" "CampaignRunStatus" NOT NULL DEFAULT 'CREATED';

-- Migrate existing data
UPDATE "CampaignRun" SET "status_new" = "status"::text::"CampaignRunStatus";

-- Swap columns
ALTER TABLE "CampaignRun" DROP COLUMN "status";
ALTER TABLE "CampaignRun" RENAME COLUMN "status_new" TO "status";
ALTER TABLE "CampaignRun" ALTER COLUMN "status" SET DEFAULT 'CREATED';

-- Recreate index that references status
DROP INDEX IF EXISTS "CampaignRun_campaignId_status_idx";
CREATE INDEX "CampaignRun_campaignId_status_idx" ON "CampaignRun"("campaignId", "status");
