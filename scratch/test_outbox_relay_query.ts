import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    console.log("=== VERIFYING OutboxEvent.aggregateVersion SPECIFICALLY ===");

    const events = await prisma.outboxEvent.findMany({
        select: {
            id: true,
            aggregateVersion: true,
        },
        take: 10,
    });

    console.log("✅ OutboxEvent.findMany({ select: { aggregateVersion: true } }) PASSED!");
    console.log(`Events retrieved: ${events.length}`);
}

main()
    .catch((err) => {
        console.error("❌ OutboxEvent.aggregateVersion QUERY FAILED:", err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
