/*
  Warnings:

  - Added the required column `signalType` to the `LeadSignal` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "breakdownScores" JSONB,
ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "lastEnrichedAt" TIMESTAMP(3),
ADD COLUMN     "recommendedAction" TEXT,
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "LeadSignal" ADD COLUMN     "signalType" "SignalType" NOT NULL;

-- AlterTable
ALTER TABLE "WinRecord" ADD COLUMN     "companyId" TEXT;

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "domain" TEXT,
    "name" TEXT NOT NULL,
    "linkedinUrl" TEXT,
    "enrichmentData" JSONB,
    "lastEnrichedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanySignal" (
    "id" TEXT NOT NULL,
    "signalType" "SignalType" NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" TEXT,
    "explanation" TEXT,
    "companyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanySignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Company_domain_key" ON "Company"("domain");

-- CreateIndex
CREATE INDEX "Company_name_idx" ON "Company"("name");

-- CreateIndex
CREATE INDEX "CompanySignal_companyId_idx" ON "CompanySignal"("companyId");

-- CreateIndex
CREATE INDEX "CompanySignal_companyId_signalType_idx" ON "CompanySignal"("companyId", "signalType");

-- CreateIndex
CREATE UNIQUE INDEX "CompanySignal_companyId_signalType_value_key" ON "CompanySignal"("companyId", "signalType", "value");

-- CreateIndex
CREATE INDEX "Lead_campaignId_externalId_idx" ON "Lead"("campaignId", "externalId");

-- CreateIndex
CREATE INDEX "Lead_companyId_idx" ON "Lead"("companyId");

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanySignal" ADD CONSTRAINT "CompanySignal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
