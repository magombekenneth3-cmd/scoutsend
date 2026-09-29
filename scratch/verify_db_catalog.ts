import { prisma } from "../app/api/src/lib/prisma";

async function verifyCatalog() {
  console.log("=== PHYSICAL DATABASE CATALOG VERIFICATION ===");

  // 1. SendIntent columns
  const columns = await prisma.$queryRaw<Array<{ column_name: string; data_type: string; is_nullable: string }>>`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'SendIntent'
    ORDER BY column_name;
  `;
  console.log("\n--- SendIntent Columns (Total:", columns.length, ") ---");
  for (const col of columns) {
    console.log(` - ${col.column_name}: ${col.data_type} (nullable: ${col.is_nullable})`);
  }

  const requiredCols = [
    "traceId",
    "provider",
    "payloadHash",
    "lastAttemptAt",
    "claimedBy",
    "fencingEpoch",
    "leaseVersion",
    "leaseExpiresAt",
    "reconciliationAttempts",
    "version",
  ];
  const colNames = columns.map((c) => c.column_name);
  const missingCols = requiredCols.filter((c) => !colNames.includes(c));
  if (missingCols.length > 0) {
    console.error("❌ MISSING COLUMNS:", missingCols);
  } else {
    console.log("✅ All 10 required target columns exist physically!");
  }

  // 2. SendIntentStatus Enum values
  const enumValues = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
    SELECT enumlabel
    FROM pg_enum
    JOIN pg_type ON pg_enum.enumtypid = pg_type.oid
    WHERE pg_type.typname = 'SendIntentStatus'
    ORDER BY enumsortorder;
  `;
  console.log("\n--- SendIntentStatus Enum Values (Total:", enumValues.length, ") ---");
  for (const ev of enumValues) {
    console.log(` - ${ev.enumlabel}`);
  }
  const expectedEnums = [
    "PENDING",
    "DISPATCHING",
    "ACCEPTED",
    "SENT",
    "FAILED",
    "UNKNOWN",
    "RECONCILING",
    "UNRESOLVED",
    "HUMAN_REVIEW",
  ];
  const actualEnums = enumValues.map((e) => e.enumlabel);
  const missingEnums = expectedEnums.filter((e) => !actualEnums.includes(e));
  if (missingEnums.length > 0) {
    console.error("❌ MISSING ENUM VALUES:", missingEnums);
  } else {
    console.log("✅ All 9 expected enum values exist physically!");
  }

  // 3. SendIntent Indexes
  const indexes = await prisma.$queryRaw<Array<{ indexname: string; indexdef: string }>>`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'SendIntent'
    ORDER BY indexname;
  `;
  console.log("\n--- SendIntent Indexes (Total:", indexes.length, ") ---");
  for (const idx of indexes) {
    console.log(` - ${idx.indexname}`);
  }

  await prisma.$disconnect();
}

verifyCatalog().catch((err) => {
  console.error(err);
  process.exit(1);
});
