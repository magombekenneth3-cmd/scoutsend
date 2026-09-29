import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    console.log("=== DATABASE IDENTITY ===");
    const identity: any[] = await prisma.$queryRawUnsafe("SELECT current_database(), current_schema(), inet_server_addr()::text, inet_server_port()::text;");
    console.log("Identity:", identity[0]);

    console.log("\n=== ACTUAL PostgreSQL 'QueueJob' TABLE COLUMNS ===");
    const cols: any[] = await prisma.$queryRawUnsafe(`
        SELECT column_name, data_type, is_nullable, column_default 
        FROM information_schema.columns 
        WHERE table_name = 'QueueJob' 
        ORDER BY ordinal_position;
    `);
    for (const c of cols) {
        console.log(`  - ${c.column_name}: ${c.data_type} (Nullable: ${c.is_nullable}, Default: ${c.column_default})`);
    }

    console.log("\n=== CHECKING FOR bullJobId ===");
    const bullJobIdCol = cols.find((c) => c.column_name === "bullJobId");
    if (bullJobIdCol) {
        console.log("bullJobId EXISTS in DB:", bullJobIdCol);
    } else {
        console.log("bullJobId DOES NOT EXIST IN POSTGRESQL DATABASE.");
    }

    console.log("\n=== MIGRATION RECORD FOR 20260704061316_add_jobqueue ===");
    const mRows: any[] = await prisma.$queryRawUnsafe(`
        SELECT migration_name, finished_at, checksum 
        FROM _prisma_migrations 
        WHERE migration_name LIKE '%add_jobqueue%';
    `);
    console.log("Recorded in _prisma_migrations:", mRows);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
