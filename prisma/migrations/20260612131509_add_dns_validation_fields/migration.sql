-- AlterTable
ALTER TABLE "SenderDomain" ADD COLUMN     "dkimValid" BOOLEAN,
ADD COLUMN     "dmarcValid" BOOLEAN,
ADD COLUMN     "dnsCheckedAt" TIMESTAMP(3),
ADD COLUMN     "spfValid" BOOLEAN;
