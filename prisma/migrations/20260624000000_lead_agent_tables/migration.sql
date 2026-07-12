CREATE TYPE "AgentRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETE', 'FAILED', 'STALE');
CREATE TYPE "AgentOutputType" AS ENUM ('TEXT', 'BOOLEAN', 'NUMBER');

CREATE TABLE "LeadAgentColumn" (
    "id"          TEXT          NOT NULL,
    "campaignId"  TEXT          NOT NULL,
    "name"        TEXT          NOT NULL,
    "fieldKey"    TEXT          NOT NULL,
    "prompt"      TEXT          NOT NULL,
    "outputType"  "AgentOutputType" NOT NULL DEFAULT 'TEXT',
    "createdById" TEXT          NOT NULL,
    "createdAt"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt"   TIMESTAMP(3),

    CONSTRAINT "LeadAgentColumn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LeadAgentRun" (
    "id"            TEXT              NOT NULL,
    "leadId"        TEXT              NOT NULL,
    "columnId"      TEXT              NOT NULL,
    "status"        "AgentRunStatus"  NOT NULL DEFAULT 'PENDING',
    "result"        JSONB,
    "errorMessage"  TEXT,
    "toolCallCount" INTEGER           NOT NULL DEFAULT 0,
    "triggeredById" TEXT,
    "startedAt"     TIMESTAMP(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt"   TIMESTAMP(3),

    CONSTRAINT "LeadAgentRun_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadAgentColumn_campaignId_fieldKey_key"
    ON "LeadAgentColumn"("campaignId", "fieldKey");

CREATE INDEX "LeadAgentColumn_campaignId_idx"  ON "LeadAgentColumn"("campaignId");
CREATE INDEX "LeadAgentColumn_createdById_idx" ON "LeadAgentColumn"("createdById");

CREATE INDEX "LeadAgentRun_leadId_idx"          ON "LeadAgentRun"("leadId");
CREATE INDEX "LeadAgentRun_columnId_idx"        ON "LeadAgentRun"("columnId");
CREATE INDEX "LeadAgentRun_leadId_columnId_idx" ON "LeadAgentRun"("leadId", "columnId");
CREATE INDEX "LeadAgentRun_status_idx"          ON "LeadAgentRun"("status");

CREATE UNIQUE INDEX "LeadAgentRun_leadId_columnId_active_unique"
    ON "LeadAgentRun"("leadId", "columnId")
    WHERE (status IN ('PENDING', 'RUNNING'));

ALTER TABLE "LeadAgentColumn"
    ADD CONSTRAINT "LeadAgentColumn_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadAgentColumn"
    ADD CONSTRAINT "LeadAgentColumn_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "LeadAgentRun"
    ADD CONSTRAINT "LeadAgentRun_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadAgentRun"
    ADD CONSTRAINT "LeadAgentRun_columnId_fkey"
    FOREIGN KEY ("columnId") REFERENCES "LeadAgentColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LeadAgentRun"
    ADD CONSTRAINT "LeadAgentRun_triggeredById_fkey"
    FOREIGN KEY ("triggeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;