import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";
import { runSendAgent } from "../app/api/src/modules/gemini/send.agent";
import { CampaignStatus, ApprovalStatus, DeliveryState, EmailStatus } from "@prisma/client";

async function main() {
  const userId = "cmqljad5z0000h91ztoekxvzx"; // David Kenneth (kennethdavid256@proton.me)
  const mailboxId = "cmqlve6pg0005h91z5mnqu5ww"; // GMAIL mailbox (kennethdavid256@gmail.com)

  console.log("[+] Creating campaign with 24/7 send window...");
  const campaign = await prisma.campaign.create({
    data: {
      name: "Startup Marketing & Cold Mailing Outreach (Test)",
      description: "A test campaign targeting startups looking for cold mailing tools.",
      icpDescription: "Startups, marketing teams, and founders interested in automating cold mailing and marketing systems.",
      status: CampaignStatus.SENDING,
      createdById: userId,
      senderMailboxId: mailboxId,
      dailySendLimit: 10,
      qualificationThreshold: 0.4,
      sendWindowStart: 0,
      sendWindowEnd: 24,
      sendWindowDays: [1, 2, 3, 4, 5, 6, 7], // Monday through Sunday
      timezone: "UTC",
    },
  });
  console.log(`[✓] Campaign created with ID: ${campaign.id}`);

  console.log("[+] Creating sequence step...");
  const sequenceStep = await prisma.sequenceStep.create({
    data: {
      stepIndex: 0,
      channel: "EMAIL",
      delayDays: 0,
      subjectTemplate: "Scale your startup's marketing outreach",
      messageTemplate: "Hi {{firstName}},\n\nI noticed you are marketing at {{companyName}} and wanted to test this cold mailing tool. We help startups automate outreach and maintain high deliverability.\n\nLet me know if this email reached your inbox!\n\nBest,\nDavid",
      campaignId: campaign.id,
    },
  });
  console.log(`[✓] Sequence step created with ID: ${sequenceStep.id}`);

  console.log("[+] Creating lead...");
  const lead = await prisma.lead.create({
    data: {
      campaignId: campaign.id,
      email: "kennethdavid256@proton.me",
      emailStatus: EmailStatus.FOUND,
      emailVerified: true,
      firstName: "David",
      lastName: "Kenneth",
      companyName: "Startup Marketing Test",
      domain: "proton.me",
      website: "https://proton.me",
      title: "Marketing Lead",
      qualificationScore: 0.95,
      recommendedAction: "APPROVE",
    },
  });
  console.log(`[✓] Lead created with ID: ${lead.id}`);

  console.log("[+] Creating pre-approved outreach message...");
  const message = await prisma.outreachMessage.create({
    data: {
      leadId: lead.id,
      subject: "Scale your startup's marketing outreach",
      body: "Hi David,\n\nI noticed you are marketing at Startup Marketing Test and wanted to test this cold mailing tool. We help startups automate outreach and maintain high deliverability.\n\nLet me know if this email reached your inbox!\n\nBest,\nDavid",
      approvalStatus: ApprovalStatus.APPROVED,
      deliveryState: DeliveryState.QUEUED,
      channel: "EMAIL",
      isFollowUp: false,
    },
  });
  console.log(`[✓] Outreach message created with ID: ${message.id}`);

  console.log("[+] Invoking runSendAgent...");
  await runSendAgent(campaign.id);
  console.log("[✓] runSendAgent execution completed.");

  // Verify delivery state of the message
  const updatedMessage = await prisma.outreachMessage.findUnique({
    where: { id: message.id },
    select: { id: true, deliveryState: true, sentAt: true, lastError: true },
  });
  console.log("\n=== Message Status After Sending ===");
  console.log(updatedMessage);
}

main()
  .catch((e) => {
    console.error("[-] Error during execution:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
