import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    console.log("=== 1. DATABASE IDENTITY VERIFICATION ===");
    const rawUrl = process.env.DATABASE_URL || "";
    const maskedUrl = rawUrl.replace(/:([^:@]+)@/, ":****@");
    console.log("DATABASE_URL in environment:", maskedUrl);

    const dbInfo: any[] = await prisma.$queryRawUnsafe(`
        SELECT current_database(), current_schema(), inet_server_addr(), inet_server_port();
    `);
    console.log("PostgreSQL Connection Info:", dbInfo[0]);

    console.log("\n=== 2. PHYSICAL COLUMNS IN PostgreSQL 'OutboxEvent' ===");
    const cols: any[] = await prisma.$queryRawUnsafe(`
        SELECT 
          ordinal_position,
          column_name, 
          data_type, 
          is_nullable, 
          column_default 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'OutboxEvent' 
        ORDER BY ordinal_position;
    `);
    console.table(cols);

    console.log("\n=== 3. CHECKING SPECIFICALLY FOR 'aggregateVersion' ===");
    const aggVer: any[] = await prisma.$queryRawUnsafe(`
        SELECT 
          column_name, 
          data_type, 
          is_nullable, 
          column_default 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'OutboxEvent' 
          AND lower(column_name) = lower('aggregateVersion');
    `);
    console.log("Matching aggregateVersion columns:", aggVer);

    console.log("\n=== 4. INDEXES ON 'OutboxEvent' ===");
    const indexes: any[] = await prisma.$queryRawUnsafe(`
        SELECT indexname, indexdef 
        FROM pg_indexes 
        WHERE tablename = 'OutboxEvent';
    `);
    console.table(indexes);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
