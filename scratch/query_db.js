const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function main() {
    console.log("=== DATABASE IDENTITY ===");
    const identity = await prisma.$queryRawUnsafe("SELECT current_database(), current_schema(), inet_server_addr()::text, inet_server_port()::text;");
    console.log("Identity:", identity);

    console.log("\n=== ACTUAL PostgreSQL 'User' TABLE COLUMNS ===");
    const cols = await prisma.$queryRawUnsafe(`
        SELECT column_name, data_type, is_nullable, column_default 
        FROM information_schema.columns 
        WHERE table_name = 'User' 
        ORDER BY ordinal_position;
    `);
    console.log("User Columns:", cols);

    console.log("\n=== TABLES CONTAINING 'emailVerified' IN DB ===");
    const evCols = await prisma.$queryRawUnsafe(`
        SELECT column_name, table_name 
        FROM information_schema.columns 
        WHERE column_name = 'emailVerified';
    `);
    console.log("emailVerified Columns:", evCols);

    console.log("\n=== _prisma_migrations TOTAL COUNT ===");
    const mCount = await prisma.$queryRawUnsafe("SELECT count(*) FROM _prisma_migrations;");
    console.log("Migrations count:", mCount);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
