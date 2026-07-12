import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    const campaigns = await prisma.campaign.findMany({
        where: { status: "QUEUED", deletedAt: null },
        select: {
            id: true,
            name: true,
            status: true,
            senderMailboxId: true,
            senderDomainId: true,
            sendWindowStart: true,
            sendWindowEnd: true,
            sendWindowDays: true,
            timezone: true,
            updatedAt: true,
        },
    });

    console.log(`\n=== QUEUED campaigns (${campaigns.length}) ===`);
    for (const c of campaigns) {
        const visible = !!c.senderMailboxId;
        console.log({
            id: c.id,
            name: c.name,
            senderMailboxId: c.senderMailboxId,
            visibleToScheduler: visible,
            sendWindow: `${c.sendWindowStart ?? "default(7)"}-${c.sendWindowEnd ?? "default(17)"} days:${c.sendWindowDays?.length ? c.sendWindowDays : "default(Mon-Fri)"}`,
            timezone: c.timezone ?? "UTC",
        });

        if (!visible) {
            console.log(`  ⚠️  senderMailboxId is NULL — scan-queued-campaigns will never pick this up.\n`);
            continue;
        }

        const mailbox = await prisma.senderMailbox.findUnique({
            where: { id: c.senderMailboxId! },
            select: { health: true, currentSent: true, dailyLimit: true, warmupEnabled: true, createdAt: true },
        });
        console.log("  mailbox:", mailbox);

        const msgCounts = await prisma.outreachMessage.groupBy({
            by: ["approvalStatus", "deliveryState"],
            where: { lead: { campaignId: c.id } },
            _count: { _all: true },
        });
        console.log("  message breakdown:", msgCounts.map(m => ({ ...m, count: m._count._all })));
        console.log("");
    }
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });