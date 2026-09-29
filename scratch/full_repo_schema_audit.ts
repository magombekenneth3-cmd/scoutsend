import fs from "fs";
import path from "path";
import { prisma } from "../app/api/src/lib/prisma";

interface FieldInfo {
  fieldName: string;
  colName: string;
  fieldType: string;
}

interface ModelInfo {
  modelName: string;
  tableName: string;
  fields: Record<string, FieldInfo>;
}

function parsePrismaSchema(schemaPath: string): Record<string, ModelInfo> {
  const content = fs.readFileSync(schemaPath, "utf8");
  const models: Record<string, ModelInfo> = {};

  const enumNames = new Set<string>();
  const enumMatches = content.matchAll(/enum\s+(\w+)\s*\{/g);
  for (const m of enumMatches) {
    enumNames.add(m[1]);
  }

  const scalarTypes = new Set([
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
      fields: {},
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
          (scalarTypes.has(baseType) || enumNames.has(baseType));

        if (isScalar) {
          modelInfo.fields[fieldName] = {
            fieldName,
            colName,
            fieldType: rawType,
          };
        }
      }
    }

    models[modelName] = modelInfo;
  }

  return models;
}

async function main() {
  const schemaPath = path.join(process.cwd(), "prisma/schema.prisma");
  const prismaModels = parsePrismaSchema(schemaPath);

  const rawCols: Array<{ table_name: string; column_name: string }> = await prisma.$queryRawUnsafe(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `);

  const dbTables: Record<string, Set<string>> = {};
  for (const row of rawCols) {
    if (!dbTables[row.table_name]) {
      dbTables[row.table_name] = new Set();
    }
    dbTables[row.table_name].add(row.column_name);
  }

  let totalScalarFieldsAudited = 0;
  let physicallyVerifiedCount = 0;
  const categoryB_missingColumns: Array<{
    model: string;
    table: string;
    field: string;
    col: string;
    type: string;
  }> = [];

  const prismaColsByTable: Record<string, Set<string>> = {};

  for (const [modelName, modelInfo] of Object.entries(prismaModels)) {
    const tableCols = dbTables[modelInfo.tableName] || new Set();
    prismaColsByTable[modelInfo.tableName] = new Set();

    for (const [fieldName, fieldInfo] of Object.entries(modelInfo.fields)) {
      totalScalarFieldsAudited++;
      prismaColsByTable[modelInfo.tableName].add(fieldInfo.colName);

      if (tableCols.has(fieldInfo.colName)) {
        physicallyVerifiedCount++;
      } else {
        categoryB_missingColumns.push({
          model: modelName,
          table: modelInfo.tableName,
          field: fieldName,
          col: fieldInfo.colName,
          type: fieldInfo.fieldType,
        });
      }
    }
  }

  const categoryC_extraPhysicalColumns: Array<{
    table: string;
    column: string;
  }> = [];

  for (const [tableName, cols] of Object.entries(dbTables)) {
    const prismaCols = prismaColsByTable[tableName] || new Set();
    for (const col of cols) {
      if (!prismaCols.has(col)) {
        categoryC_extraPhysicalColumns.push({
          table: tableName,
          column: col,
        });
      }
    }
  }

  console.log("=== COMPREHENSIVE REPOSITORY-WIDE PRISMA FIELD AUDIT ===");
  console.log(`Total Prisma Models Audited: ${Object.keys(prismaModels).length}`);
  console.log(`Total Prisma Scalar Fields Audited: ${totalScalarFieldsAudited}`);
  console.log(`Physically Verified in PostgreSQL (Category A): ${physicallyVerifiedCount}`);
  console.log(`Category B (Declared in Prisma, missing in physical DB): ${categoryB_missingColumns.length}`);
  console.log(`Category C (Exists in physical DB, missing in Prisma schema): ${categoryC_extraPhysicalColumns.length}`);

  fs.writeFileSync(
    path.join(process.cwd(), "scratch/category_b_mismatches.json"),
    JSON.stringify(categoryB_missingColumns, null, 2)
  );

  fs.writeFileSync(
    path.join(process.cwd(), "scratch/category_c_mismatches.json"),
    JSON.stringify(categoryC_extraPhysicalColumns, null, 2)
  );

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Audit script failed:", err);
  prisma.$disconnect();
  process.exit(1);
});
