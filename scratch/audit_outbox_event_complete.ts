import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    console.log("=== 1. PHYSICAL COLUMNS IN PostgreSQL 'OutboxEvent' ===");
    const cols: any[] = await prisma.$queryRawUnsafe(`
        SELECT 
          ordinal_position,
          column_name, 
          data_type, 
          udt_name,
          is_nullable, 
          column_default 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'OutboxEvent' 
        ORDER BY ordinal_position;
    `);
    console.table(cols);

    console.log("\n=== 2. PHYSICAL INDEXES ON 'OutboxEvent' ===");
    const indexes: any[] = await prisma.$queryRawUnsafe(`
        SELECT indexname, indexdef 
        FROM pg_indexes 
        WHERE tablename = 'OutboxEvent'
        ORDER BY indexname;
    `);
    console.table(indexes);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
