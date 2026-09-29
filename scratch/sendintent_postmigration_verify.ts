import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    // 1. Physical columns — full list
    const cols = await prisma.$queryRaw<any[]>`
        SELECT column_name, data_type, column_default, is_nullable
        FROM information_schema.columns
        WHERE table_name = 'SendIntent'
        ORDER BY ordinal_position
    `;
    console.log("=== PHYSICAL COLUMNS (" + cols.length + ") ===");
    for (const c of cols) {
        console.log(`  ${c.column_name}: ${c.data_type} | default=${c.column_default} | nullable=${c.is_nullable}`);
    }

    // 2. Physical indexes — full list
    const idxs = await prisma.$queryRaw<any[]>`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'SendIntent'
        ORDER BY indexname
    `;
    console.log("\n=== PHYSICAL INDEXES (" + idxs.length + ") ===");
    for (const i of idxs) {
        console.log(`  ${i.indexname}`);
    }

    // 3. Enum values — must now be 9
    const enums = await prisma.$queryRaw<any[]>`
        SELECT e.enumlabel
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'SendIntentStatus'
        ORDER BY e.enumsortorder
    `;
    console.log("\n=== SendIntentStatus ENUM VALUES (" + enums.length + ") ===");
    for (const e of enums) {
        console.log(`  ${e.enumlabel}`);
    }

    // 4. Row count — must remain 0
    const count = await prisma.$queryRaw<{n: bigint}[]>`SELECT COUNT(*) as n FROM "SendIntent"`;
    console.log(`\n=== ROW COUNT === ${count[0].n}`);

    // 5. Migration ledger — confirm new migration applied
    const ledger = await prisma.$queryRaw<any[]>`
        SELECT migration_name, finished_at, rolled_back_at, applied_steps_count
        FROM _prisma_migrations
        WHERE migration_name = '20260816100000_add_sendintent_lease_fencing_columns'
    `;
    console.log("\n=== NEW MIGRATION LEDGER ENTRY ===");
    for (const m of ledger) {
        const state = m.rolled_back_at ? "ROLLED_BACK" : m.finished_at ? "APPLIED" : "FAILED/PENDING";
        console.log(`  [${state}] ${m.migration_name}`);
        console.log(`    finished_at=${m.finished_at} | steps=${m.applied_steps_count}`);
    }

    // 6. Spot-check specific required columns
    const required = [
        "traceId","provider","payloadHash","lastAttemptAt",
        "claimedBy","fencingEpoch","leaseVersion","leaseExpiresAt",
        "reconciliationAttempts","version"
    ];
    const colNames = cols.map((c: any) => c.column_name);
    console.log("\n=== REQUIRED COLUMN PRESENCE ===");
    for (const col of required) {
        const found = colNames.includes(col);
        console.log(`  ${found ? "✅" : "❌"} ${col}`);
    }

    // 7. Spot-check required indexes
    const requiredIdxs = [
        "SendIntent_campaignId_idx",
        "SendIntent_mailboxId_idx",
        "SendIntent_claimedBy_leaseExpiresAt_idx",
        "SendIntent_status_leaseExpiresAt_idx",
        "SendIntent_status_reconciliationAttempts_updatedAt_idx",
    ];
    const idxNames = idxs.map((i: any) => i.indexname);
    console.log("\n=== REQUIRED INDEX PRESENCE ===");
    for (const idx of requiredIdxs) {
        console.log(`  ${idxNames.includes(idx) ? "✅" : "❌"} ${idx}`);
    }

    // 8. Spot-check required enum values
    const requiredEnums = ["SENT","RECONCILING","UNRESOLVED","HUMAN_REVIEW"];
    const enumVals = enums.map((e: any) => e.enumlabel);
    console.log("\n=== REQUIRED ENUM VALUE PRESENCE ===");
    for (const v of requiredEnums) {
        console.log(`  ${enumVals.includes(v) ? "✅" : "❌"} ${v}`);
    }
}

main()
    .catch(e => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());
