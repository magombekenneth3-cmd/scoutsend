import fs from "fs";
import path from "path";

interface QueryOccurrence {
  file: string;
  line: number;
  snippet: string;
  model: string;
  operation: string;
  hasExplicitSelect: boolean;
  queriesMissingField: boolean;
  missingFieldsInvolved: string[];
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

async function auditWorkingTreeQueries() {
  const srcDir = path.join(process.cwd(), "app/api/src");
  const files = walk(srcDir);

  const categoryBByModel: Record<string, string[]> = {
    OutreachMessage: ["senderMailboxId", "regenerationNeeded", "regenerationReason"],
    Reply: ["snoozedUntil", "isRead"],
    SenderMailbox: ["spfValid", "dkimValid", "dmarcValid", "dkimSelector", "dnsCheckedAt"],
    Lead: ["sequenceInitError", "researchCard", "researchCardGeneratedAt"],
    BrandSettings: ["provenStats"],
    Company: ["version"],
    Operation: ["leaseVersion"],
    SendIntent: [
      "traceId",
      "provider",
      "payloadHash",
      "lastAttemptAt",
      "claimedBy",
      "fencingEpoch",
      "leaseVersion",
      "leaseExpiresAt",
      "reconciliationAttempts",
      "version",
    ],
    QuotaReservation: ["operationId", "scopeId", "windowStart", "version"],
    CampaignRun: ["fencingEpoch", "version", "logicalVersion"],
    CampaignRunLease: ["workerId", "fencingEpoch", "leaseVersion", "leaseExpiresAt"],
  };

  const findings: QueryOccurrence[] = [];

  for (const file of files) {
    const content = fs.readFileSync(file, "utf8");
    const lines = content.split("\n");

    for (const [model, missingFields] of Object.entries(categoryBByModel)) {
      const lowerModel = model.charAt(0).toLowerCase() + model.slice(1);
      const pattern = new RegExp(`(?:prisma|tx|client)\\.${lowerModel}\\.(${["findMany", "findFirst", "findUnique", "findUniqueOrThrow", "create", "update", "delete", "upsert", "count"].join("|")})`, "g");

      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const op = match[1];
        const matchIdx = match.index;
        const lineNumber = content.substring(0, matchIdx).split("\n").length;
        
        // Extract context block (~20 lines around match)
        const startLine = Math.max(0, lineNumber - 2);
        const endLine = Math.min(lines.length, lineNumber + 15);
        const block = lines.slice(startLine, endLine).join("\n");

        const hasExplicitSelect = block.includes("select:");
        const hasInclude = block.includes("include:");

        let queriesMissingField = false;
        const missingFieldsInvolved: string[] = [];

        if (hasExplicitSelect) {
          for (const mf of missingFields) {
            if (block.includes(`${mf}: true`)) {
              queriesMissingField = true;
              missingFieldsInvolved.push(mf);
            }
          }
        } else {
          // Without explicit select, operations like findMany, findFirst, findUnique, findUniqueOrThrow, create, update implicitly SELECT ALL SCALARS!
          if (["findMany", "findFirst", "findUnique", "findUniqueOrThrow", "create", "update"].includes(op)) {
            queriesMissingField = true;
            missingFieldsInvolved.push(...missingFields);
          }
        }

        findings.push({
          file: path.relative(process.cwd(), file),
          line: lineNumber,
          snippet: lines[lineNumber - 1].trim(),
          model,
          operation: op,
          hasExplicitSelect,
          queriesMissingField,
          missingFieldsInvolved,
        });
      }
    }
  }

  fs.writeFileSync("scratch/working_tree_query_audit.json", JSON.stringify(findings, null, 2));

  console.log("=== WORKING TREE PRISMA QUERY AUDIT RESULTS ===");
  console.log(`Total Prisma queries found against models with missing physical columns: ${findings.length}`);
  const implicitQueries = findings.filter((f) => !f.hasExplicitSelect && f.queriesMissingField);
  console.log(`Queries missing explicit select (implicit scalar select): ${implicitQueries.length}`);

  for (const iq of implicitQueries) {
    console.log(` - [${iq.model}.${iq.operation}] at ${iq.file}:${iq.line} -> Fields: ${iq.missingFieldsInvolved.join(", ")}`);
  }
}

auditWorkingTreeQueries();
