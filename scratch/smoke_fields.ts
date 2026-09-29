import { prisma } from '../app/api/src/lib/prisma';
async function run() {
  const tests: Array<[string, () => Promise<unknown>]> = [
    ['SendIntent lease fields', () => prisma.sendIntent.findMany({ take: 1, select: { id: true, claimedBy: true, fencingEpoch: true, leaseVersion: true, leaseExpiresAt: true, provider: true, payloadHash: true, traceId: true, reconciliationAttempts: true } })],
    ['Reply.isRead+snoozedUntil', () => prisma.reply.findMany({ take: 1, select: { id: true, isRead: true, snoozedUntil: true } })],
    ['OutreachMessage.regeneration+senderMailboxId', () => prisma.outreachMessage.findMany({ take: 1, select: { id: true, regenerationNeeded: true, regenerationReason: true, senderMailboxId: true } })],
    ['SenderMailbox.DNS fields', () => prisma.senderMailbox.findMany({ take: 1, select: { id: true, spfValid: true, dkimValid: true, dmarcValid: true, dkimSelector: true, dnsCheckedAt: true } })],
    ['BrandSettings.provenStats', () => prisma.brandSettings.findMany({ take: 1, select: { id: true, provenStats: true } })],
    ['Lead.researchCard', () => prisma.lead.findMany({ take: 1, select: { id: true, researchCard: true, researchCardGeneratedAt: true } })],
    ['CampaignRun.logicalVersion', () => prisma.campaignRun.findMany({ take: 1, select: { id: true, logicalVersion: true } })],
  ];
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`PASS: ${name}`); } 
    catch(e: any) { console.log(`FAIL: ${name} -> ${e.message.split('\n')[0]}`); }
  }
  await prisma.$disconnect();
}
run();
