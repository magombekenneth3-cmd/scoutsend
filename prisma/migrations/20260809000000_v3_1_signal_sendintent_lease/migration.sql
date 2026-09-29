-- CreateEnum
CREATE TYPE "PlanTier" AS ENUM ('FREE', 'STARTER', 'GROWTH', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'TRIALING', 'PAST_DUE', 'CANCELED', 'UNPAID');

-- CreateEnum
CREATE TYPE "ConsentBasis" AS ENUM ('EXPLICIT_CONSENT', 'LEGITIMATE_INTEREST', 'EXISTING_BUSINESS_RELATIONSHIP');

-- CreateEnum
CREATE TYPE "CrmProvider" AS ENUM ('HUBSPOT', 'SALESFORCE');

-- CreateEnum
CREATE TYPE "LeadState" AS ENUM ('DISCOVERED', 'RESEARCH_PENDING', 'ENRICHING', 'ENRICHED', 'SIGNALS_EVALUATED', 'SCORE_PENDING', 'SCORED', 'EMAIL_REVEAL_PENDING', 'EMAIL_REVEALED', 'EMAIL_VALIDATING', 'EMAIL_VERIFIED', 'CONTENT_PENDING', 'CONTENT_READY', 'COMPLIANCE_PENDING', 'SEND_ELIGIBLE', 'QUEUED', 'SENT', 'WAITING_FOR_REPLY', 'REPLIED', 'DISQUALIFIED', 'SUPPRESSED', 'UNSUBSCRIBED', 'BOUNCED', 'COMPLAINT', 'SEQUENCE_STOPPED', 'MEETING_BOOKED', 'CONVERTED', 'FAILED_RETRYABLE', 'FAILED_TERMINAL');

-- CreateEnum
CREATE TYPE "EmailValidationStatus" AS ENUM ('UNKNOWN', 'REVEALED', 'VALID', 'INVALID', 'RISKY', 'CATCH_ALL');

-- CreateEnum
CREATE TYPE "OperationStatus" AS ENUM ('PENDING', 'RUNNING', 'RECOVERABLE', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "SeedProvider" AS ENUM ('GMAIL', 'OUTLOOK');

-- CreateEnum
CREATE TYPE "SeedStage" AS ENUM ('BOOTSTRAPPING', 'ACTIVE', 'COOLING_DOWN', 'DEAD');

-- CreateEnum
CREATE TYPE "SendIntentStatus" AS ENUM ('PENDING', 'DISPATCHING', 'ACCEPTED', 'FAILED', 'UNKNOWN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DeliverabilityEventType" ADD VALUE 'SEED_WARMUP_SPAM_LANDING';
ALTER TYPE "DeliverabilityEventType" ADD VALUE 'SEED_WARMUP_ENGAGED';

-- AlterEnum
ALTER TYPE "LeadJourneyEventType" ADD VALUE 'EMAIL_CLICKED';

-- AlterEnum
ALTER TYPE "ResearchStatus" ADD VALUE 'PARTIAL';

-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_userId_fkey";

-- DropForeignKey
ALTER TABLE "Campaign" DROP CONSTRAINT "Campaign_orgId_fkey";

-- DropForeignKey
ALTER TABLE "Suppression" DROP CONSTRAINT "Suppression_orgId_fkey";

-- DropForeignKey
ALTER TABLE "Suppression" DROP CONSTRAINT "Suppression_userId_fkey";

-- DropIndex
DROP INDEX "Lead_campaignId_externalId_idx";

-- DropIndex
DROP INDEX "Suppression_domain_userId_key";

-- DropIndex
DROP INDEX "Suppression_email_userId_key";

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Campaign" ALTER COLUMN "orgId" SET NOT NULL;

-- AlterTable
ALTER TABLE "CampaignStateStore" ADD COLUMN     "stateVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "emailValidationStatus" "EmailValidationStatus" NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "leadState" "LeadState" NOT NULL DEFAULT 'DISCOVERED',
ADD COLUMN     "leadStateVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "LeadSignal" ADD COLUMN     "independenceKey" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sourceId" TEXT;

-- AlterTable
ALTER TABLE "LearningEvent" ADD COLUMN     "campaignId" TEXT,
ADD COLUMN     "orgId" TEXT,
ADD COLUMN     "userId" TEXT;

-- AlterTable
ALTER TABLE "Suppression" ALTER COLUMN "userId" DROP NOT NULL,
ALTER COLUMN "orgId" SET NOT NULL;

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "planTier" "PlanTier" NOT NULL DEFAULT 'FREE',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "seatLimit" INTEGER NOT NULL DEFAULT 3,
    "campaignLimit" INTEGER NOT NULL DEFAULT 5,
    "currentPeriodEnd" TIMESTAMP(3),
    "trialEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsentRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "domain" TEXT,
    "basis" "ConsentBasis" NOT NULL,
    "source" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmIntegration" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" "CrmProvider" NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "syncErrorCount" INTEGER NOT NULL DEFAULT 0,
    "lastSyncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrmSyncLog" (
    "id" TEXT NOT NULL,
    "integrationId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "errorMsg" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrmSyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeedMailbox" (
    "id" TEXT NOT NULL,
    "provider" "SeedProvider" NOT NULL,
    "emailAddress" TEXT NOT NULL,
    "credentials" JSONB NOT NULL,
    "ownerUserId" TEXT,
    "stage" "SeedStage" NOT NULL DEFAULT 'BOOTSTRAPPING',
    "healthScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "dailyCapacity" INTEGER NOT NULL DEFAULT 0,
    "usedToday" INTEGER NOT NULL DEFAULT 0,
    "lastResetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPairedAt" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeedMailbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WarmupInteraction" (
    "id" TEXT NOT NULL,
    "senderMailboxId" TEXT NOT NULL,
    "seedMailboxId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "threadId" TEXT,
    "scheduledOpenAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "landedInSpam" BOOLEAN,
    "movedToInboxAt" TIMESTAMP(3),
    "repliedAt" TIMESTAMP(3),
    "replyGeneratedByAi" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WarmupInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Operation" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "status" "OperationStatus" NOT NULL DEFAULT 'PENDING',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "error" TEXT,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailRevealDecision" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "decision" TEXT NOT NULL,
    "scoringRunId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailRevealDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SendIntent" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "campaignId" TEXT,
    "mailboxId" TEXT,
    "outreachMessageId" TEXT NOT NULL,
    "sequenceStep" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "SendIntentStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "errorMessage" TEXT,
    "providerMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SendIntent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_orgId_idx" ON "ApiKey"("orgId");

-- CreateIndex
CREATE INDEX "ApiKey_keyHash_idx" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_jti_key" ON "UserSession"("jti");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_familyId_key" ON "UserSession"("familyId");

-- CreateIndex
CREATE INDEX "UserSession_userId_idx" ON "UserSession"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_orgId_key" ON "Subscription"("orgId");

-- CreateIndex
CREATE INDEX "Subscription_orgId_idx" ON "Subscription"("orgId");

-- CreateIndex
CREATE INDEX "Subscription_stripeCustomerId_idx" ON "Subscription"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "ConsentRecord_orgId_idx" ON "ConsentRecord"("orgId");

-- CreateIndex
CREATE INDEX "ConsentRecord_email_idx" ON "ConsentRecord"("email");

-- CreateIndex
CREATE INDEX "ConsentRecord_orgId_email_idx" ON "ConsentRecord"("orgId", "email");

-- CreateIndex
CREATE INDEX "ConsentRecord_revokedAt_idx" ON "ConsentRecord"("revokedAt");

-- CreateIndex
CREATE INDEX "CrmIntegration_orgId_idx" ON "CrmIntegration"("orgId");

-- CreateIndex
CREATE UNIQUE INDEX "CrmIntegration_orgId_provider_key" ON "CrmIntegration"("orgId", "provider");

-- CreateIndex
CREATE INDEX "CrmSyncLog_integrationId_idx" ON "CrmSyncLog"("integrationId");

-- CreateIndex
CREATE INDEX "CrmSyncLog_integrationId_createdAt_idx" ON "CrmSyncLog"("integrationId", "createdAt");

-- CreateIndex
CREATE INDEX "CrmSyncLog_createdAt_idx" ON "CrmSyncLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SeedMailbox_emailAddress_key" ON "SeedMailbox"("emailAddress");

-- CreateIndex
CREATE INDEX "SeedMailbox_stage_healthScore_idx" ON "SeedMailbox"("stage", "healthScore");

-- CreateIndex
CREATE INDEX "WarmupInteraction_senderMailboxId_idx" ON "WarmupInteraction"("senderMailboxId");

-- CreateIndex
CREATE INDEX "WarmupInteraction_seedMailboxId_idx" ON "WarmupInteraction"("seedMailboxId");

-- CreateIndex
CREATE INDEX "WarmupInteraction_createdAt_idx" ON "WarmupInteraction"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Operation_operationId_key" ON "Operation"("operationId");

-- CreateIndex
CREATE INDEX "Operation_aggregateId_operationType_idx" ON "Operation"("aggregateId", "operationType");

-- CreateIndex
CREATE INDEX "Operation_status_createdAt_idx" ON "Operation"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Operation_status_leaseExpiresAt_idx" ON "Operation"("status", "leaseExpiresAt");

-- CreateIndex
CREATE INDEX "Operation_aggregateId_idx" ON "Operation"("aggregateId");

-- CreateIndex
CREATE INDEX "Operation_leaseOwner_idx" ON "Operation"("leaseOwner");

-- CreateIndex
CREATE INDEX "Operation_leaseExpiresAt_idx" ON "Operation"("leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_idempotencyKey_key" ON "OutboxEvent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_publishedAt_createdAt_idx" ON "OutboxEvent"("publishedAt", "createdAt");

-- CreateIndex
CREATE INDEX "OutboxEvent_aggregateId_idx" ON "OutboxEvent"("aggregateId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailRevealDecision_leadId_key" ON "EmailRevealDecision"("leadId");

-- CreateIndex
CREATE INDEX "EmailRevealDecision_leadId_idx" ON "EmailRevealDecision"("leadId");

-- CreateIndex
CREATE INDEX "EmailRevealDecision_decision_idx" ON "EmailRevealDecision"("decision");

-- CreateIndex
CREATE UNIQUE INDEX "SendIntent_operationId_key" ON "SendIntent"("operationId");

-- CreateIndex
CREATE UNIQUE INDEX "SendIntent_outreachMessageId_key" ON "SendIntent"("outreachMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "SendIntent_idempotencyKey_key" ON "SendIntent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "SendIntent_leadId_idx" ON "SendIntent"("leadId");

-- CreateIndex
CREATE INDEX "SendIntent_status_idx" ON "SendIntent"("status");

-- CreateIndex
CREATE INDEX "SendIntent_status_updatedAt_idx" ON "SendIntent"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "SendIntent_idempotencyKey_idx" ON "SendIntent"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Lead_campaignId_deletedAt_qualificationScore_idx" ON "Lead"("campaignId", "deletedAt", "qualificationScore" DESC);

-- CreateIndex
CREATE INDEX "Lead_emailValidationStatus_idx" ON "Lead"("emailValidationStatus");

-- CreateIndex
CREATE INDEX "Lead_leadState_idx" ON "Lead"("leadState");

-- CreateIndex
CREATE INDEX "LeadSignal_independenceKey_idx" ON "LeadSignal"("independenceKey");

-- CreateIndex
CREATE INDEX "LearningEvent_orgId_createdAt_idx" ON "LearningEvent"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "LearningEvent_campaignId_createdAt_idx" ON "LearningEvent"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "LearningEvent_userId_idx" ON "LearningEvent"("userId");

-- CreateIndex
CREATE INDEX "Organization_slug_idx" ON "Organization"("slug");

-- CreateIndex
CREATE INDEX "OutreachMessage_leadId_deliveryState_scheduledAt_idx" ON "OutreachMessage"("leadId", "deliveryState", "scheduledAt");

-- CreateIndex
CREATE INDEX "Suppression_userId_idx" ON "Suppression"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_email_orgId_key" ON "Suppression"("email", "orgId");

-- CreateIndex
CREATE UNIQUE INDEX "Suppression_domain_orgId_key" ON "Suppression"("domain", "orgId");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningEvent" ADD CONSTRAINT "LearningEvent_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningEvent" ADD CONSTRAINT "LearningEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LearningEvent" ADD CONSTRAINT "LearningEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmIntegration" ADD CONSTRAINT "CrmIntegration_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrmSyncLog" ADD CONSTRAINT "CrmSyncLog_integrationId_fkey" FOREIGN KEY ("integrationId") REFERENCES "CrmIntegration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeedMailbox" ADD CONSTRAINT "SeedMailbox_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarmupInteraction" ADD CONSTRAINT "WarmupInteraction_senderMailboxId_fkey" FOREIGN KEY ("senderMailboxId") REFERENCES "SenderMailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WarmupInteraction" ADD CONSTRAINT "WarmupInteraction_seedMailboxId_fkey" FOREIGN KEY ("seedMailboxId") REFERENCES "SeedMailbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailRevealDecision" ADD CONSTRAINT "EmailRevealDecision_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
