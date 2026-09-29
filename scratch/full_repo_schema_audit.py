import asyncpg
import json
import os
import re
import asyncio

async def get_db_columns():
    env_file = ".env"
    db_url = None
    if os.path.exists(env_file):
        with open(env_file, "r") as f:
            for line in f:
                if line.startswith("DATABASE_URL="):
                    db_url = line.strip().split("=", 1)[1].strip('"').strip("'")
                    break

    if not db_url:
        print("DATABASE_URL not found in .env")
        return {}

    # Extract clean postgres url if there are parameters or wrappers
    clean_url = db_url.split("?")[0]
    conn = await asyncpg.connect(clean_url)

    rows = await conn.fetch("""
        SELECT table_name, column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
        ORDER BY table_name, column_name;
    """)

    await conn.close()

    table_columns = {}
    for r in rows:
        tbl = r["table_name"]
        col = r["column_name"]
        if tbl not in table_columns:
            table_columns[tbl] = set()
        table_columns[tbl].add(col)

    return table_columns

def parse_prisma_schema(schema_path):
    with open(schema_path, "r") as f:
        content = f.read()

    models = {}
    current_model = None

    lines = content.splitlines()
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("model "):
            parts = stripped.split()
            current_model = parts[1]
            models[current_model] = {
                "table_name": current_model,
                "fields": {}
            }
        elif current_model and stripped.startswith("@@map"):
            m = re.search(r'@@map\("([^"]+)"\)', stripped)
            if m:
                models[current_model]["table_name"] = m.group(1)
        elif current_model and stripped.startswith("}"):
            current_model = None
        elif current_model and stripped and not stripped.startswith("//") and not stripped.startswith("@@"):
            parts = stripped.split()
            if len(parts) >= 2:
                field_name = parts[0]
                field_type = parts[1]

                col_name = field_name
                map_match = re.search(r'@map\("([^"]+)"\)', stripped)
                if map_match:
                    col_name = map_match.group(1)

                is_relation = False
                base_type = field_type.rstrip("?").rstrip("[]")

                # If field has @relation or is a model reference
                if "@relation" in stripped or (base_type not in ["String", "Int", "Float", "Boolean", "DateTime", "Json", "Bytes", "Decimal", "BigInt", "Unsupported"] and not base_type.endswith("Enum") and not (base_type in ["Role", "UserRole", "PipelineStage", "SignalType", "Channel", "StepTrigger", "StepExecutionStatus", "LinkedInStatus", "ApprovalStatus", "DeliveryState", "ReplyIntent", "DomainHealth", "DeliverabilityEventType", "DeliverabilityEventSeverity", "MailProviderType", "QueueJobStatus", "LearningEventType", "LearningOutcome", "DiscoverySourceType", "DiscoveryRunStatus"])):
                    is_relation = True

                if not is_relation:
                    models[current_model]["fields"][field_name] = {
                        "field_type": field_type,
                        "col_name": col_name,
                        "raw_line": stripped
                    }

    return models

async def main():
    schema_path = "prisma/schema.prisma"
    prisma_models = parse_prisma_schema(schema_path)
    db_tables = await get_db_columns()

    print(f"Parsed {len(prisma_models)} Prisma models.")
    print(f"Fetched {len(db_tables)} physical PostgreSQL tables.")

    total_scalar_fields = 0
    verified_fields = 0
    mismatches = []

    for model_name, model_info in prisma_models.items():
        tbl_name = model_info["table_name"]
        db_cols = db_tables.get(tbl_name, set())

        for field_name, field_info in model_info["fields"].items():
            total_scalar_fields += 1
            col_name = field_info["col_name"]

            if col_name in db_cols:
                verified_fields += 1
            else:
                mismatches.append({
                    "model": model_name,
                    "table": tbl_name,
                    "field": field_name,
                    "col": col_name,
                    "type": field_info["field_type"],
                    "reason": "Prisma schema field exists but physical DB column is missing (Category B)"
                })

    print(f"\n--- AUDIT SUMMARY ---")
    print(f"Total Prisma scalar fields audited: {total_scalar_fields}")
    print(f"Physically verified in PostgreSQL: {verified_fields}")
    print(f"Category B Mismatches (Prisma declared, DB missing): {len(mismatches)}")

    for m in mismatches:
        print(f"  - Model: {m['model']} | Field: {m['field']} | Table: {m['table']} | Type: {m['type']}")

    with open("scratch/mismatches.json", "w") as f:
        json.dump(mismatches, f, indent=2)

if __name__ == "__main__":
    asyncio.run(main())
