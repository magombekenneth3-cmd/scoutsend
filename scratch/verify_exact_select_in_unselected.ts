import fs from "fs";
import path from "path";
import ts from "typescript";

interface CallInfo {
  file: string;
  line: number;
  model: string;
  op: string;
  hasSelect: boolean;
  selectedFields: string[];
}

const targetModels = new Set(["SenderMailbox", "Reply", "Lead", "OutreachMessage", "BrandSettings", "Company"]);

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

function analyzeAST() {
  const srcDir = path.join(process.cwd(), "app/api/src");
  const files = walk(srcDir);
  const calls: CallInfo[] = [];

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

              if (targetModels.has(capitalizedModel)) {
                const line = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
                
                // Inspect arguments passed to call
                let hasSelect = false;
                const selectedFields: string[] = [];

                if (node.arguments.length > 0) {
                  const arg0 = node.arguments[0];
                  if (ts.isObjectLiteralExpression(arg0)) {
                    for (const prop of arg0.properties) {
                      if (ts.isPropertyAssignment(prop) && prop.name.getText(sourceFile) === "select") {
                        hasSelect = true;
                        if (ts.isObjectLiteralExpression(prop.initializer)) {
                          for (const sProp of prop.initializer.properties) {
                            selectedFields.push(sProp.name ? sProp.name.getText(sourceFile) : "");
                          }
                        }
                      }
                    }
                  }
                }

                calls.push({
                  file: relPath,
                  line,
                  model: capitalizedModel,
                  op,
                  hasSelect,
                  selectedFields,
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

  fs.writeFileSync("scratch/ast_queries_audit.json", JSON.stringify(calls, null, 2));

  console.log("=== EXACT AST ANALYSIS OF PRISMA CALL SITES ===");
  console.log(`Total Prisma data calls analyzed: ${calls.length}`);

  const missingSelect = calls.filter((c) => !c.hasSelect);
  console.log(`Prisma data calls WITHOUT explicit select parameter: ${missingSelect.length}`);

  const byModel: Record<string, number> = {};
  for (const m of missingSelect) {
    byModel[m.model] = (byModel[m.model] || 0) + 1;
  }
  console.log("Missing select calls by model:", byModel);
}

analyzeAST();
