import { prisma } from "../app/api/src/lib/prisma";
import { execSync } from "child_process";

async function main() {
    console.log("=== DB IDENTITY ===");
    const dbInfo: any[] = await prisma.$queryRawUnsafe(`
        SELECT current_database(), current_schema(), inet_server_addr(), inet_server_port(), current_user;
    `);
    console.log(dbInfo[0]);

    const missingFields = [
        "provenStats",
        "leaseVersion",
        "traceId",
        "payloadHash",
        "lastAttemptAt",
        "claimedBy",
        "fencingEpoch",
        "reconciliationAttempts",
        "windowStart",
        "logicalVersion"
    ];

    console.log("\n=== RUNTIME USAGE FOR MISSING FIELDS ===");
    for (const f of missingFields) {
        try {
            const out = execSync(`rg -n "${f}" /Users/extremesales/aisales/web/app/api/src 2>/dev/null || true`, { encoding: "utf-8" }).trim();
            const lines = out ? out.split("\n") : [];
            console.log(`\nField '${f}': ${lines.length} references`);
            if (lines.length > 0) {
                console.log(lines.slice(0, 5).join("\n"));
            }
        } catch (e) {}
    }

    const missingEnums = [
        "VALIDATED", "AUTHORIZED", "DISPATCHING", "BLOCKED", "CANCELLED",
        "HEALTH_WARNING", "HEALTH_DEGRADED", "HEALTH_BLOCKED",
        "LINKEDIN_POST_CONNECT", "LEASE_EXPIRED",
        "SENT", "RECONCILING", "UNRESOLVED", "HUMAN_REVIEW"
    ];

    console.log("\n=== RUNTIME USAGE FOR MISSING ENUM VALUES ===");
    for (const ev of missingEnums) {
        try {
            const out = execSync(`rg -n "${ev}" /Users/extremesales/aisales/web/app/api/src 2>/dev/null || true`, { encoding: "utf-8" }).trim();
            const lines = out ? out.split("\n") : [];
            console.log(`\nEnum Value '${ev}': ${lines.length} references`);
            if (lines.length > 0) {
                console.log(lines.slice(0, 5).join("\n"));
            }
        } catch (e) {}
    }
}

main().catch(console.error).finally(() => prisma.$disconnect());
