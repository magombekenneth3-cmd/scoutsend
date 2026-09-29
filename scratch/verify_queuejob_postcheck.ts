import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    console.log("=== PHYSICAL POSTGRESQL VERIFICATION FOR QueueJob.bullJobId ===");

    const colRes: any[] = await prisma.$queryRawUnsafe(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'QueueJob'
        AND column_name = 'bullJobId';
    `);
    console.log("Column Verification:", JSON.stringify(colRes, null, 2));

    const idxRes: any[] = await prisma.$queryRawUnsafe(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public'
        AND tablename = 'QueueJob'
        AND indexname = 'QueueJob_bullJobId_key';
    `);
    console.log("Index Verification:", JSON.stringify(idxRes, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
