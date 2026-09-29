import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    console.log("=== REPLY PHYSICAL COLUMNS ===");
    const replyCols: any[] = await prisma.$queryRawUnsafe(`
        SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'Reply';
    `);
    console.table(replyCols);

    console.log("=== SENDERMAILBOX PHYSICAL COLUMNS ===");
    const smCols: any[] = await prisma.$queryRawUnsafe(`
        SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'SenderMailbox';
    `);
    console.table(smCols);
}

main().catch(console.error).finally(() => prisma.$disconnect());
