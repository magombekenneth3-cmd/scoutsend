import assert from "node:assert/strict";
import {
  createProposalHash,
  verifyProposalIntegrity,
  isProposalExpired,
  DEFAULT_PROPOSAL_TTL_MS,
} from "./proposal-integrity";
import type { AgentProposal } from "./agent-proposal";

console.log("Running Proposal Integrity & Expiration Tests...");

const baseProposal: AgentProposal<{ text: string }> = {
  proposalId: "prop_12345",
  agentName: "test.agent",
  payload: { text: "Hello world" },
  agentConfidence: 0.95,
  contextHash: "hash_abc123",
  requestFingerprint: "fp_7890",
  proposedAt: new Date(),
  expiresAt: new Date(Date.now() + DEFAULT_PROPOSAL_TTL_MS),
  tokenUsage: { input: 100, output: 50, total: 150 },
  latencyMs: 350,
  proposalHash: "",
};

// Compute valid proposalHash
baseProposal.proposalHash = createProposalHash({
  agentName: baseProposal.agentName,
  requestFingerprint: baseProposal.requestFingerprint,
  contextHash: baseProposal.contextHash,
  payload: baseProposal.payload,
  agentConfidence: baseProposal.agentConfidence,
});

// 1. Unchanged proposal passes verification
{
  assert.equal(verifyProposalIntegrity(baseProposal), true, "Unchanged proposal must pass integrity check");
  console.log("  ✓ Unchanged proposal passes integrity check");
}

// 2. Payload modification rejected
{
  const tampered = {
    ...baseProposal,
    payload: { text: "Malicious tampered text" },
  };
  assert.equal(verifyProposalIntegrity(tampered), false, "Tampered payload must fail integrity check");
  console.log("  ✓ Payload modification rejected");
}

// 3. agentName modification rejected
{
  const tampered = {
    ...baseProposal,
    agentName: "malicious.agent",
  };
  assert.equal(verifyProposalIntegrity(tampered), false, "Tampered agentName must fail integrity check");
  console.log("  ✓ agentName modification rejected");
}

// 4. requestFingerprint modification rejected
{
  const tampered = {
    ...baseProposal,
    requestFingerprint: "fp_tampered",
  };
  assert.equal(verifyProposalIntegrity(tampered), false, "Tampered requestFingerprint must fail integrity check");
  console.log("  ✓ requestFingerprint modification rejected");
}

// 5. contextHash modification rejected
{
  const tampered = {
    ...baseProposal,
    contextHash: "hash_tampered",
  };
  assert.equal(verifyProposalIntegrity(tampered), false, "Tampered contextHash must fail integrity check");
  console.log("  ✓ contextHash modification rejected");
}

// 6. agentConfidence modification rejected
{
  const tampered = {
    ...baseProposal,
    agentConfidence: 0.1,
  };
  assert.equal(verifyProposalIntegrity(tampered), false, "Tampered agentConfidence must fail integrity check");
  console.log("  ✓ agentConfidence modification rejected");
}

// 7. Volatile fields DO NOT invalidate hash (proposedAt, latencyMs, tokenUsage)
{
  const mutatedTelemetry = {
    ...baseProposal,
    proposedAt: new Date(Date.now() + 5000),
    latencyMs: 999,
    tokenUsage: { input: 999, output: 999, total: 1998 },
  };
  assert.equal(verifyProposalIntegrity(mutatedTelemetry), true, "Volatile telemetry must NOT invalidate proposalHash");
  console.log("  ✓ Volatile telemetry mutation does NOT invalidate proposalHash");
}

// 8. Expiration TTL Verification
{
  const validProposal = {
    ...baseProposal,
    expiresAt: new Date(Date.now() + 60_000), // expires in 1 min
  };
  assert.equal(isProposalExpired(validProposal), false, "Future expiresAt must not be expired");

  const expiredProposal = {
    ...baseProposal,
    expiresAt: new Date(Date.now() - 1000), // expired 1s ago
  };
  assert.equal(isProposalExpired(expiredProposal), true, "Past expiresAt must be marked expired");
  console.log("  ✓ Expiration TTL verification verified (valid vs expired)");
}

console.log("✅ All Proposal Integrity & Expiration Tests Passed Cleanly!");
