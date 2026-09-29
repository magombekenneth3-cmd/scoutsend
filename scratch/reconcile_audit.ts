import { prisma } from "../app/api/src/lib/prisma";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

async function main() {
    const schemaPath = path.join(__dirname, "../prisma/schema.prisma");
    const schemaText = fs.readFileSync(schemaPath, "utf-8");

    // 1. Physical DB Identity
    const dbInfo: any[] = await prisma.$queryRawUnsafe(`
        SELECT current_database()::text as db, current_schema()::text as schema, inet_server_addr()::text as host, inet_server_port() as port, current_user::text as user;
    `);

    // 2. Physical Tables
    const physicalTables: any[] = await prisma.$queryRawUnsafe(`
        SELECT table_name::text 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name != '_prisma_migrations';
    `);
    const pgTableNames = new Set(physicalTables.map(t => t.table_name));

    // 3. Physical Columns
    const physicalCols: any[] = await prisma.$queryRawUnsafe(`
        SELECT table_name::text, column_name::text, data_type::text, udt_name::text, is_nullable::text, column_default::text
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

    // 4. Check NULL count in nullability mismatch columns
    const apiKeyNullScopes: any[] = await prisma.$queryRawUnsafe(`SELECT count(*)::int as count FROM "ApiKey" WHERE "scopes" IS NULL;`);
    const campaignNullDays: any[] = await prisma.$queryRawUnsafe(`SELECT count(*)::int as count FROM "Campaign" WHERE "sendWindowDays" IS NULL;`);
    const leadNullTech: any[] = await prisma.$queryRawUnsafe(`SELECT count(*)::int as count FROM "Lead" WHERE "competitorTech" IS NULL;`);

    console.log("=== NULL ROW COUNTS IN DB ===");
    console.log("ApiKey.scopes NULL count:", apiKeyNullScopes[0].count);
    console.log("Campaign.sendWindowDays NULL count:", campaignNullDays[0].count);
    console.log("Lead.competitorTech NULL count:", leadNullTech[0].count);

    // 5. Inspect AITrace columns in PostgreSQL vs schema.prisma
    console.log("\n=== AITRACE PHYSICAL COLUMNS IN POSTGRESQL ===");
    const aiTraceCols = pgColsByTable.get("AITrace");
    if (aiTraceCols) {
        for (const [colName, col] of aiTraceCols.entries()) {
            console.log(`Column '${colName}': type=${col.udt_name}, nullable=${col.is_nullable}`);
        }
    }

    // Search codebase for AITrace column usages
    const aiTraceFields = ["agentName", "prompt", "response", "model", "promptVersion", "latencyMs", "tokenUsage", "confidence", "costUsd", "campaignId", "leadId", "metadata", "createdAt"];
    console.log("\n=== AITRACE RUNTIME USAGE SEARCH ===");
    for (const f of aiTraceFields) {
        const out = execSync(`rg -n "AITrace" /Users/extremesales/aisales/web/app/api/src 2>/dev/null || true`, { encoding: "utf-8" }).trim();
        const lines = out ? out.split("\n") : [];
        console.log(`AITrace field '${f}': ${lines.length} references to AITrace in codebase`);
    }

    // 6. Check legacy columns in DB
    const legacyColsToTest = [
        { table: "QuotaReservation", col: "targetId" },
        { table: "CampaignRun", col: "startedAt" },
        { table: "CampaignRun", col: "completedAt" },
        { table: "CampaignRunLease", col: "expiresAt" },
        { table: "CampaignRunLease", col: "leaseToken" }
    ];

    console.log("\n=== LEGACY COLUMNS NULL ROW INSPECTION ===");
    for (const leg of legacyColsToTest) {
        try {
            const res: any[] = await prisma.$queryRawUnsafe(`SELECT count(*)::int as total, count("${leg.col}")::int as non_null FROM "${leg.table}";`);
            console.log(`${leg.table}.${leg.col}: total rows = ${res[0].total}, non-null rows = ${res[0].non_null}`);
        } catch (e: any) {
            console.log(`${leg.table}.${leg.col}: Error checking table - ${e.message}`);
        }
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
