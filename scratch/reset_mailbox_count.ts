import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    const mailbox = await prisma.senderMailbox.update({
        where: { id: "cmqlve6pg0005h91z5mnqu5ww" },
        data: { currentSent: 0 },
    });
    console.log("Reset currentSent. Mailbox:", { id: mailbox.id, currentSent: mailbox.currentSent, dailyLimit: mailbox.dailyLimit });
}

main().finally(() => prisma.$disconnect());