import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    // 1. Physical columns
    const cols = await prisma.$queryRaw<any[]>`
        SELECT column_name, data_type, column_default, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'SendIntent'
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
        WHERE tablename = 'SendIntent'
        ORDER BY indexname
    `;
    console.log("\n=== PHYSICAL INDEXES ===");
    for (const i of idxs) {
        console.log(`  ${i.indexname}: ${i.indexdef}`);
    }

    // 3. SendIntentStatus enum values
    const enums = await prisma.$queryRaw<any[]>`
        SELECT e.enumlabel
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'SendIntentStatus'
        ORDER BY e.enumsortorder
    `;
    console.log("\n=== SendIntentStatus ENUM VALUES ===");
    for (const e of enums) {
        console.log(`  ${e.enumlabel}`);
    }

    // 4. Row count
    const count = await prisma.sendIntent.count();
    console.log(`\n=== ROW COUNT === ${count}`);

    // 5. Status distribution (raw SQL to avoid Prisma client issues)
    const dist = await prisma.$queryRaw<any[]>`
        SELECT status, COUNT(*) as n FROM "SendIntent" GROUP BY status ORDER BY n DESC
    `;
    console.log("=== STATUS DISTRIBUTION ===");
    for (const d of dist) {
        console.log(`  ${d.status}: ${d.n}`);
    }

    // 6. Foreign keys
    const fks = await prisma.$queryRaw<any[]>`
        SELECT
            kcu.column_name,
            ccu.table_name AS foreign_table,
            ccu.column_name AS foreign_column,
            rc.delete_rule
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
        JOIN information_schema.referential_constraints rc ON tc.constraint_name = rc.constraint_name
        JOIN information_schema.constraint_column_usage ccu ON rc.unique_constraint_name = ccu.constraint_name
        WHERE tc.table_name = 'SendIntent' AND tc.constraint_type = 'FOREIGN KEY'
    `;
    console.log("\n=== FOREIGN KEYS ===");
    for (const f of fks) {
        console.log(`  ${f.column_name} → ${f.foreign_table}.${f.foreign_column} (ON DELETE ${f.delete_rule})`);
    }

    // 7. Migration ledger for SendIntent-related migrations
    const migrations = await prisma.$queryRaw<any[]>`
        SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
        FROM _prisma_migrations
        WHERE migration_name LIKE '%sendintent%'
           OR migration_name LIKE '%send_intent%'
           OR migration_name LIKE '%v3_1%'
           OR migration_name LIKE '%phase1%'
           OR migration_name LIKE '%authoritative%'
           OR migration_name LIKE '%outbox_observability%'
           OR migration_name LIKE '%cas_columns%'
           OR migration_name LIKE '%missing_cas%'
        ORDER BY started_at
    `;
    console.log("\n=== MIGRATION LEDGER (SendIntent-related) ===");
    for (const m of migrations) {
        const state = m.rolled_back_at ? "ROLLED_BACK" : m.finished_at ? "APPLIED" : "PENDING/FAILED";
        console.log(`  [${state}] ${m.migration_name}`);
        console.log(`    finished_at=${m.finished_at} | rolled_back_at=${m.rolled_back_at} | steps=${m.applied_steps_count}`);
    }

    // 8. Full recent migration ledger
    const allMigrations = await prisma.$queryRaw<any[]>`
        SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
        FROM _prisma_migrations
        ORDER BY started_at DESC
        LIMIT 20
    `;
    console.log("\n=== RECENT MIGRATION LEDGER (last 20) ===");
    for (const m of allMigrations) {
        const state = m.rolled_back_at ? "ROLLED_BACK" : m.finished_at ? "APPLIED" : "PENDING/FAILED";
        console.log(`  [${state}] ${m.migration_name}`);
    }
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
