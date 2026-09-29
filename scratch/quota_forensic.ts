import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    // 1. Physical columns
    const cols = await prisma.$queryRaw<any[]>`
        SELECT column_name, data_type, column_default, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'QuotaReservation'
        ORDER BY ordinal_position
    `;
    console.log("=== PHYSICAL COLUMNS ===");
    for (const c of cols) {
        console.log(`  ${c.column_name}: ${c.data_type} | default=${c.column_default} | nullable=${c.is_nullable}`);
    }

    // 2. Physical indexes
    const idxs = await prisma.$queryRaw<any[]>`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'QuotaReservation'
        ORDER BY indexname
    `;
    console.log("\n=== PHYSICAL INDEXES ===");
    for (const i of idxs) {
        console.log(`  ${i.indexname}: ${i.indexdef}`);
    }

    // 3. Enum values
    const enums = await prisma.$queryRaw<any[]>`
        SELECT e.enumlabel
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'QuotaReservationStatus'
        ORDER BY e.enumsortorder
    `;
    console.log("\n=== QuotaReservationStatus ENUM VALUES ===");
    for (const e of enums) {
        console.log(`  ${e.enumlabel}`);
    }

    // 4. Row count and status distribution
    const count = await prisma.quotaReservation.count();
    console.log(`\n=== ROW COUNT === ${count}`);
    const dist = await prisma.$queryRaw<any[]>`
        SELECT status, COUNT(*) as n FROM "QuotaReservation" GROUP BY status
    `;
    console.log("=== STATUS DISTRIBUTION ===");
    for (const d of dist) {
        console.log(`  ${d.status}: ${d.n}`);
    }

    // 5. Migration ledger
    const migrations = await prisma.$queryRaw<any[]>`
        SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
        FROM _prisma_migrations
        WHERE migration_name LIKE '%quota%'
           OR migration_name LIKE '%campaign_run%'
           OR migration_name LIKE '%align%'
           OR migration_name = '20260808230000_add_campaign_run_and_quota_tables'
           OR migration_name = '20260816000000_align_quota_reservation_schema'
        ORDER BY started_at
    `;
    console.log("\n=== MIGRATION LEDGER (quota/align) ===");
    for (const m of migrations) {
        console.log(`  ${m.migration_name}`);
        console.log(`    finished_at=${m.finished_at} | rolled_back_at=${m.rolled_back_at} | steps=${m.applied_steps_count}`);
    }

    // 6. Full migration ledger (last 10 by started_at)
    const allMigrations = await prisma.$queryRaw<any[]>`
        SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
        FROM _prisma_migrations
        ORDER BY started_at DESC
        LIMIT 12
    `;
    console.log("\n=== RECENT MIGRATION LEDGER (last 12) ===");
    for (const m of allMigrations) {
        const state = m.rolled_back_at ? "ROLLED_BACK" : m.finished_at ? "APPLIED" : "PENDING/FAILED";
        console.log(`  [${state}] ${m.migration_name}`);
    }
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
