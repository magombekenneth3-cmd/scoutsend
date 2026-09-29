import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    console.log("=== PHYSICAL COLUMN VERIFICATION ===");
    const res: any[] = await prisma.$queryRawUnsafe(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'User'
        AND column_name = 'emailVerified';
    `);
    console.log(JSON.stringify(res, null, 2));
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
