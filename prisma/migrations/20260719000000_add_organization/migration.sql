-- CreateEnum
CREATE TYPE "OrgRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationMember" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'MEMBER',
    "invitedByUserId" TEXT,
    "invitedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationInvitation" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "OrgRole" NOT NULL DEFAULT 'MEMBER',
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "invitedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationInvitation_pkey" PRIMARY KEY ("id")
);

-- Add nullable orgId columns to scoped tables (additive, no data loss)
ALTER TABLE "Campaign"         ADD COLUMN "orgId" TEXT;
ALTER TABLE "LinkedInAccount"  ADD COLUMN "orgId" TEXT;
ALTER TABLE "SenderDomain"     ADD COLUMN "orgId" TEXT;
ALTER TABLE "SenderMailbox"    ADD COLUMN "orgId" TEXT;
ALTER TABLE "Suppression"      ADD COLUMN "orgId" TEXT;
ALTER TABLE "BrandSettings"    ADD COLUMN "orgId" TEXT;
ALTER TABLE "CompetitorInsight" ADD COLUMN "orgId" TEXT;
ALTER TABLE "LeadAgentColumn"  ADD COLUMN "orgId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

CREATE UNIQUE INDEX "OrganizationMember_orgId_userId_key" ON "OrganizationMember"("orgId", "userId");
CREATE INDEX "OrganizationMember_orgId_idx" ON "OrganizationMember"("orgId");
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");

CREATE UNIQUE INDEX "OrganizationInvitation_token_key" ON "OrganizationInvitation"("token");
CREATE INDEX "OrganizationInvitation_orgId_idx" ON "OrganizationInvitation"("orgId");
CREATE INDEX "OrganizationInvitation_email_idx" ON "OrganizationInvitation"("email");
CREATE INDEX "OrganizationInvitation_token_idx" ON "OrganizationInvitation"("token");

CREATE INDEX "Campaign_orgId_idx"          ON "Campaign"("orgId");
CREATE INDEX "LinkedInAccount_orgId_idx"   ON "LinkedInAccount"("orgId");
CREATE INDEX "SenderDomain_orgId_idx"      ON "SenderDomain"("orgId");
CREATE INDEX "SenderMailbox_orgId_idx"     ON "SenderMailbox"("orgId");
CREATE INDEX "Suppression_orgId_idx"       ON "Suppression"("orgId");
CREATE UNIQUE INDEX "BrandSettings_orgId_key" ON "BrandSettings"("orgId");
CREATE INDEX "CompetitorInsight_orgId_idx" ON "CompetitorInsight"("orgId");
CREATE INDEX "LeadAgentColumn_orgId_idx"   ON "LeadAgentColumn"("orgId");

-- AddForeignKey
ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "OrganizationInvitation" ADD CONSTRAINT "OrganizationInvitation_invitedByUserId_fkey"
    FOREIGN KEY ("invitedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LinkedInAccount" ADD CONSTRAINT "LinkedInAccount_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SenderDomain" ADD CONSTRAINT "SenderDomain_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SenderMailbox" ADD CONSTRAINT "SenderMailbox_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Suppression" ADD CONSTRAINT "Suppression_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "BrandSettings" ADD CONSTRAINT "BrandSettings_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CompetitorInsight" ADD CONSTRAINT "CompetitorInsight_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LeadAgentColumn" ADD CONSTRAINT "LeadAgentColumn_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE SET NULL ON UPDATE CASCADE;
