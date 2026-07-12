CREATE TYPE "CatchAllPolicy" AS ENUM ('SKIP', 'SEND', 'HOLD');
CREATE TYPE "TemplateStyle" AS ENUM ('BRANDED', 'PLAIN');

ALTER TABLE "Lead" ADD COLUMN "emailCatchAll" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Campaign" ADD COLUMN "catchAllPolicy" "CatchAllPolicy" NOT NULL DEFAULT 'SKIP';
ALTER TABLE "Campaign" ADD COLUMN "templateStyle" "TemplateStyle" NOT NULL DEFAULT 'BRANDED';
