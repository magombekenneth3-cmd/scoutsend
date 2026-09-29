ALTER TABLE "LeadSignal"
  ADD COLUMN IF NOT EXISTS "sourceId" TEXT,
  ADD COLUMN IF NOT EXISTS "independenceKey" TEXT NOT NULL DEFAULT '';

UPDATE "LeadSignal" SET "independenceKey" = id WHERE "independenceKey" = '';

CREATE UNIQUE INDEX IF NOT EXISTS "LeadSignal_leadId_independenceKey_key"
  ON "LeadSignal" ("leadId", "independenceKey");
