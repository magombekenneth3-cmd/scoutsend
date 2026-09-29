import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    console.log("=== 1. PHYSICAL COLUMN VERIFICATION ===");
    const cols: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          column_name,
          data_type,
          is_nullable,
          column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'OutboxEvent'
          AND column_name IN ('operationId', 'lastError')
        ORDER BY column_name;
    `);
    console.table(cols);

    console.log("\n=== 2. INDEX VERIFICATION ===");
    const idx: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          indexname,
          indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'OutboxEvent'
          AND indexname = 'OutboxEvent_operationId_idx';
    `);
    console.table(idx);

    console.log("\n=== 3. MIGRATION HISTORY VERIFICATION (_prisma_migrations) ===");
    const migRecord: any[] = await prisma.$queryRawUnsafe(`
        SELECT id, migration_name, finished_at, rolled_back_at 
        FROM _prisma_migrations 
        WHERE migration_name LIKE '%20260813040000%';
    `);
    console.log("Migration log record:", migRecord[0]);

    console.log("\n=== 4. COMPLETE OUTBOX EVENT FIELD QUERY VERIFICATION ===");
    const fieldTest = await prisma.outboxEvent.findMany({
        take: 1,
        select: {
            id: true,
            aggregateVersion: true,
            operationId: true,
            lastError: true,
        },
    });
    console.log("✅ OutboxEvent field query passed! Count:", fieldTest.length);

    console.log("\n=== 5. OUTBOX RELAY SWEEPER QUERY VERIFICATION ===");
    const sweepTest = await prisma.outboxEvent.findMany({
        where: {
            status: { in: ["PENDING", "FAILED"] },
            attempts: { lt: 5 },
        },
        select: {
            id: true,
            aggregateType: true,
            aggregateId: true,
            aggregateVersion: true,
            eventType: true,
            payload: true,
            idempotencyKey: true,
            operationId: true,
            attempts: true,
        },
        orderBy: { createdAt: "asc" },
        take: 100,
    });
    console.log("✅ Outbox relay sweeper query passed! Count:", sweepTest.length);
}

main()
    .catch((err) => {
        console.error("❌ VERIFICATION FAILED:", err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
