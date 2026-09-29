import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    console.log("=== DB IDENTITY ===");
    const dbInfo: any[] = await prisma.$queryRawUnsafe(`
        SELECT 
          current_database()::text as db, 
          current_schema()::text as schema, 
          inet_server_addr()::text as host, 
          inet_server_port() as port, 
          current_user::text as user;
    `);
    console.log(dbInfo[0]);

    const tables: any[] = await prisma.$queryRawUnsafe(`
        SELECT table_name::text 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name != '_prisma_migrations';
    `);

    const cols: any[] = await prisma.$queryRawUnsafe(`
        SELECT table_name::text, column_name::text, data_type::text, udt_name::text, is_nullable::text
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name != '_prisma_migrations';
    `);

    const indexes: any[] = await prisma.$queryRawUnsafe(`
        SELECT tablename::text, indexname::text
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename != '_prisma_migrations';
    `);

    const enums: any[] = await prisma.$queryRawUnsafe(`
        SELECT t.typname::text as enum_name, e.enumlabel::text as enum_value
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public';
    `);

    const enumNames = new Set(enums.map(e => e.enum_name));

    console.log("\n=== PHYSICAL METRICS ===");
    console.log("Database:", dbInfo[0].db);
    console.log("Total Physical Tables:", tables.length);
    console.log("Total Physical Columns:", cols.length);
    console.log("Total Physical Indexes:", indexes.length);
    console.log("Total Physical Enums:", enumNames.size);
    console.log("Total Physical Enum Values:", enums.length);
}

main().catch(console.error).finally(() => prisma.$disconnect());
