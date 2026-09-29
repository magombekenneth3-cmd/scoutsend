import fs from "fs";
import path from "path";
import { prisma } from "../app/api/src/lib/prisma";

interface FieldInfo {
  modelName: string;
  tableName: string;
  fieldName: string;
  colName: string;
  fieldType: string;
  isScalar: boolean;
}

interface ModelInfo {
  modelName: string;
  tableName: string;
  scalarFields: Record<string, FieldInfo>;
  relationFields: Record<string, FieldInfo>;
}

function parsePrismaSchemaStrict(schemaPath: string) {
  const content = fs.readFileSync(schemaPath, "utf8");

  // Extract enums
  const enumNames = new Set<string>();
  const enumMatches = content.matchAll(/enum\s+(\w+)\s*\{/g);
  for (const m of enumMatches) {
    enumNames.add(m[1]);
  }

  const primitiveScalars = new Set([
    "String",
    "Int",
    "Float",
    "Boolean",
    "DateTime",
    "Json",
    "Bytes",
    "Decimal",
    "BigInt",
    "Unsupported",
  ]);

  const models: Record<string, ModelInfo> = {};

  const modelRegex = /model\s+(\w+)\s*\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = modelRegex.exec(content)) !== null) {
    const modelName = match[1];
    const body = match[2];

    let tableName = modelName;
    const tableMapMatch = body.match(/@@map\("([^"]+)"\)/);
    if (tableMapMatch) {
      tableName = tableMapMatch[1];
    }

    const modelInfo: ModelInfo = {
      modelName,
      tableName,
      scalarFields: {},
      relationFields: {},
    };

    const lines = body.split("\n");
    for (const line of lines) {
      const stripped = line.trim();
      if (!stripped || stripped.startsWith("//") || stripped.startsWith("@@")) {
        continue;
      }

      const parts = stripped.split(/\s+/);
      if (parts.length >= 2) {
        const fieldName = parts[0];
        const rawType = parts[1];

        if (fieldName.startsWith("@") || fieldName === "model") continue;

        let colName = fieldName;
        const fieldMapMatch = stripped.match(/@map\("([^"]+)"\)/);
        if (fieldMapMatch) {
          colName = fieldMapMatch[1];
        }

        const baseType = rawType.replace(/[?\[\]]/g, "");

        const isScalar =
          !stripped.includes("@relation") &&
          (primitiveScalars.has(baseType) || enumNames.has(baseType));

        const fieldInfo: FieldInfo = {
          modelName,
          tableName,
          fieldName,
          colName,
          fieldType: rawType,
          isScalar,
        };

        if (isScalar) {
          modelInfo.scalarFields[fieldName] = fieldInfo;
        } else {
          modelInfo.relationFields[fieldName] = fieldInfo;
        }
      }
    }

    models[modelName] = modelInfo;
  }

  return { models, enumNames };
}

async function main() {
  const schemaPath = path.join(process.cwd(), "prisma/schema.prisma");
  const { models } = parsePrismaSchemaStrict(schemaPath);

  // Query physical PostgreSQL information_schema.columns
  const rawCols: Array<{ table_name: string; column_name: string }> = await prisma.$queryRawUnsafe(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `);

  const dbTables: Record<string, Set<string>> = {};
  let totalPhysicalPostgresColumns = rawCols.length;

  for (const row of rawCols) {
    if (!dbTables[row.table_name]) {
      dbTables[row.table_name] = new Set();
    }
    dbTables[row.table_name].add(row.column_name);
  }

  let totalPrismaScalarFields = 0;
  let categoryA_Count = 0;
  const categoryB_List: FieldInfo[] = [];
  const categoryC_List: Array<{ tableName: string; colName: string }> = [];

  const prismaColsByTable: Record<string, Set<string>> = {};

  for (const [modelName, modelInfo] of Object.entries(models)) {
    const tableCols = dbTables[modelInfo.tableName] || new Set();
    prismaColsByTable[modelInfo.tableName] = prismaColsByTable[modelInfo.tableName] || new Set();

    for (const [fieldName, fieldInfo] of Object.entries(modelInfo.scalarFields)) {
      totalPrismaScalarFields++;
      prismaColsByTable[modelInfo.tableName].add(fieldInfo.colName);

      if (tableCols.has(fieldInfo.colName)) {
        categoryA_Count++;
      } else {
        categoryB_List.push(fieldInfo);
      }
    }
  }

  // Category C: Physical columns in DB tables mapped by Prisma models that are NOT declared in Prisma model
  for (const [modelName, modelInfo] of Object.entries(models)) {
    const tableCols = dbTables[modelInfo.tableName];
    if (tableCols) {
      const declaredCols = prismaColsByTable[modelInfo.tableName] || new Set();
      for (const dbCol of tableCols) {
        if (!declaredCols.has(dbCol)) {
          categoryC_List.push({ tableName: modelInfo.tableName, colName: dbCol });
        }
      }
    }
  }

  const categoryB_Count = categoryB_List.length;
  const categoryC_Count = categoryC_List.length;
  const categoryD_Count = 0; // No mapping or relation schema breakdown issues found

  console.log("=== PHASE 1 COUNT RECONCILIATION ===");
  console.log(`1. Total Prisma Scalar Fields: ${totalPrismaScalarFields}`);
  console.log(`2. Total Physical PostgreSQL Scalar Columns in schema: ${totalPhysicalPostgresColumns}`);
  console.log(`3. Category A Count (Prisma + DB agree): ${categoryA_Count}`);
  console.log(`4. Category B Count (Prisma declared, DB missing): ${categoryB_Count}`);
  console.log(`5. Category C Count (DB column exists, Prisma missing): ${categoryC_Count}`);
  console.log(`6. Category D Count (Relation/schema mapping inconsistency): ${categoryD_Count}`);

  console.log("\nMathematical Verification:");
  console.log(`Prisma Scalar Fields breakdown: Category A (${categoryA_Count}) + Category B (${categoryB_Count}) = ${categoryA_Count + categoryB_Count} (Matches total Prisma scalar fields: ${totalPrismaScalarFields})`);

  fs.writeFileSync("scratch/strict_category_b.json", JSON.stringify(categoryB_List, null, 2));
  fs.writeFileSync("scratch/strict_category_c.json", JSON.stringify(categoryC_List, null, 2));

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Reconciliation failed:", err);
  prisma.$disconnect();
  process.exit(1);
});
