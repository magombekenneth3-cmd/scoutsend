import fs from "fs";
import path from "path";

const categoryB = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "scratch/category_b_mismatches.json"), "utf8")
);

function inspectModelField(modelName: string, fieldName: string) {
  const matches: Array<{ file: string; line: number; text: string }> = [];
  const srcDir = path.join(process.cwd(), "app/api/src");

  // Format regex patterns for model usage: e.g. prisma.lead, prisma.outreachMessage, Lead.field, etc.
  const lowerModel = modelName.charAt(0).toLowerCase() + modelName.slice(1);
  const patterns = [
    `prisma.${lowerModel}.`,
    `tx.${lowerModel}.`,
    `client.${lowerModel}.`,
  ];

  function walk(dir: string) {
    const files = fs.readdirSync(dir);
    for (const f of files) {
      const full = path.join(dir, f);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (full.endsWith(".ts") || full.endsWith(".js") || full.endsWith(".tsx")) {
        const content = fs.readFileSync(full, "utf8");
        const lines = content.split("\n");
        lines.forEach((line, idx) => {
          if (line.includes(fieldName)) {
            // check if file mentions the model
            if (content.includes(lowerModel) || content.includes(modelName)) {
              matches.push({
                file: path.relative(process.cwd(), full),
                line: idx + 1,
                text: line.trim(),
              });
            }
          }
        });
      }
    }
  }

  walk(srcDir);
  return matches;
}

const detailedAudit = categoryB.map((item: any) => {
  const references = inspectModelField(item.model, item.field);
  return {
    ...item,
    directModelReferences: references,
  };
});

fs.writeFileSync(
  path.join(process.cwd(), "scratch/detailed_model_field_audit.json"),
  JSON.stringify(detailedAudit, null, 2)
);

console.log("=== COMPLETED DIRECT MODEL-FIELD RUNTIME AUDIT ===");
for (const d of detailedAudit) {
  console.log(`\nModel: ${d.model} | Field: ${d.field} | Column: ${d.col}`);
  console.log(`Matching Code References: ${d.directModelReferences.length}`);
  for (const r of d.directModelReferences.slice(0, 5)) {
    console.log(`  -> ${r.file}:${r.line}: ${r.text}`);
  }
}
