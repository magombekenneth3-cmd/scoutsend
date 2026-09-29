import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    console.log("=== DATABASE IDENTITY ===");
    const identity: any[] = await prisma.$queryRawUnsafe("SELECT current_database(), current_schema(), inet_server_addr()::text, inet_server_port()::text;");
    console.log("Identity:", identity[0]);

    console.log("\n=== ACTUAL PostgreSQL 'User' TABLE COLUMNS ===");
    const cols: any[] = await prisma.$queryRawUnsafe(`
        SELECT column_name, data_type, is_nullable, column_default 
        FROM information_schema.columns 
        WHERE table_name = 'User' 
        ORDER BY ordinal_position;
    `);
    for (const c of cols) {
        console.log(`  - ${c.column_name}: ${c.data_type} (Nullable: ${c.is_nullable}, Default: ${c.column_default})`);
    }

    console.log("\n=== TABLES CONTAINING 'emailVerified' IN DB ===");
    const evCols: any[] = await prisma.$queryRawUnsafe(`
        SELECT column_name, table_name 
        FROM information_schema.columns 
        WHERE column_name = 'emailVerified';
    `);
    for (const c of evCols) {
        console.log(`  - ${c.table_name}.${c.column_name}`);
    }

    console.log("\n=== MIGRATION RECORD FOR emailVerified ===");
    const mRows: any[] = await prisma.$queryRawUnsafe(`
        SELECT migration_name, finished_at 
        FROM _prisma_migrations 
        ORDER BY finished_at;
    `);
    console.log(`Total applied migrations recorded: ${mRows.length}`);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
