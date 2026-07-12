import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    await prisma.campaign.update({
        where: { id: "cmqo7nvda0000qp1zibylbjrq" },
        data: {
            sendWindowStart: 0,
            sendWindowEnd: 23,
            sendWindowDays: [1, 2, 3, 4, 5, 6, 7], // Mon-Sun
            timezone: "UTC",
        },
    });
    console.log("Send window opened for testing.");
}

main().finally(() => prisma.$disconnect());