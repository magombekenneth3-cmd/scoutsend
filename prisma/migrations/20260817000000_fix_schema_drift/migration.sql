-- ============================================================
-- Migration: fix_schema_drift
-- Fixes all drift between Prisma schema and live DB.
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS).
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 1. DeliveryState enum — add missing values
--    ALTER TYPE ADD VALUE cannot run inside an explicit
--    transaction block, so each is a standalone statement.
--    Prisma migrations run in autocommit mode — safe.
-- ────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'DeliveryState' AND e.enumlabel = 'VALIDATED'
  ) THEN
    ALTER TYPE "DeliveryState" ADD VALUE 'VALIDATED' AFTER 'DRAFT';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'DeliveryState' AND e.enumlabel = 'AUTHORIZED'
  ) THEN
    ALTER TYPE "DeliveryState" ADD VALUE 'AUTHORIZED' AFTER 'VALIDATED';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'DeliveryState' AND e.enumlabel = 'DISPATCHING'
  ) THEN
    ALTER TYPE "DeliveryState" ADD VALUE 'DISPATCHING' AFTER 'AUTHORIZED';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'DeliveryState' AND e.enumlabel = 'BLOCKED'
  ) THEN
    ALTER TYPE "DeliveryState" ADD VALUE 'BLOCKED' AFTER 'SPAM';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'DeliveryState' AND e.enumlabel = 'CANCELLED'
  ) THEN
    ALTER TYPE "DeliveryState" ADD VALUE 'CANCELLED' AFTER 'BLOCKED';
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────
-- 2. OutreachMessage — add missing columns
-- ────────────────────────────────────────────────────────────
ALTER TABLE "OutreachMessage"
  ADD COLUMN IF NOT EXISTS "senderMailboxId"    TEXT,
  ADD COLUMN IF NOT EXISTS "regenerationNeeded" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "regenerationReason" TEXT;

-- FK for senderMailboxId (add only if not already present)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'OutreachMessage_senderMailboxId_fkey'
      AND table_name = 'OutreachMessage'
  ) THEN
    ALTER TABLE "OutreachMessage"
      ADD CONSTRAINT "OutreachMessage_senderMailboxId_fkey"
      FOREIGN KEY ("senderMailboxId")
      REFERENCES "SenderMailbox"(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- Index for senderMailboxId
CREATE INDEX IF NOT EXISTS "OutreachMessage_senderMailboxId_idx"
  ON "OutreachMessage"("senderMailboxId");

-- ────────────────────────────────────────────────────────────
-- 3. SenderMailbox — add missing DNS / deliverability columns
-- ────────────────────────────────────────────────────────────
ALTER TABLE "SenderMailbox"
  ADD COLUMN IF NOT EXISTS "spfValid"      BOOLEAN,
  ADD COLUMN IF NOT EXISTS "dkimValid"     BOOLEAN,
  ADD COLUMN IF NOT EXISTS "dmarcValid"    BOOLEAN,
  ADD COLUMN IF NOT EXISTS "dkimSelector"  TEXT,
  ADD COLUMN IF NOT EXISTS "dkimPublicKey" TEXT,
  ADD COLUMN IF NOT EXISTS "dnsCheckedAt"  TIMESTAMP(3);
