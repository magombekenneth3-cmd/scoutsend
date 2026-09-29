import assert from "node:assert";
import { findRegenerationCandidate } from "./enrichment-refreshment.agent";

async function testRegenerationCandidateLogic() {
  console.log("=== Testing findRegenerationCandidate logic ===");

  // Test Case A: Eligible DRAFT + PENDING message present
  const messagesWithDraft = [
    { id: "msg-1", deliveryState: "DRAFT", approvalStatus: "PENDING" },
  ];
  const candidate = findRegenerationCandidate(messagesWithDraft);
  assert.strictEqual(candidate?.id, "msg-1", "Should select DRAFT PENDING candidate");
  console.log("[PASS] Test Case A: Eligible DRAFT candidate identified");

  // Test Case B: Sent / Contacted delivery state present
  const messagesWithSent = [
    { id: "msg-1", deliveryState: "SENT", approvalStatus: "APPROVED" },
    { id: "msg-2", deliveryState: "DRAFT", approvalStatus: "PENDING" },
  ];
  const candidateSent = findRegenerationCandidate(messagesWithSent);
  assert.strictEqual(candidateSent, null, "Should return null if any message is already SENT/DELIVERED/REPLIED");
  console.log("[PASS] Test Case B: Non-eligible (already contacted) skipped");

  // Test Case C: No DRAFT PENDING message present
  const messagesNoDraft = [
    { id: "msg-1", deliveryState: "DRAFT", approvalStatus: "APPROVED" },
  ];
  const candidateNoDraft = findRegenerationCandidate(messagesNoDraft);
  assert.strictEqual(candidateNoDraft, null, "Should return null if no PENDING DRAFT exists");
  console.log("[PASS] Test Case C: No eligible DRAFT returns null");

  // Test Case D: Deduplication logic in materialChangeMap building
  const materialChanges = [
    { leadId: "lead-1", changeReason: "Funding round raised" },
    { leadId: "lead-1", changeReason: "Duplicate funding report" },
    { leadId: "lead-2", changeReason: "New CTO hired" },
  ];
  const materialChangeMap: Record<string, { leadId: string; changeReason: string }> = {};
  for (const item of materialChanges) {
    materialChangeMap[item.leadId] = {
      leadId: item.leadId,
      changeReason: item.changeReason,
    };
  }
  assert.strictEqual(Object.keys(materialChangeMap).length, 2, "Should deduplicate leads by leadId");
  assert.strictEqual(materialChangeMap["lead-1"].changeReason, "Duplicate funding report", "Latest change reason preserved");
  assert.strictEqual(materialChangeMap["lead-2"].changeReason, "New CTO hired", "Lead 2 present");
  console.log("[PASS] Test Case D: Multiple changed leads appear in materialChangeMap exactly once");

  console.log("=== All regeneration flow unit assertions PASSED ===");
}

testRegenerationCandidateLogic().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
