import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";
import { runSendAgent } from "../app/api/src/modules/gemini/send.agent";

async function main() {
    const campaignId = "cmqo7nvda0000qp1zibylbjrq";
    console.log("[+] Invoking runSendAgent directly...");
    await runSendAgent(campaignId);
    console.log("[✓] runSendAgent finished.");

    const message = await prisma.outreachMessage.findFirst({
        where: { lead: { campaignId } },
        select: { id: true, deliveryState: true, sentAt: true, lastError: true, retryCount: true },
    });
    console.log("Message status:", message);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());