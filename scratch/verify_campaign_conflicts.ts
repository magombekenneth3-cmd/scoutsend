import { prisma } from "../app/api/src/lib/prisma";

async function main() {
    console.log("=== CHECKING FOR CONFLICTING COLUMNS IN PostgreSQL 'Campaign' ===");
    const targetFields = ["businessdescription", "valueproposition", "provenstats", "inboundenabled", "requireverifiedemailforgeneration"];
    
    const cols: any[] = await prisma.$queryRawUnsafe(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'Campaign' 
        AND lower(column_name) IN ('businessdescription', 'valueproposition', 'provenstats', 'inboundenabled', 'requireverifiedemailforgeneration');
    `);
    console.log("Matching columns in PostgreSQL:", cols);

    console.log("\n=== CHECKING FOR CONFLICTING INDEXES ON 'Campaign' ===");
    const indexes: any[] = await prisma.$queryRawUnsafe(`
        SELECT indexname, indexdef 
        FROM pg_indexes 
        WHERE tablename = 'Campaign' 
        AND (
            lower(indexdef) LIKE '%businessdescription%'
            OR lower(indexdef) LIKE '%valueproposition%'
            OR lower(indexdef) LIKE '%provenstats%'
            OR lower(indexdef) LIKE '%inboundenabled%'
            OR lower(indexdef) LIKE '%requireverifiedemail%'
        );
    `);
    console.log("Matching indexes in PostgreSQL:", indexes);

    console.log("\n=== CHECKING FOR CONFLICTING CONSTRAINTS ON 'Campaign' ===");
    const constraints: any[] = await prisma.$queryRawUnsafe(`
        SELECT conname, pg_get_constraintdef(oid) 
        FROM pg_constraint 
        WHERE conrelid = '"Campaign"'::regclass;
    `);
    console.log("All constraints on Campaign:", constraints);
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
