import { prisma } from "../app/api/src/lib/prisma";

async function main() {
  console.log("Database table counts:");
  const users = await prisma.user.count();
  const campaigns = await prisma.campaign.count();
  const leads = await prisma.lead.count();
  const outreachMessages = await prisma.outreachMessage.count();
  const replies = await prisma.reply.count();

  console.log(`Users: ${users}`);
  console.log(`Campaigns: ${campaigns}`);
  console.log(`Leads: ${leads}`);
  console.log(`OutreachMessages: ${outreachMessages}`);
  console.log(`Replies: ${replies}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
