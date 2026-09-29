-- Forward migration: add SendIntent lease/fencing/CAS/dispatch columns
--
-- Root cause: schema.prisma was redesigned after the original v3_1 migration
-- was applied. This migration carries the physical database forward to match
-- the current Prisma model exactly.
--
-- Table state at time of authorship: 0 rows — no backfill required.
-- All NOT NULL columns use safe defaults matching schema.prisma defaults.
--
-- ADD VALUE note: PostgreSQL 12+ permits ALTER TYPE ... ADD VALUE inside a
-- transaction as long as the new values are not read by DML in the same txn.
-- The existing repo pattern (20260628190000, 20260531110430, etc.) confirms
-- this approach works with Prisma 7.8.0 without @no-transaction pragma.

-- ============================================================================
-- 1. Add missing columns to SendIntent
-- ============================================================================

ALTER TABLE "SendIntent"
  ADD COLUMN IF NOT EXISTS "traceId"                TEXT,
  ADD COLUMN IF NOT EXISTS "provider"               TEXT,
  ADD COLUMN IF NOT EXISTS "payloadHash"            TEXT,
  ADD COLUMN IF NOT EXISTS "lastAttemptAt"          TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "claimedBy"              TEXT,
  ADD COLUMN IF NOT EXISTS "fencingEpoch"           INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "leaseVersion"           INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "leaseExpiresAt"         TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "reconciliationAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "version"                INTEGER NOT NULL DEFAULT 1;

-- ============================================================================
-- 2. Expand SendIntentStatus enum with missing values
--    ADD VALUE is a non-locking operation safe to run on a live PostgreSQL
--    database. IF NOT EXISTS prevents failure on re-run.
-- ============================================================================

ALTER TYPE "SendIntentStatus" ADD VALUE IF NOT EXISTS 'SENT';
ALTER TYPE "SendIntentStatus" ADD VALUE IF NOT EXISTS 'RECONCILING';
ALTER TYPE "SendIntentStatus" ADD VALUE IF NOT EXISTS 'UNRESOLVED';
ALTER TYPE "SendIntentStatus" ADD VALUE IF NOT EXISTS 'HUMAN_REVIEW';

-- ============================================================================
-- 3. Create missing indexes
-- ============================================================================

-- campaignId lookup (simple FK-style scan)
CREATE INDEX IF NOT EXISTS "SendIntent_campaignId_idx"
  ON "SendIntent"("campaignId");

-- mailboxId lookup
CREATE INDEX IF NOT EXISTS "SendIntent_mailboxId_idx"
  ON "SendIntent"("mailboxId");

-- Stale-lease sweeper: find active DISPATCHING intents by holder + expiry
CREATE INDEX IF NOT EXISTS "SendIntent_claimedBy_leaseExpiresAt_idx"
  ON "SendIntent"("claimedBy", "leaseExpiresAt");

-- Stale-lease sweeper: DISPATCHING + expired lease (composite — most selective)
CREATE INDEX IF NOT EXISTS "SendIntent_status_leaseExpiresAt_idx"
  ON "SendIntent"("status", "leaseExpiresAt");

-- UNKNOWN reconciliation sweeper: ordered by oldest first
CREATE INDEX IF NOT EXISTS "SendIntent_status_reconciliationAttempts_updatedAt_idx"
  ON "SendIntent"("status", "reconciliationAttempts", "updatedAt");
