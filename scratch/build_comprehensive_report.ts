import { prisma } from "../app/api/src/lib/prisma";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

async function main() {
    const schemaPath = path.join(__dirname, "../prisma/schema.prisma");
    const schemaText = fs.readFileSync(schemaPath, "utf-8");

    // DB info
    const dbInfo: any[] = await prisma.$queryRawUnsafe(`
        SELECT 
          current_database()::text as db, 
          current_schema()::text as schema, 
          inet_server_addr()::text as host, 
          inet_server_port() as port, 
          current_user::text as user;
    `);

    // Physical Tables
    const physicalTables: any[] = await prisma.$queryRawUnsafe(`
        SELECT table_name::text 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name != '_prisma_migrations';
    `);

    // Physical Columns
    const physicalCols: any[] = await prisma.$queryRawUnsafe(`
        SELECT 
          table_name::text, 
          column_name::text, 
          data_type::text, 
          udt_name::text, 
          is_nullable::text, 
          column_default::text
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name != '_prisma_migrations';
    `);

    const pgColsByTable = new Map<string, Map<string, any>>();
    for (const c of physicalCols) {
        if (!pgColsByTable.has(c.table_name)) {
            pgColsByTable.set(c.table_name, new Map());
        }
        pgColsByTable.get(c.table_name)!.set(c.column_name, c);
    }

    // Physical Enums
    const physicalEnums: any[] = await prisma.$queryRawUnsafe(`
        SELECT t.typname::text as enum_name, e.enumlabel::text as enum_value
        FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = 'public';
    `);

    const pgEnumsByName = new Map<string, string[]>();
    for (const row of physicalEnums) {
        if (!pgEnumsByName.has(row.enum_name)) {
            pgEnumsByName.set(row.enum_name, []);
        }
        pgEnumsByName.get(row.enum_name)!.push(row.enum_value);
    }

    // Physical Indexes
    const physicalIndexes: any[] = await prisma.$queryRawUnsafe(`
        SELECT tablename::text, indexname::text, indexdef::text
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename != '_prisma_migrations';
    `);

    const pgIndexesByTable = new Map<string, any[]>();
    for (const idx of physicalIndexes) {
        if (!pgIndexesByTable.has(idx.tablename)) {
            pgIndexesByTable.set(idx.tablename, []);
        }
        pgIndexesByTable.get(idx.tablename)!.push(idx);
    }

    console.log("Database identity verified:", dbInfo[0]);
    console.log("Physical Tables:", physicalTables.length);
    console.log("Physical Columns:", physicalCols.length);
    console.log("Physical Enums:", pgEnumsByName.size);
    console.log("Physical Indexes:", physicalIndexes.length);
}

main().catch(console.error).finally(() => prisma.$disconnect());
