-- ============================================================================
-- Migration: 20260816000000_align_quota_reservation_schema
-- Purpose:   Bring QuotaReservation physical table into exact alignment with
--            the current Prisma schema (schema.prisma model QuotaReservation).
--
-- EXECUTION CONTEXT (2026-08-16):
--   A prior partial execution of this migration completed steps 1-5 before
--   failing at the DROP TYPE step (PostgreSQL 2BP01: dependent object on column
--   default). The ledger was rolled back via `prisma migrate resolve --rolled-back`.
--
--   ACTUAL CURRENT DB STATE (verified):
--     - targetId already renamed to scopeId   ✅
--     - operationId column already added       ✅
--     - windowStart column already added       ✅
--     - version column already added           ✅
--     - scope_targetId_status index dropped    ✅
--     - status column is now TEXT (not enum)   ← column type lost, must restore
--     - QuotaReservationStatus enum: 7 values still exist (EXPIRED/ACTIVE/COMMITTED present)
--     - No new indexes created yet
--     - Table still contains 0 rows
--
--   This version resumes from exactly the current state.
--
-- Changes remaining to apply:
--   1. Drop old column DEFAULT (which still references old enum type by text expression).
--   2. Drop the old 7-value QuotaReservationStatus enum.
--   3. Create new 4-value QuotaReservationStatus enum.
--   4. Restore status column type from TEXT → new enum.
--   5. Restore status column DEFAULT.
--   6. Create UNIQUE index (operationId, scope, scopeId).
--   7. Create index (scope, scopeId, status).
--   8. Create index (status, expiresAt).
--   9. Create index (operationId).
--
-- DO NOT EDIT the original creation migration:
--   20260808230000_add_campaign_run_and_quota_tables
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Step 1: Drop the column DEFAULT so it no longer references the old enum type.
-- (The status column is already TEXT from the partial execution; the DEFAULT
--  expression still contains a cast to the old type name which blocks DROP TYPE.)
-- ----------------------------------------------------------------------------
ALTER TABLE "QuotaReservation" ALTER COLUMN "status" DROP DEFAULT;

-- ----------------------------------------------------------------------------
-- Step 2: Drop the old 7-value QuotaReservationStatus enum.
-- No column type dependency remains after the DEFAULT was dropped and the
-- column was already converted to TEXT in the prior partial execution.
-- ----------------------------------------------------------------------------
DROP TYPE "QuotaReservationStatus";

-- ----------------------------------------------------------------------------
-- Step 3: Create the new 4-value QuotaReservationStatus enum.
-- Values: RESERVED, CONSUMED, RELEASED, HELD
-- (Matches Prisma schema and state-transition-registry.ts exactly.)
-- ----------------------------------------------------------------------------
CREATE TYPE "QuotaReservationStatus" AS ENUM (
  'RESERVED',
  'CONSUMED',
  'RELEASED',
  'HELD'
);

-- ----------------------------------------------------------------------------
-- Step 4: Restore status column from TEXT → new enum type.
-- Table is empty so USING cast on zero rows is safe.
-- ----------------------------------------------------------------------------
ALTER TABLE "QuotaReservation"
  ALTER COLUMN "status" TYPE "QuotaReservationStatus"
    USING "status"::"QuotaReservationStatus";

-- ----------------------------------------------------------------------------
-- Step 5: Restore status column DEFAULT.
-- ----------------------------------------------------------------------------
ALTER TABLE "QuotaReservation"
  ALTER COLUMN "status" SET DEFAULT 'RESERVED'::"QuotaReservationStatus";

-- ----------------------------------------------------------------------------
-- Step 6: Create UNIQUE index matching @@unique([operationId, scope, scopeId])
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX "QuotaReservation_operationId_scope_scopeId_key"
  ON "QuotaReservation"("operationId", "scope", "scopeId");

-- ----------------------------------------------------------------------------
-- Step 7: Create @@index([scope, scopeId, status])
-- Semantic replacement for the dropped scope_targetId_status index.
-- ----------------------------------------------------------------------------
CREATE INDEX "QuotaReservation_scope_scopeId_status_idx"
  ON "QuotaReservation"("scope", "scopeId", "status");

-- ----------------------------------------------------------------------------
-- Step 8: Create @@index([status, expiresAt])
-- ----------------------------------------------------------------------------
CREATE INDEX "QuotaReservation_status_expiresAt_idx"
  ON "QuotaReservation"("status", "expiresAt");

-- ----------------------------------------------------------------------------
-- Step 9: Create @@index([operationId])
-- ----------------------------------------------------------------------------
CREATE INDEX "QuotaReservation_operationId_idx"
  ON "QuotaReservation"("operationId");
