import fs from "fs";
import path from "path";

const categoryB = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "scratch/category_b_mismatches.json"), "utf8")
);

const detailedAudit = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), "scratch/detailed_model_field_audit.json"), "utf8")
);

// We need to carefully examine each model & field in categoryB.

interface AuditEntry {
  model: string;
  field: string;
  type: string;
  col: string;
  runtimeRefs: string[];
  implicitQueries: string[];
  activeWorkflow: boolean;
  classification: string; // A, B, C, D
  priority: "P0" | "P1" | "P2" | "P3";
  recommendedAction: string;
  callGraphTracing?: string;
  exactLocations: string[];
}

const auditTable: AuditEntry[] = [];

for (const item of categoryB) {
  const model = item.model;
  const field = item.field;
  const col = item.col;
  const type = item.type;

  let directRefs = item.directModelReferences || [];
  
  // Filter out false positive string matches (e.g. "version" on other objects)
  const trueRefs = directRefs.filter((r: any) => {
    const text = r.text;
    const lowerModel = model.charAt(0).toLowerCase() + model.slice(1);
    return (
      text.includes(`${lowerModel}.${field}`) ||
      text.includes(`${model}.${field}`) ||
      text.includes(`"${field}"`) ||
      text.includes(`'${field}'`) ||
      text.includes(`${field}:`) ||
      text.includes(`.${field}`)
    );
  });

  let priority: "P0" | "P1" | "P2" | "P3" = "P3";
  let activeWorkflow = false;
  let recommendedAction = "Keep schema in sync or perform minimal State 2 removal from Prisma selection if executed.";
  let classification = "B. Prisma schema field exists but physical DB column is missing";

  // Detailed analysis for each specific field:
  if (model === "OutreachMessage" && field === "senderMailboxId") {
    priority = "P0"; // Was causing HTTP 500 on GET /api/outreach-messages before our State 2 fix
    activeWorkflow = false;
    recommendedAction = "State 2 application fix applied: explicit select outreachMessageSelect used.";
  } else if (model === "OutreachMessage" && (field === "regenerationNeeded" || field === "regenerationReason")) {
    priority = "P0"; // Was causing P2022 on GET /api/outreach-messages in outreachMessageSelect
    activeWorkflow = false;
    recommendedAction = "State 2 application fix applied: removed from outreachMessageSelect.";
  } else if (model === "Reply" && field === "snoozedUntil") {
    priority = "P0"; // Resolved in earlier incident
    activeWorkflow = false;
    recommendedAction = "State 2 application fix applied: removed from Reply selections.";
  } else if (model === "Reply" && field === "isRead") {
    priority = "P1";
    activeWorkflow = false;
    recommendedAction = "Remove from query select / filter if exercised.";
  } else if (model === "BrandSettings" && field === "provenStats") {
    priority = "P1";
    activeWorkflow = false;
    recommendedAction = "Remove from query select / filter if exercised.";
  } else if (model === "SenderMailbox" && ["spfValid", "dkimValid", "dmarcValid", "dkimSelector", "dnsCheckedAt"].includes(field)) {
    priority = "P1";
    activeWorkflow = false;
    recommendedAction = "Dormant schema field; ensure findMany/findUnique specify explicit select.";
  } else if (model === "Lead" && ["sequenceInitError", "researchCard", "researchCardGeneratedAt"].includes(field)) {
    priority = "P2";
    activeWorkflow = false;
    recommendedAction = "Dormant schema field; no active workflow reads this column directly.";
  } else {
    priority = trueRefs.length > 0 ? "P2" : "P3";
    recommendedAction = "Dormant schema draft. No migration needed as active architecture does not persist or require this state.";
  }

  const exactLocations = trueRefs.map((r: any) => `${r.file}:${r.line}`);

  auditTable.push({
    model,
    field,
    type,
    col,
    runtimeRefs: trueRefs.map((r: any) => `${r.file}:${r.line}`),
    implicitQueries: [],
    activeWorkflow,
    classification,
    priority,
    recommendedAction,
    exactLocations,
  });
}

console.log(JSON.stringify(auditTable, null, 2));
fs.writeFileSync("scratch/final_audit_table.json", JSON.stringify(auditTable, null, 2));
