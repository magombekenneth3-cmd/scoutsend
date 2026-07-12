-- AddColumn
ALTER TABLE "SenderDomain" ADD COLUMN IF NOT EXISTS "dkimSelector" TEXT;
ALTER TABLE "SenderDomain" ADD COLUMN IF NOT EXISTS "dkimPublicKey" TEXT;
