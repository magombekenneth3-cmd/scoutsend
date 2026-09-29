import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    // 1. Audit missing indexes
    const pgIndexes: any[] = await prisma.$queryRawUnsafe(`
        SELECT tablename::text, indexname::text, indexdef::text
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename != '_prisma_migrations';
    `);

    console.log("Total PG Indexes:", pgIndexes.length);

    // 2. Audit all enums in PG
    const pgEnums: any[] = await prisma.$queryRawUnsafe(`
        SELECT t.typname::text as enum_name, e.enumlabel::text as enum_value
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public'
        ORDER BY t.typname, e.enumsortorder;
    `);

    const pgEnumMap = new Map<string, string[]>();
    for (const r of pgEnums) {
        if (!pgEnumMap.has(r.enum_name)) pgEnumMap.set(r.enum_name, []);
        pgEnumMap.get(r.enum_name)!.push(r.enum_value);
    }

    console.log("Total PG Enum Types:", pgEnumMap.size);
    for (const [name, vals] of pgEnumMap.entries()) {
        if (["DeliveryState", "DeliverabilityEventType", "Channel", "OperationStatus", "SendIntentStatus"].includes(name)) {
            console.log(`\nEnum '${name}' in PG (${vals.length} values):`, vals);
        }
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
