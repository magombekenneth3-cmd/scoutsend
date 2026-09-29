import fs from "fs";
import path from "path";
import ts from "typescript";

interface CallClassification {
  file: string;
  line: number;
  model: string;
  op: string;
  bucket:
    | "1. Reachable HTTP/API"
    | "2. Reachable background worker"
    | "3. Reachable scheduled job"
    | "4. Indirectly reachable service"
    | "5. Test-only"
    | "6. Dead/dormant"
    | "7. Type-only"
    | "8. Comment/string";
  implicitlySelectsMissingFields: boolean;
  missingFields: string[];
  callerNeedsField: boolean;
  snippet: string;
}

const targetModels: Record<string, string[]> = {
  Lead: ["sequenceInitError", "researchCard", "researchCardGeneratedAt"],
  SenderMailbox: ["spfValid", "dkimValid", "dmarcValid", "dkimSelector", "dnsCheckedAt"],
};

function walk(dir: string, fileList: string[] = []) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      walk(full, fileList);
    } else if (full.endsWith(".ts") || full.endsWith(".tsx")) {
      fileList.push(full);
    }
  }
  return fileList;
}

function analyzeLeadAndSenderMailboxQueries() {
  const srcDir = path.join(process.cwd(), "app/api/src");
  const files = walk(srcDir);
  const classifications: CallClassification[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const relPath = path.relative(process.cwd(), file);
    const sourceFile = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);

    function visit(node: ts.Node) {
      if (ts.isCallExpression(node)) {
        const expr = node.expression;
        if (ts.isPropertyAccessExpression(expr)) {
          const op = expr.name.text;
          if (["findMany", "findFirst", "findUnique", "findUniqueOrThrow", "create", "update", "delete", "upsert"].includes(op)) {
            const modelObj = expr.expression;
            if (ts.isPropertyAccessExpression(modelObj)) {
              const modelPropName = modelObj.name.text;
              const capitalizedModel = modelPropName.charAt(0).toUpperCase() + modelPropName.slice(1);

              if (targetModels[capitalizedModel]) {
                const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
                const lines = content.split("\n");
                const snippet = lines[line - 1] ? lines[line - 1].trim() : "";

                // Determine if explicit select is passed
                let hasSelect = false;
                if (node.arguments.length > 0) {
                  const arg0 = node.arguments[0];
                  if (ts.isObjectLiteralExpression(arg0)) {
                    for (const prop of arg0.properties) {
                      if (ts.isPropertyAssignment(prop) && prop.name.getText(sourceFile) === "select") {
                        hasSelect = true;
                      }
                    }
                  }
                }

                const implicitlySelectsMissingFields = !hasSelect;
                const missingFields = targetModels[capitalizedModel];

                // Determine bucket
                let bucket: CallClassification["bucket"];
                if (relPath.includes(".test.ts") || relPath.includes(".spec.ts")) {
                  bucket = "5. Test-only";
                } else if (relPath.includes(".worker.ts") || relPath.includes("/workers/")) {
                  bucket = "2. Reachable background worker";
                } else if (relPath.includes("cron") || relPath.includes("sweeper") || relPath.includes("poller")) {
                  bucket = "3. Reachable scheduled job";
                } else if (relPath.includes(".routes.ts") || relPath.includes(".controller.ts")) {
                  bucket = "1. Reachable HTTP/API";
                } else if (relPath.includes(".service.ts")) {
                  bucket = "4. Indirectly reachable service";
                } else {
                  bucket = "6. Dead/dormant";
                }

                classifications.push({
                  file: relPath,
                  line,
                  model: capitalizedModel,
                  op,
                  bucket,
                  implicitlySelectsMissingFields,
                  missingFields,
                  callerNeedsField: false,
                  snippet,
                });
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    }

    visit(sourceFile);
  }

  fs.writeFileSync("scratch/lead_sender_mailbox_classification.json", JSON.stringify(classifications, null, 2));

  console.log("=== CLASSIFICATION OF LEAD AND SENDERMAILBOX PRISMA QUERIES ===");
  console.log(`Total query calls on Lead & SenderMailbox: ${classifications.length}`);

  const unselected = classifications.filter((c) => c.implicitlySelectsMissingFields);
  console.log(`Query calls lacking explicit select (implicit SELECT * / P2022 risk): ${unselected.length}`);

  const byBucket: Record<string, number> = {};
  for (const u of unselected) {
    byBucket[u.bucket] = (byBucket[u.bucket] || 0) + 1;
  }
  console.log("\nUnselected queries by reachability bucket:", byBucket);

  console.log("\n--- BUCKET 1: Reachable HTTP/API (Missing Select) ---");
  for (const u of unselected.filter((c) => c.bucket === "1. Reachable HTTP/API")) {
    console.log(`  [${u.model}.${u.op}] ${u.file}:${u.line} -> ${u.snippet}`);
  }

  console.log("\n--- BUCKET 2: Reachable Background Worker (Missing Select) ---");
  for (const u of unselected.filter((c) => c.bucket === "2. Reachable background worker")) {
    console.log(`  [${u.model}.${u.op}] ${u.file}:${u.line} -> ${u.snippet}`);
  }

  console.log("\n--- BUCKET 3: Reachable Scheduled Job / Poller (Missing Select) ---");
  for (const u of unselected.filter((c) => c.bucket === "3. Reachable scheduled job")) {
    console.log(`  [${u.model}.${u.op}] ${u.file}:${u.line} -> ${u.snippet}`);
  }

  console.log("\n--- BUCKET 4: Indirectly Reachable Service (Missing Select) ---");
  for (const u of unselected.filter((c) => c.bucket === "4. Indirectly reachable service")) {
    console.log(`  [${u.model}.${u.op}] ${u.file}:${u.line} -> ${u.snippet}`);
  }
}

analyzeLeadAndSenderMailboxQueries();
