import fs from "fs";
import path from "path";

interface QueryCall {
  file: string;
  line: number;
  model: string;
  op: string;
  hasSelect: boolean;
  hasSelectOnlyScalar: boolean;
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

const targetModels = [
  "OutreachMessage",
  "Lead",
  "Reply",
  "SenderMailbox",
  "BrandSettings",
  "Company",
];

const categoryBFields: Record<string, string[]> = {
  OutreachMessage: ["senderMailboxId", "regenerationNeeded", "regenerationReason"],
  Lead: ["sequenceInitError", "researchCard", "researchCardGeneratedAt"],
  Reply: ["snoozedUntil", "isRead"],
  SenderMailbox: ["spfValid", "dkimValid", "dmarcValid", "dkimSelector", "dnsCheckedAt"],
  BrandSettings: ["provenStats"],
  Company: ["version"],
};

const calls: QueryCall[] = [];

const srcDir = path.join(process.cwd(), "app/api/src");
const files = walk(srcDir);

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split("\n");

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

      // Check if select clause is present
      const hasSelect = callBlock.includes("select:");

      calls.push({
        file: path.relative(process.cwd(), file),
        line: lineNumber,
        model,
        op,
        hasSelect,
        hasSelectOnlyScalar: false,
        snippet: lines[lineNumber - 1].trim(),
      });
    }
  }
}

console.log("=== COMPREHENSIVE QUERY CALL AUDIT FOR CATEGORY B MODELS ===");
console.log(`Total Prisma data operations found: ${calls.length}`);

const unselectedOps = calls.filter((c) => !c.hasSelect);
console.log(`Total operations WITHOUT explicit select clause: ${unselectedOps.length}`);

for (const u of unselectedOps) {
  console.log(` - [${u.model}.${u.op}] at ${u.file}:${u.line} -> ${u.snippet}`);
}

fs.writeFileSync("scratch/unselected_operations_audit.json", JSON.stringify(unselectedOps, null, 2));
