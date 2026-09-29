import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    console.log("=== 1. PHYSICAL COLUMN VERIFICATION ===");
    const col: any[] = await prisma.$queryRawUnsafe(`
        SELECT 
          column_name, 
          data_type, 
          is_nullable, 
          column_default 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'OutboxEvent' 
          AND column_name = 'aggregateVersion';
    `);
    console.table(col);

    console.log("\n=== 2. EXISTING-ROW VERIFICATION ===");
    const rowStats: any[] = await prisma.$queryRawUnsafe(`
        SELECT 
          COUNT(*)::text AS total, 
          COUNT("aggregateVersion")::text AS with_version, 
          MIN("aggregateVersion") AS min_version, 
          MAX("aggregateVersion") AS max_version 
        FROM "OutboxEvent";
    `);
    console.log("OutboxEvent row statistics:", rowStats[0]);

    console.log("\n=== 3. MIGRATION HISTORY VERIFICATION (_prisma_migrations) ===");
    const migRecord: any[] = await prisma.$queryRawUnsafe(`
        SELECT id, migration_name, finished_at, rolled_back_at 
        FROM _prisma_migrations 
        WHERE migration_name LIKE '%20260813030000%';
    `);
    console.log("Migration log record:", migRecord[0]);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
