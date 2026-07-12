-- AlterEnum
BEGIN;
CREATE TYPE "public"."DeliverabilityEventType_new" AS ENUM ('BOUNCE', 'SOFT_BOUNCE', 'HARD_BOUNCE', 'SPAM_COMPLAINT', 'UNSUBSCRIBE', 'DELIVERY_FAILURE', 'DOMAIN_BLOCKED', 'MAILBOX_BLOCKED', 'SUBJECT_LINE_EXHAUSTION', 'MAILBOX_ROTATED');
ALTER TABLE "public"."DeliverabilityEvent" ALTER COLUMN "type" TYPE "public"."DeliverabilityEventType_new" USING ("type"::text::"public"."DeliverabilityEventType_new");
ALTER TYPE "public"."DeliverabilityEventType" RENAME TO "DeliverabilityEventType_old";
ALTER TYPE "public"."DeliverabilityEventType_new" RENAME TO "DeliverabilityEventType";
DROP TYPE "public"."DeliverabilityEventType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "public"."DiscoverySourceType_new" AS ENUM ('APOLLO_SEARCH', 'SERPER_SEARCH', 'BUILTWITH_TECH', 'JOB_INTEL', 'COMMUNITY_INTENT', 'ENRICHMENT_REFRESH', 'LOOKALIKE', 'CSV_IMPORT');
ALTER TABLE "public"."DiscoveryRun" ALTER COLUMN "sourceType" TYPE "public"."DiscoverySourceType_new" USING ("sourceType"::text::"public"."DiscoverySourceType_new");
ALTER TYPE "public"."DiscoverySourceType" RENAME TO "DiscoverySourceType_old";
ALTER TYPE "public"."DiscoverySourceType_new" RENAME TO "DiscoverySourceType";
DROP TYPE "public"."DiscoverySourceType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "public"."EmailStatus_new" AS ENUM ('NOT_ATTEMPTED', 'PENDING', 'FOUND', 'NOT_FOUND', 'INVALID', 'BOUNCED', 'SUPPRESSED');
ALTER TABLE "public"."Lead" ALTER COLUMN "emailStatus" DROP DEFAULT;
ALTER TABLE "public"."Lead" ALTER COLUMN "emailStatus" TYPE "public"."EmailStatus_new" USING ("emailStatus"::text::"public"."EmailStatus_new");
ALTER TYPE "public"."EmailStatus" RENAME TO "EmailStatus_old";
ALTER TYPE "public"."EmailStatus_new" RENAME TO "EmailStatus";
DROP TYPE "public"."EmailStatus_old";
ALTER TABLE "public"."Lead" ALTER COLUMN "emailStatus" SET DEFAULT 'NOT_ATTEMPTED';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "public"."ResearchStatus_new" AS ENUM ('PENDING', 'RUNNING', 'COMPLETE', 'FAILED', 'STALE');
ALTER TABLE "public"."LeadResearchReport" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "public"."LeadResearchReport" ALTER COLUMN "status" TYPE "public"."ResearchStatus_new" USING ("status"::text::"public"."ResearchStatus_new");
ALTER TYPE "public"."ResearchStatus" RENAME TO "ResearchStatus_old";
ALTER TYPE "public"."ResearchStatus_new" RENAME TO "ResearchStatus";
DROP TYPE "public"."ResearchStatus_old";
ALTER TABLE "public"."LeadResearchReport" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

