import { prisma } from "../app/api/src/lib/prisma";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

async function main() {
    console.log("=================================================");
    console.log("=== STEP 1: DB IDENTITY & PRISMA TARGET CHECK ===");
    console.log("=================================================");

    const dbInfo: any[] = await prisma.$queryRawUnsafe(`
        SELECT 
          current_database()::text as db, 
          current_schema()::text as schema, 
          inet_server_addr()::text as host, 
          inet_server_port() as port, 
          current_user::text as user;
    `);
    console.log("PostgreSQL Live Session Info:", dbInfo[0]);

    const schemaPath = path.join(__dirname, "../prisma/schema.prisma");
    const schemaText = fs.readFileSync(schemaPath, "utf-8");

    // Extract datasource url info from schema.prisma / env
    const envPath = path.join(__dirname, "../.env");
    let databaseUrl = "";
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, "utf-8");
        const match = envContent.match(/DATABASE_URL=["']?([^"'\n]+)["']?/);
        if (match) databaseUrl = match[1];
    }
    console.log("Environment DATABASE_URL:", databaseUrl || "Using Prisma Client connection");

    // 2. Physical Tables Mapping
    const physicalTables: any[] = await prisma.$queryRawUnsafe(`
        SELECT table_name::text 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name != '_prisma_migrations';
    `);
    const pgTableNames = new Set(physicalTables.map(t => t.table_name));

    // 3. Physical Columns Map
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

    // 4. Full Repo Search Function (Searching whole /Users/extremesales/aisales/web)
    function searchFullRepo(term: string): { occurrences: number; matches: string[] } {
        try {
            const cmd = `rg -n "${term}" /Users/extremesales/aisales/web --glob '!node_modules/**' --glob '!.next/**' --glob '!prisma/schema.prisma' --glob '!scratch/**' 2>/dev/null || true`;
            const out = execSync(cmd, { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }).trim();
            if (!out) return { occurrences: 0, matches: [] };
            const lines = out.split("\n").filter(Boolean);
            return { occurrences: lines.length, matches: lines.slice(0, 5) };
        } catch {
            return { occurrences: 0, matches: [] };
        }
    }

    // List of 31 missing fields to audit repository-wide
    const missing31Fields = [
        { model: "Reply", field: "isRead", type: "Boolean" },
        { model: "Reply", field: "snoozedUntil", type: "DateTime" },
        { model: "SenderMailbox", field: "spfValid", type: "Boolean" },
        { model: "SenderMailbox", field: "dkimValid", type: "Boolean" },
        { model: "SenderMailbox", field: "dmarcValid", type: "Boolean" },
        { model: "SenderMailbox", field: "dkimSelector", type: "String" },
        { model: "SenderMailbox", field: "dnsCheckedAt", type: "DateTime" },
        { model: "BrandSettings", field: "provenStats", type: "Json" },
        { model: "Company", field: "version", type: "Int" },
        { model: "Operation", field: "leaseVersion", type: "Int" },
        { model: "SendIntent", field: "traceId", type: "String" },
        { model: "SendIntent", field: "provider", type: "String" },
        { model: "SendIntent", field: "payloadHash", type: "String" },
        { model: "SendIntent", field: "lastAttemptAt", type: "DateTime" },
        { model: "SendIntent", field: "claimedBy", type: "String" },
        { model: "SendIntent", field: "fencingEpoch", type: "Int" },
        { model: "SendIntent", field: "leaseVersion", type: "Int" },
        { model: "SendIntent", field: "leaseExpiresAt", type: "DateTime" },
        { model: "SendIntent", field: "reconciliationAttempts", type: "Int" },
        { model: "SendIntent", field: "version", type: "Int" },
        { model: "QuotaReservation", field: "operationId", type: "String" },
        { model: "QuotaReservation", field: "scopeId", type: "String" },
        { model: "QuotaReservation", field: "windowStart", type: "DateTime" },
        { model: "QuotaReservation", field: "version", type: "Int" },
        { model: "CampaignRun", field: "fencingEpoch", type: "Int" },
        { model: "CampaignRun", field: "version", type: "Int" },
        { model: "CampaignRun", field: "logicalVersion", type: "Int" },
        { model: "CampaignRunLease", field: "workerId", type: "String" },
        { model: "CampaignRunLease", field: "fencingEpoch", type: "Int" },
        { model: "CampaignRunLease", field: "leaseVersion", type: "Int" },
        { model: "CampaignRunLease", field: "leaseExpiresAt", type: "DateTime" }
    ];

    console.log("\n=========================================================");
    console.log("=== STEP 2: REPOSITORY-WIDE SEARCH FOR ALL 31 FIELDS ===");
    console.log("=========================================================");

    for (const mf of missing31Fields) {
        const repoSearch = searchFullRepo(mf.field);
        console.log(`\nModel: ${mf.model} | Field: ${mf.field} (${mf.type})`);
        console.log(`Repository-wide references count: ${repoSearch.occurrences}`);
        if (repoSearch.occurrences > 0) {
            console.log("Sample matches:", repoSearch.matches);
        }
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
