import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    console.log("=== READ-ONLY DATABASE PRE-CHECK FOR QueueJob ===");

    // 1. Check if QueueJob table exists
    const tblExists: any[] = await prisma.$queryRawUnsafe(`
        SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'QueueJob'
        );
    `);
    console.log("1. QueueJob Table Exists:", tblExists[0].exists);

    // 2. Check if bullJobId column exists
    const colExists: any[] = await prisma.$queryRawUnsafe(`
        SELECT EXISTS (
            SELECT FROM information_schema.columns 
            WHERE table_schema = 'public' 
            AND table_name = 'QueueJob' 
            AND column_name = 'bullJobId'
        );
    `);
    console.log("2. bullJobId Column Exists:", colExists[0].exists);

    // 3. Check if index QueueJob_bullJobId_key exists
    const idxExists: any[] = await prisma.$queryRawUnsafe(`
        SELECT EXISTS (
            SELECT FROM pg_indexes 
            WHERE schemaname = 'public' 
            AND tablename = 'QueueJob' 
            AND indexname = 'QueueJob_bullJobId_key'
        );
    `);
    console.log("3. Index QueueJob_bullJobId_key Exists:", idxExists[0].exists);

    // 4. Check existing QueueJob row count
    const rowCount: any[] = await prisma.$queryRawUnsafe(`SELECT count(*)::text FROM "QueueJob";`);
    console.log("4. Existing QueueJob Rows:", rowCount[0].count);

    // 5. Check conflicting constraints/columns
    const conflicting: any[] = await prisma.$queryRawUnsafe(`
        SELECT indexname FROM pg_indexes 
        WHERE schemaname = 'public' 
        AND tablename = 'QueueJob' 
        AND indexname LIKE '%bullJobId%';
    `);
    console.log("5. Conflicting bullJobId Indexes:", conflicting);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
