import fs from "fs";
import path from "path";

const categoryB = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "scratch/category_b_mismatches.json"), "utf8")
);

function searchCodebase(fieldName: string, modelName: string): Array<{ file: string; line: number; text: string }> {
  const matches: Array<{ file: string; line: number; text: string }> = [];
  const srcDir = path.join(process.cwd(), "app/api/src");

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
            matches.push({
              file: path.relative(process.cwd(), full),
              line: idx + 1,
              text: line.trim(),
            });
          }
        });
      }
    }
  }

  walk(srcDir);
  return matches;
}

const auditResults = categoryB.map((item: any) => {
  const refs = searchCodebase(item.field, item.model);
  return {
    ...item,
    refCount: refs.length,
    refs,
  };
});

console.log("=== CODEBASE RUNTIME REFERENCE AUDIT FOR CATEGORY B FIELDS ===");
for (const item of auditResults) {
  console.log(`\nModel: ${item.model} | Field: ${item.field} | Column: ${item.col} | Type: ${item.type}`);
  console.log(`Executable Code References Found in app/api/src: ${item.refCount}`);
  for (const r of item.refs.slice(0, 10)) {
    console.log(`   - ${r.file}:${r.line} -> ${r.text}`);
  }
}

fs.writeFileSync(
  path.join(process.cwd(), "scratch/category_b_code_audit.json"),
  JSON.stringify(auditResults, null, 2)
);
