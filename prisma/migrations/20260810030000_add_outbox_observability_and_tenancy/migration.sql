-- Migration: 20260810030000_add_outbox_observability_and_tenancy

-- 1. Add organizationId (nullable during backfill) and correlationId to OutboxEvent
ALTER TABLE "OutboxEvent" ADD COLUMN IF NOT EXISTS "organizationId" TEXT;
ALTER TABLE "OutboxEvent" ADD COLUMN IF NOT EXISTS "correlationId" TEXT;

-- 2. Deterministic Backfill Strategy (Strict Parent Lookups Only — No Default Fallbacks)
-- Backfill from OutreachMessage parent entity
UPDATE "OutboxEvent" e
SET "organizationId" = (
  SELECT c."orgId"
  FROM "OutreachMessage" m
  JOIN "Lead" l ON l."id" = m."leadId"
  JOIN "Campaign" c ON c."id" = l."campaignId"
  WHERE m."id" = e."aggregateId" AND c."orgId" IS NOT NULL
  LIMIT 1
)
WHERE e."organizationId" IS NULL AND e."aggregateType" = 'OutreachMessage';

-- Backfill from Reply parent entity
UPDATE "OutboxEvent" e
SET "organizationId" = (
  SELECT c."orgId"
  FROM "Reply" r
  JOIN "Lead" l ON l."id" = r."leadId"
  JOIN "Campaign" c ON c."id" = l."campaignId"
  WHERE r."id" = e."aggregateId" AND c."orgId" IS NOT NULL
  LIMIT 1
)
WHERE e."organizationId" IS NULL AND e."aggregateType" = 'Reply';

-- Backfill from Lead parent entity (CRM_SYNC_REQUESTED, LEAD_* events)
UPDATE "OutboxEvent" e
SET "organizationId" = (
  SELECT c."orgId"
  FROM "Lead" l
  JOIN "Campaign" c ON c."id" = l."campaignId"
  WHERE l."id" = e."aggregateId" AND c."orgId" IS NOT NULL
  LIMIT 1
)
WHERE e."organizationId" IS NULL AND e."aggregateType" = 'Lead';

-- Backfill from SendIntent parent entity (SEND_INTENT_* events)
UPDATE "OutboxEvent" e
SET "organizationId" = (
  SELECT c."orgId"
  FROM "SendIntent" s
  JOIN "Lead" l ON l."id" = s."leadId"
  JOIN "Campaign" c ON c."id" = l."campaignId"
  WHERE s."id" = e."aggregateId" AND c."orgId" IS NOT NULL
  LIMIT 1
)
WHERE e."organizationId" IS NULL AND e."aggregateType" = 'SendIntent';

-- Backfill from Campaign parent entity (WEBHOOK_REQUESTED events)
UPDATE "OutboxEvent" e
SET "organizationId" = (
  SELECT c."orgId"
  FROM "Campaign" c
  WHERE c."id" = e."aggregateId" AND c."orgId" IS NOT NULL
  LIMIT 1
)
WHERE e."organizationId" IS NULL AND e."aggregateType" = 'Campaign';

-- 3. Fail-Closed Check: Ensure 0 unresolvable organizationId rows remain
-- If any row cannot be deterministically resolved to an organizationId, the migration FAILS immediately.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "OutboxEvent" WHERE "organizationId" IS NULL) THEN
    RAISE EXCEPTION 'Migration failed: OutboxEvent contains unresolvable organizationId rows';
  END IF;
END $$;

-- 4. Enforce NOT NULL constraint on organizationId
ALTER TABLE "OutboxEvent" ALTER COLUMN "organizationId" SET NOT NULL;

-- 5. Create Tenant Indexes on OutboxEvent
CREATE INDEX IF NOT EXISTS "OutboxEvent_organizationId_status_idx" ON "OutboxEvent"("organizationId", "status");
CREATE INDEX IF NOT EXISTS "OutboxEvent_organizationId_status_nextRetryAt_idx" ON "OutboxEvent"("organizationId", "status", "nextRetryAt");
CREATE INDEX IF NOT EXISTS "OutboxEvent_organizationId_status_leaseExpiresAt_idx" ON "OutboxEvent"("organizationId", "status", "leaseExpiresAt");

-- 6. Create OutboxOperatorAudit Table
CREATE TABLE IF NOT EXISTS "OutboxOperatorAudit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "outboxEventId" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'REPLAY',
    "previousStatus" TEXT NOT NULL,
    "resultingStatus" TEXT NOT NULL,
    "previousAttempts" INTEGER NOT NULL,
    "previousLastError" TEXT,
    "previousNextRetryAt" TIMESTAMP(3),
    "previousLeaseToken" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,

    CONSTRAINT "OutboxOperatorAudit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OutboxOperatorAudit_organizationId_createdAt_idx" ON "OutboxOperatorAudit"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "OutboxOperatorAudit_outboxEventId_idx" ON "OutboxOperatorAudit"("outboxEventId");

-- 7. Create ProviderDeliveryAttempt Table
CREATE TABLE IF NOT EXISTS "ProviderDeliveryAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "outboxEventId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "leaseToken" TEXT,
    "workerId" TEXT,
    "provider" TEXT NOT NULL,
    "providerMessageId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "latencyMs" INTEGER,
    "outcome" TEXT NOT NULL DEFAULT 'PROCESSING',
    "statusCode" INTEGER,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProviderDeliveryAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProviderDeliveryAttempt_outboxEventId_attemptNumber_key" ON "ProviderDeliveryAttempt"("outboxEventId", "attemptNumber");
CREATE INDEX IF NOT EXISTS "ProviderDeliveryAttempt_organizationId_createdAt_idx" ON "ProviderDeliveryAttempt"("organizationId", "createdAt");
CREATE INDEX IF NOT EXISTS "ProviderDeliveryAttempt_organizationId_outcome_createdAt_idx" ON "ProviderDeliveryAttempt"("organizationId", "outcome", "createdAt");

-- 8. Create OutboxFencingIncident Table
CREATE TABLE IF NOT EXISTS "OutboxFencingIncident" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "outboxEventId" TEXT NOT NULL,
    "staleLeaseToken" TEXT NOT NULL,
    "currentLeaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "workerId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboxFencingIncident_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "OutboxFencingIncident_organizationId_occurredAt_idx" ON "OutboxFencingIncident"("organizationId", "occurredAt");
CREATE INDEX IF NOT EXISTS "OutboxFencingIncident_outboxEventId_idx" ON "OutboxFencingIncident"("outboxEventId");
