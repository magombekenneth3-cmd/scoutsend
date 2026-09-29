import { prisma } from "../app/api/src/lib/prisma";

async function inspectColumns() {
  const columns: Array<{ column_name: string; data_type: string }> = await prisma.$queryRaw`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_name = 'Reply'
    ORDER BY column_name;
  `;
  console.log("=== Physical PostgreSQL columns for table 'Reply' ===");
  console.log(columns.map(c => c.column_name).join("\n"));
}

inspectColumns().finally(() => prisma.$disconnect());
