import { prisma } from "../app/api/src/lib/prisma";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

interface PrismaField {
    name: string;
    type: string;
    isOptional: boolean;
    isList: boolean;
    isId: boolean;
    isUnique: boolean;
    defaultVal?: string;
    dbMap?: string;
    isRelation: boolean;
    isUnsupported: boolean;
}

interface PrismaModel {
    name: string;
    dbName: string;
    fields: Map<string, PrismaField>;
    indexes: Array<{ name?: string; fields: string[]; isUnique: boolean }>;
    idFields: string[];
}

interface PrismaEnum {
    name: string;
    values: string[];
}

function parseSchemaPrismaStrict(schemaText: string) {
    const models = new Map<string, PrismaModel>();
    const enums = new Map<string, PrismaEnum>();

    const lines = schemaText.split("\n");
    let currentModel: PrismaModel | null = null;
    let currentEnum: PrismaEnum | null = null;

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const lineWithoutComment = rawLine.replace(/\/\/.*$/, "").trim();
        if (!lineWithoutComment) continue;

        // Model block start: MUST be outside any block
        if (!currentModel && !currentEnum && /^model\s+[A-Za-z0-9_]+\s*\{/.test(lineWithoutComment)) {
            const match = lineWithoutComment.match(/^model\s+([A-Za-z0-9_]+)/);
            if (match) {
                const modelName = match[1];
                currentModel = {
                    name: modelName,
                    dbName: modelName,
                    fields: new Map(),
                    indexes: [],
                    idFields: []
                };
                models.set(modelName, currentModel);
            }
            continue;
        }

        // Enum block start: MUST be outside any block
        if (!currentModel && !currentEnum && /^enum\s+[A-Za-z0-9_]+\s*\{/.test(lineWithoutComment)) {
            const match = lineWithoutComment.match(/^enum\s+([A-Za-z0-9_]+)/);
            if (match) {
                const enumName = match[1];
                currentEnum = {
                    name: enumName,
                    values: []
                };
                enums.set(enumName, currentEnum);
            }
            continue;
        }

        // Block end
        if (lineWithoutComment === "}") {
            currentModel = null;
            currentEnum = null;
            continue;
        }

        // Inside Enum
        if (currentEnum) {
            const val = lineWithoutComment.split(/\s+/)[0];
            if (val && !val.startsWith("@@")) {
                currentEnum.values.push(val);
            }
            continue;
        }

        // Inside Model
        if (currentModel) {
            if (lineWithoutComment.startsWith("@@map(")) {
                const match = lineWithoutComment.match(/@@map\("([^"]+)"\)/);
                if (match) currentModel.dbName = match[1];
                continue;
            }

            if (lineWithoutComment.startsWith("@@id(")) {
                const matchFields = lineWithoutComment.match(/\[([^\]]+)\]/);
                if (matchFields) {
                    currentModel.idFields = matchFields[1].split(",").map(f => f.trim());
                }
                continue;
            }

            if (lineWithoutComment.startsWith("@@index") || lineWithoutComment.startsWith("@@unique")) {
                const isUnique = lineWithoutComment.startsWith("@@unique");
                const matchFields = lineWithoutComment.match(/\[([^\]]+)\]/);
                const matchName = lineWithoutComment.match(/map:\s*"([^"]+)"/) || lineWithoutComment.match(/name:\s*"([^"]+)"/);
                if (matchFields) {
                    const fields = matchFields[1].split(",").map(f => f.trim());
                    currentModel.indexes.push({
                        name: matchName ? matchName[1] : undefined,
                        fields,
                        isUnique
                    });
                }
                continue;
            }

            if (lineWithoutComment.startsWith("@@")) continue;

            // Field line parsing
            const parts = lineWithoutComment.split(/\s+/);
            if (parts.length < 2) continue;

            const fieldName = parts[0];
            let rawType = parts[1];

            const isOptional = rawType.endsWith("?");
            const isList = rawType.endsWith("[]");
            const cleanType = rawType.replace(/[\?\[\]]/g, "");

            const isUnsupported = lineWithoutComment.includes("Unsupported(");

            const primitives = new Set([
                "String", "Boolean", "Int", "Float", "Decimal", "DateTime", "Json", "Bytes", "BigInt"
            ]);
            const isEnum = enums.has(cleanType);
            const isRelation = !primitives.has(cleanType) && !isEnum && !isUnsupported;

            if (isRelation) {
                continue;
            }

            let isId = lineWithoutComment.includes("@id");
            let isUnique = lineWithoutComment.includes("@unique");
            let dbMap: string | undefined;

            const mapMatch = lineWithoutComment.match(/@map\("([^"]+)"\)/);
            if (mapMatch) dbMap = mapMatch[1];

            let defaultVal: string | undefined;
            const defMatch = lineWithoutComment.match(/@default\(([^)]+)\)/);
            if (defMatch) defaultVal = defMatch[1];

            currentModel.fields.set(fieldName, {
                name: fieldName,
                type: cleanType,
                isOptional,
                isList,
                isId,
                isUnique,
                defaultVal,
                dbMap,
                isRelation: false,
                isUnsupported
            });
        }
    }

    return { models, enums };
}

function mapPrismaTypeToPg(prismaType: string, isEnum: boolean): string[] {
    if (isEnum) return [prismaType, "USER-DEFINED", "text"];
    switch (prismaType) {
        case "String": return ["text", "character varying", "varchar"];
        case "Boolean": return ["boolean", "bool"];
        case "Int": return ["integer", "int4"];
        case "Float": return ["double precision", "float8", "real", "float4"];
        case "Decimal": return ["numeric"];
        case "DateTime": return ["timestamp without time zone", "timestamp", "timestamp with time zone", "timestamptz"];
        case "Json": return ["jsonb", "json"];
        case "Bytes": return ["bytea"];
        case "BigInt": return ["bigint", "int8"];
        case "Unsupported(\"vector\")":
        case "Unsupported(\"vector(768)\")":
        case "vector": return ["vector"];
        default: return [prismaType.toLowerCase()];
    }
}

async function main() {
    const schemaPath = path.join(__dirname, "../prisma/schema.prisma");
    const schemaText = fs.readFileSync(schemaPath, "utf-8");
    const { models, enums } = parseSchemaPrismaStrict(schemaText);

    // Physical Tables
    const physicalTables: any[] = await prisma.$queryRawUnsafe(`
        SELECT table_name::text 
        FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name != '_prisma_migrations';
    `);
    const pgTableNames = new Set(physicalTables.map(t => t.table_name));

    // Physical Columns
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

    let totalFieldsChecked = 0;
    let exactMatches = 0;

    const missingColumns: any[] = [];
    const extraColumns: any[] = [];
    const typeMismatches: any[] = [];
    const nullabilityMismatches: any[] = [];
    const missingIndexes: any[] = [];
    const enumMismatches: any[] = [];

    // Audit Enums
    for (const [eName, eDef] of enums.entries()) {
        const pgVals = pgEnumsByName.get(eName);
        if (!pgVals) {
            enumMismatches.push({ enumName: eName, missingValues: eDef.values });
        } else {
            const missingVals = eDef.values.filter(v => !pgVals.includes(v));
            if (missingVals.length > 0) {
                enumMismatches.push({ enumName: eName, missingValues: missingVals });
            }
        }
    }

    // Audit Models
    for (const [mName, model] of models.entries()) {
        const dbTableName = model.dbName;
        const pgCols = pgColsByTable.get(dbTableName);

        if (!pgCols) {
            for (const [fName, field] of model.fields.entries()) {
                totalFieldsChecked++;
                const colName = field.dbMap || fName;
                missingColumns.push({
                    model: mName,
                    table: dbTableName,
                    field: fName,
                    column: colName,
                    type: field.type
                });
            }
            continue;
        }

        for (const [fName, field] of model.fields.entries()) {
            totalFieldsChecked++;
            const colName = field.dbMap || fName;
            const pgCol = pgCols.get(colName);

            if (!pgCol) {
                missingColumns.push({
                    model: mName,
                    table: dbTableName,
                    field: fName,
                    column: colName,
                    type: field.type
                });
                continue;
            }

            let fieldHasMismatch = false;

            const expectedPgTypes = mapPrismaTypeToPg(field.type, enums.has(field.type));
            const actualDataType = pgCol.data_type;
            const actualUdtName = pgCol.udt_name;

            const typeMatch = expectedPgTypes.includes(actualDataType) || expectedPgTypes.includes(actualUdtName);
            if (!typeMatch) {
                fieldHasMismatch = true;
                typeMismatches.push({
                    model: mName,
                    table: dbTableName,
                    column: colName,
                    expectedType: field.type,
                    actualPgDataType: actualDataType,
                    actualUdtName
                });
            }

            const expectedNullable = field.isOptional;
            const actualNullable = pgCol.is_nullable === "YES";
            if (expectedNullable !== actualNullable) {
                fieldHasMismatch = true;
                nullabilityMismatches.push({
                    model: mName,
                    table: dbTableName,
                    column: colName,
                    expectedNullable,
                    actualNullable: pgCol.is_nullable
                });
            }

            if (!fieldHasMismatch) {
                exactMatches++;
            }
        }

        // Extra columns check
        const modelColNames = new Set(Array.from(model.fields.values()).map(f => f.dbMap || f.name));
        for (const [pgColName, pgCol] of pgCols.entries()) {
            if (!modelColNames.has(pgColName)) {
                extraColumns.push({
                    model: mName,
                    table: dbTableName,
                    column: pgColName,
                    type: pgCol.udt_name
                });
            }
        }

        // Index audit
        const pgIndexes = pgIndexesByTable.get(dbTableName) || [];
        for (const idx of model.indexes) {
            const foundInPg = pgIndexes.some(p => {
                const def = p.indexdef.toLowerCase();
                return idx.fields.every(f => def.includes(`"${f.toLowerCase()}"`) || def.includes(f.toLowerCase()));
            });

            if (!foundInPg) {
                missingIndexes.push({
                    model: mName,
                    table: dbTableName,
                    fields: idx.fields,
                    isUnique: idx.isUnique
                });
            }
        }
    }

    console.log("=== STRICT PARSER AUDIT METRICS ===");
    console.log("Prisma Models Parsed:", models.size);
    console.log("PostgreSQL Tables:", pgTableNames.size);
    console.log("Total Fields Checked:", totalFieldsChecked);
    console.log("Exact Field Matches:", exactMatches);
    console.log("Missing Columns Count:", missingColumns.length);
    console.log("Extra Columns Count:", extraColumns.length);
    console.log("Type Mismatches Count:", typeMismatches.length);
    console.log("Nullability Mismatches Count:", nullabilityMismatches.length);
    console.log("Missing Indexes Count:", missingIndexes.length);
    console.log("Enum Mismatches Count:", enumMismatches.length);

    console.log("\n--- ITEMIZED MISSING COLUMNS ---");
    console.log(JSON.stringify(missingColumns, null, 2));

    console.log("\n--- ITEMIZED EXTRA COLUMNS ---");
    console.log(JSON.stringify(extraColumns, null, 2));

    console.log("\n--- ITEMIZED MISSING INDEXES ---");
    console.log(JSON.stringify(missingIndexes, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
