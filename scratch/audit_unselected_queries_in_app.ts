import fs from "fs";
import path from "path";

interface CallSite {
  file: string;
  line: number;
  model: string;
  op: string;
  hasExplicitSelect: boolean;
  queriesMissingColumn: boolean;
  classification: "REACHABLE_NOW" | "WORKER_REACHABLE" | "TEST_ONLY" | "DEAD_CODE" | "UNREACHABLE" | "SAFE_BY_EXPLICIT_SELECT";
  snippet: string;
}

function walk(dir: string, fileList: string[] = []) {
  const files = fs.readdirSync(dir);
  for (const f of files) {
    const full = path.join(dir, f);
    if (fs.statSync(full).isDirectory()) {
      walk(full, fileList);
    } else if (full.endsWith(".ts") || full.endsWith(".js")) {
      fileList.push(full);
    }
  }
  return fileList;
}

const targetModels = ["SenderMailbox", "Reply", "Lead", "OutreachMessage", "BrandSettings", "Company"];

const categoryBByModel: Record<string, string[]> = {
  OutreachMessage: ["senderMailboxId", "regenerationNeeded", "regenerationReason"],
  Reply: ["snoozedUntil", "isRead"],
  SenderMailbox: ["spfValid", "dkimValid", "dmarcValid", "dkimSelector", "dnsCheckedAt"],
  Lead: ["sequenceInitError", "researchCard", "researchCardGeneratedAt"],
  BrandSettings: ["provenStats"],
  Company: ["version"],
};

function analyzeCallSites() {
  const srcDir = path.join(process.cwd(), "app/api/src");
  const files = walk(srcDir);
  const results: CallSite[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");
    const relPath = path.relative(process.cwd(), file);

    for (const model of targetModels) {
      const lowerModel = model.charAt(0).toLowerCase() + model.slice(1);
      const pattern = new RegExp(`(?:prisma|tx|client)\\.${lowerModel}\\.(${["findMany", "findFirst", "findUnique", "findUniqueOrThrow", "create", "update", "delete", "upsert"].join("|")})\\(`, "g");

      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const op = match[1];
        const matchIdx = match.index;
        const lineNumber = content.substring(0, matchIdx).split("\n").length;

        // Slice next 25 lines to inspect parameters
        const startLine = lineNumber - 1;
        const endLine = Math.min(lines.length, startLine + 25);
        const callBlock = lines.slice(startLine, endLine).join("\n");

        const hasExplicitSelect = callBlock.includes("select:");
        const isTestFile = relPath.includes(".test.ts") || relPath.includes(".spec.ts");
        const isWorkerFile = relPath.includes(".worker.ts") || relPath.includes("worker") || relPath.includes("queue");

        let classification: CallSite["classification"];

        if (hasExplicitSelect) {
          classification = "SAFE_BY_EXPLICIT_SELECT";
        } else if (isTestFile) {
          classification = "TEST_ONLY";
        } else if (isWorkerFile) {
          classification = "WORKER_REACHABLE";
        } else {
          classification = "REACHABLE_NOW";
        }

        results.push({
          file: relPath,
          line: lineNumber,
          model,
          op,
          hasExplicitSelect,
          queriesMissingColumn: !hasExplicitSelect,
          classification,
          snippet: lines[lineNumber - 1].trim(),
        });
      }
    }
  }

  fs.writeFileSync("scratch/call_sites_reachability.json", JSON.stringify(results, null, 2));

  console.log("=== EXHAUSTIVE REACHABILITY CLASSIFICATION RESULTS ===");
  console.log(`Total Query Operations Audited: ${results.length}`);
  console.log(`SAFE_BY_EXPLICIT_SELECT: ${results.filter((r) => r.classification === "SAFE_BY_EXPLICIT_SELECT").length}`);
  console.log(`TEST_ONLY: ${results.filter((r) => r.classification === "TEST_ONLY").length}`);
  console.log(`WORKER_REACHABLE (Missing explicit select): ${results.filter((r) => r.classification === "WORKER_REACHABLE").length}`);
  console.log(`REACHABLE_NOW (Missing explicit select in API/Services): ${results.filter((r) => r.classification === "REACHABLE_NOW").length}`);

  console.log("\n--- REACHABLE_NOW (API/Services missing explicit select on Category B models) ---");
  for (const r of results.filter((r) => r.classification === "REACHABLE_NOW")) {
    console.log(`  - [${r.model}.${r.op}] ${r.file}:${r.line} -> ${r.snippet}`);
  }

  console.log("\n--- WORKER_REACHABLE (Workers missing explicit select on Category B models) ---");
  for (const r of results.filter((r) => r.classification === "WORKER_REACHABLE")) {
    console.log(`  - [${r.model}.${r.op}] ${r.file}:${r.line} -> ${r.snippet}`);
  }
}

analyzeCallSites();
