import { getLeadsQuerySchema } from "../app/api/src/modules/leads/leads.schema";

function testValidation() {
  console.log("=== Testing getLeadsQuerySchema ===");

  // Test 1: limit=100 (Allowed)
  const valid100 = getLeadsQuerySchema.safeParse({ competitorSignal: "true", limit: "100", page: "1" });
  console.log("limit=100 valid:", valid100.success);
  if (valid100.success) {
    console.log("Parsed limit=100:", valid100.data);
  } else {
    console.error("Errors for limit=100:", valid100.error);
  }

  // Test 2: limit=1000 (Rejected by contract)
  const invalid1000 = getLeadsQuerySchema.safeParse({ competitorSignal: "true", limit: "1000", page: "1" });
  console.log("limit=1000 valid:", invalid1000.success);
  if (!invalid1000.success) {
    console.log("Expected validation issue for limit=1000:", invalid1000.error.issues[0]?.message);
  }

  // Test 3: campaign query limit=20 (Allowed)
  const valid20 = getLeadsQuerySchema.safeParse({ campaignId: "cmsrq9a2u01jhob1ze7uej7x8", limit: "20", page: "1" });
  console.log("limit=20 valid:", valid20.success);
}

testValidation();
