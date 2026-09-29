-- CreateTable
CREATE TABLE "GeneratedProposalCache" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "agentName" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "subjectVariant" TEXT,
    "leadingSignal" TEXT,
    "ctaTier" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "proposalHash" TEXT NOT NULL,
    "contextHash" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "persistenceStatus" TEXT NOT NULL DEFAULT 'GENERATED',
    "persistAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastPersistError" TEXT,
    "persistedMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedProposalCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GeneratedProposalCache_proposalId_key" ON "GeneratedProposalCache"("proposalId");

-- CreateIndex
CREATE INDEX "GeneratedProposalCache_leadId_campaignId_idx" ON "GeneratedProposalCache"("leadId", "campaignId");

-- CreateIndex
CREATE INDEX "GeneratedProposalCache_persistenceStatus_idx" ON "GeneratedProposalCache"("persistenceStatus");
