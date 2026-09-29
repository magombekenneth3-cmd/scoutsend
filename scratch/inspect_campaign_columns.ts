import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    console.log("=== DATABASE IDENTITY ===");
    const identity: any[] = await prisma.$queryRawUnsafe("SELECT current_database(), current_schema(), inet_server_addr()::text, inet_server_port()::text;");
    console.log("Identity:", identity[0]);

    console.log("\n=== ACTUAL PostgreSQL 'Campaign' TABLE COLUMNS ===");
    const cols: any[] = await prisma.$queryRawUnsafe(`
        SELECT column_name, data_type, is_nullable, column_default 
        FROM information_schema.columns 
        WHERE table_name = 'Campaign' 
        ORDER BY ordinal_position;
    `);
    for (const c of cols) {
        console.log(`  - ${c.column_name}: ${c.data_type} (Nullable: ${c.is_nullable}, Default: ${c.column_default})`);
    }

    console.log("\n=== CHECKING FOR COPYWRITING INTELLIGENCE FIELDS ===");
    const targetFields = ["businessDescription", "valueProposition", "provenStats", "inboundEnabled", "requireVerifiedEmailForGeneration"];
    for (const f of targetFields) {
        const found = cols.find((c) => c.column_name === f);
        if (found) {
            console.log(`  - ${f}: PRESENT (${found.data_type})`);
        } else {
            console.log(`  - ${f}: MISSING IN POSTGRESQL`);
        }
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
