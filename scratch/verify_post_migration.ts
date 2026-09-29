import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    console.log("=== 1. PHYSICAL POSTGRESQL COLUMN VERIFICATION ===");
    const cols: any[] = await prisma.$queryRawUnsafe(`
        SELECT 
          column_name, 
          data_type, 
          is_nullable, 
          column_default 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'Campaign' 
          AND column_name IN (
            'businessDescription', 
            'valueProposition', 
            'provenStats', 
            'inboundEnabled', 
            'requireVerifiedEmailForGeneration'
          ) 
        ORDER BY column_name;
    `);
    console.table(cols);

    console.log("\n=== 2. MIGRATION HISTORY VERIFICATION (_prisma_migrations) ===");
    const migrationRecord: any[] = await prisma.$queryRawUnsafe(`
        SELECT id, migration_name, finished_at, rolled_back_at 
        FROM _prisma_migrations 
        WHERE migration_name LIKE '%20260813020000%';
    `);
    console.log("Migration log record:", migrationRecord[0]);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
