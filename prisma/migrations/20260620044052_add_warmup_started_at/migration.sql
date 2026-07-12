/*
  Warnings:

  - A unique constraint covering the columns `[campaignId,domain]` on the table `Lead` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[leadId,signalType,value]` on the table `LeadSignal` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "LeadJourneyEventType" AS ENUM ('EMAIL_SENT', 'EMAIL_DELIVERED', 'EMAIL_OPENED', 'EMAIL_BOUNCED', 'LINKEDIN_VISITED', 'LINKEDIN_CONNECT_SENT', 'LINKEDIN_CONNECT_ACCEPTED', 'LINKEDIN_MESSAGED', 'REPLY_RECEIVED', 'SEQUENCE_STEP_EXECUTED', 'PIPELINE_STAGE_CHANGED', 'MEETING_BOOKED', 'SIGNAL_DETECTED', 'SCORE_UPDATED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "DiscoverySourceType" AS ENUM ('APOLLO_SEARCH', 'SERPER_SEARCH', 'BUILTWITH_TECH', 'JOB_INTEL', 'COMMUNITY_INTENT', 'ENRICHMENT_REFRESH', 'LOOKALIKE', 'CSV_IMPORT');

-- CreateEnum
CREATE TYPE "DiscoveryRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL');

-- AlterEnum
ALTER TYPE "DeliverabilityEventType" ADD VALUE 'MAILBOX_ROTATED';

-- AlterTable
ALTER TABLE "AITrace" ADD COLUMN     "leadId" TEXT;

-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "pausedAt" TIMESTAMP(3),
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "country" TEXT,
ADD COLUMN     "embedding" vector(768),
ADD COLUMN     "employeeCount" INTEGER,
ADD COLUMN     "industry" TEXT,
ADD COLUMN     "revenueBand" TEXT;

-- AlterTable
ALTER TABLE "CompanySignal" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "competitorSignal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "competitorTech" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "decisionMakerScore" DOUBLE PRECISION,
ADD COLUMN     "department" TEXT,
ADD COLUMN     "domain" TEXT,
ADD COLUMN     "embedding" vector(768),
ADD COLUMN     "lastContactedAt" TIMESTAMP(3),
ADD COLUMN     "seniority" TEXT;

-- AlterTable
ALTER TABLE "LeadSignal" ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "LossRecord" ADD COLUMN     "leadId" TEXT,
ADD COLUMN     "pipelineStageAtCapture" "PipelineStage",
ADD COLUMN     "qualificationScoreAtCapture" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "OutreachMessage" ADD COLUMN     "enrichmentData" JSONB,
ADD COLUMN     "scheduledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "QueueJob" ADD COLUMN     "startedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Reply" ADD COLUMN     "budgetSignal" TEXT,
ADD COLUMN     "buyingStage" TEXT,
ADD COLUMN     "competitorsMentioned" JSONB,
ADD COLUMN     "embedding" vector(768),
ADD COLUMN     "oooReturnDate" TIMESTAMPTZ,
ADD COLUMN     "painPoints" JSONB,
ADD COLUMN     "timelineSignal" TEXT;

-- AlterTable
ALTER TABLE "SenderMailbox" ADD COLUMN     "warmupStartedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "WinRecord" ADD COLUMN     "leadId" TEXT,
ADD COLUMN     "pipelineStageAtCapture" "PipelineStage",
ADD COLUMN     "qualificationScoreAtCapture" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "LinkedInAccount" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "profileUrl" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LinkedInAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadScoreSnapshot" (
    "id" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "previousScore" DOUBLE PRECISION,
    "reason" TEXT,
    "breakdownScores" JSONB,
    "evidenceTriggers" JSONB,
    "recommendedAction" TEXT,
    "leadId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyEngagement" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "totalLeads" INTEGER NOT NULL DEFAULT 0,
    "engagedLeads" INTEGER NOT NULL DEFAULT 0,
    "repliedLeads" INTEGER NOT NULL DEFAULT 0,
    "positiveLeads" INTEGER NOT NULL DEFAULT 0,
    "meetingsBooked" INTEGER NOT NULL DEFAULT 0,
    "emailsSent" INTEGER NOT NULL DEFAULT 0,
    "emailsOpened" INTEGER NOT NULL DEFAULT 0,
    "bestPipelineStage" "PipelineStage" NOT NULL DEFAULT 'PROSPECT',
    "lastActivityAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyEngagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadJourneyEvent" (
    "id" TEXT NOT NULL,
    "eventType" "LeadJourneyEventType" NOT NULL,
    "channel" "Channel",
    "metadata" JSONB,
    "leadId" TEXT NOT NULL,
    "outreachMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadJourneyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryRun" (
    "id" TEXT NOT NULL,
    "sourceType" "DiscoverySourceType" NOT NULL,
    "status" "DiscoveryRunStatus" NOT NULL DEFAULT 'RUNNING',
    "query" TEXT,
    "companiesFound" INTEGER NOT NULL DEFAULT 0,
    "leadsFound" INTEGER NOT NULL DEFAULT 0,
    "signalsFound" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "campaignId" TEXT,
    "companyId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LinkedInAccount_accountId_key" ON "LinkedInAccount"("accountId");

-- CreateIndex
CREATE INDEX "LinkedInAccount_createdById_idx" ON "LinkedInAccount"("createdById");

-- CreateIndex
CREATE INDEX "LeadScoreSnapshot_leadId_idx" ON "LeadScoreSnapshot"("leadId");

-- CreateIndex
CREATE INDEX "LeadScoreSnapshot_leadId_createdAt_idx" ON "LeadScoreSnapshot"("leadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyEngagement_companyId_key" ON "CompanyEngagement"("companyId");

-- CreateIndex
CREATE INDEX "CompanyEngagement_bestPipelineStage_idx" ON "CompanyEngagement"("bestPipelineStage");

-- CreateIndex
CREATE INDEX "CompanyEngagement_lastActivityAt_idx" ON "CompanyEngagement"("lastActivityAt");

-- CreateIndex
CREATE INDEX "LeadJourneyEvent_leadId_createdAt_idx" ON "LeadJourneyEvent"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "LeadJourneyEvent_leadId_eventType_idx" ON "LeadJourneyEvent"("leadId", "eventType");

-- CreateIndex
CREATE INDEX "LeadJourneyEvent_eventType_createdAt_idx" ON "LeadJourneyEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "DiscoveryRun_sourceType_idx" ON "DiscoveryRun"("sourceType");

-- CreateIndex
CREATE INDEX "DiscoveryRun_status_idx" ON "DiscoveryRun"("status");

-- CreateIndex
CREATE INDEX "DiscoveryRun_campaignId_idx" ON "DiscoveryRun"("campaignId");

-- CreateIndex
CREATE INDEX "DiscoveryRun_startedAt_idx" ON "DiscoveryRun"("startedAt");

-- CreateIndex
CREATE INDEX "AITrace_leadId_idx" ON "AITrace"("leadId");

-- CreateIndex
CREATE INDEX "Campaign_senderDomainId_idx" ON "Campaign"("senderDomainId");

-- CreateIndex
CREATE INDEX "Campaign_senderMailboxId_idx" ON "Campaign"("senderMailboxId");

-- CreateIndex
CREATE INDEX "Campaign_linkedInAccountId_idx" ON "Campaign"("linkedInAccountId");

-- CreateIndex
CREATE INDEX "Company_industry_idx" ON "Company"("industry");

-- CreateIndex
CREATE INDEX "Company_employeeCount_idx" ON "Company"("employeeCount");

-- CreateIndex
CREATE INDEX "Company_country_idx" ON "Company"("country");

-- CreateIndex
CREATE INDEX "Company_lastEnrichedAt_idx" ON "Company"("lastEnrichedAt");

-- CreateIndex
CREATE INDEX "CompanySignal_companyId_isActive_idx" ON "CompanySignal"("companyId", "isActive");

-- CreateIndex
CREATE INDEX "DeliverabilityEvent_type_idx" ON "DeliverabilityEvent"("type");

-- CreateIndex
CREATE INDEX "DeliverabilityEvent_severity_idx" ON "DeliverabilityEvent"("severity");

-- CreateIndex
CREATE INDEX "DeliverabilityEvent_createdAt_idx" ON "DeliverabilityEvent"("createdAt");

-- CreateIndex
CREATE INDEX "Lead_seniority_idx" ON "Lead"("seniority");

-- CreateIndex
CREATE INDEX "Lead_department_idx" ON "Lead"("department");

-- CreateIndex
CREATE INDEX "Lead_decisionMakerScore_idx" ON "Lead"("decisionMakerScore");

-- CreateIndex
CREATE INDEX "Lead_emailStatus_idx" ON "Lead"("emailStatus");

-- CreateIndex
CREATE INDEX "Lead_lastEnrichedAt_idx" ON "Lead"("lastEnrichedAt");

-- CreateIndex
CREATE INDEX "Lead_qualificationScore_idx" ON "Lead"("qualificationScore");

-- CreateIndex
CREATE INDEX "Lead_lastContactedAt_idx" ON "Lead"("lastContactedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_campaignId_domain_key" ON "Lead"("campaignId", "domain");

-- CreateIndex
CREATE INDEX "LeadSignal_leadId_isActive_idx" ON "LeadSignal"("leadId", "isActive");

-- CreateIndex
CREATE INDEX "LeadSignal_signalType_idx" ON "LeadSignal"("signalType");

-- CreateIndex
CREATE INDEX "LeadSignal_expiresAt_idx" ON "LeadSignal"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeadSignal_leadId_signalType_value_key" ON "LeadSignal"("leadId", "signalType", "value");

-- CreateIndex
CREATE INDEX "LinkedInActivity_createdAt_idx" ON "LinkedInActivity"("createdAt");

-- CreateIndex
CREATE INDEX "LossRecord_leadId_idx" ON "LossRecord"("leadId");

-- CreateIndex
CREATE INDEX "LossRecord_inferredObjection_idx" ON "LossRecord"("inferredObjection");

-- CreateIndex
CREATE INDEX "OutreachMessage_nextRetryAt_idx" ON "OutreachMessage"("nextRetryAt");

-- CreateIndex
CREATE INDEX "OutreachMessage_scheduledAt_idx" ON "OutreachMessage"("scheduledAt");

-- CreateIndex
CREATE INDEX "OutreachMessage_sentAt_idx" ON "OutreachMessage"("sentAt");

-- CreateIndex
CREATE INDEX "QueueJob_campaignId_idx" ON "QueueJob"("campaignId");

-- CreateIndex
CREATE INDEX "QueueJob_jobType_idx" ON "QueueJob"("jobType");

-- CreateIndex
CREATE INDEX "Reply_requiresHumanReview_idx" ON "Reply"("requiresHumanReview");

-- CreateIndex
CREATE INDEX "Reply_createdAt_idx" ON "Reply"("createdAt");

-- CreateIndex
CREATE INDEX "Reply_oooRequeuedAt_idx" ON "Reply"("oooRequeuedAt");

-- CreateIndex
CREATE INDEX "SenderDomain_health_idx" ON "SenderDomain"("health");

-- CreateIndex
CREATE INDEX "SenderDomain_warmupEnabled_idx" ON "SenderDomain"("warmupEnabled");

-- CreateIndex
CREATE INDEX "SenderMailbox_health_idx" ON "SenderMailbox"("health");

-- CreateIndex
CREATE INDEX "SenderMailbox_lastReplyCheckedAt_idx" ON "SenderMailbox"("lastReplyCheckedAt");

-- CreateIndex
CREATE INDEX "SenderMailbox_lastDeliveryCheckedAt_idx" ON "SenderMailbox"("lastDeliveryCheckedAt");

-- CreateIndex
CREATE INDEX "Suppression_email_idx" ON "Suppression"("email");

-- CreateIndex
CREATE INDEX "Suppression_domain_idx" ON "Suppression"("domain");

-- CreateIndex
CREATE INDEX "Suppression_createdAt_idx" ON "Suppression"("createdAt");

-- CreateIndex
CREATE INDEX "WinRecord_leadId_idx" ON "WinRecord"("leadId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_linkedInAccountId_fkey" FOREIGN KEY ("linkedInAccountId") REFERENCES "LinkedInAccount"("accountId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LinkedInAccount" ADD CONSTRAINT "LinkedInAccount_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WinRecord" ADD CONSTRAINT "WinRecord_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LossRecord" ADD CONSTRAINT "LossRecord_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AITrace" ADD CONSTRAINT "AITrace_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadScoreSnapshot" ADD CONSTRAINT "LeadScoreSnapshot_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyEngagement" ADD CONSTRAINT "CompanyEngagement_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadJourneyEvent" ADD CONSTRAINT "LeadJourneyEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadJourneyEvent" ADD CONSTRAINT "LeadJourneyEvent_outreachMessageId_fkey" FOREIGN KEY ("outreachMessageId") REFERENCES "OutreachMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryRun" ADD CONSTRAINT "DiscoveryRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "OutreachMessage_leadId_followUpStep_key" RENAME TO "outreach_message_lead_followup_step_unique";
