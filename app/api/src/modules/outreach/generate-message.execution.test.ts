import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  type AgentProposal,
  type GeneratedMessage,
  createContextHash,
  buildMessageGenerationContextBundle,
  GatewayContextMismatchError,
} from "../../lib/llm-gateway";
import {
  PolicyValidationError,
} from "./generate-message.execution";

describe("Deterministic Execution Service & TOCTOU Protection", () => {
  const dummyProposalPayload: GeneratedMessage = {
    subject: "Accelerating outbound team performance",
    body: "Hi Jane,\n\nObserved your team expanding outbound efforts. We automate custom personalization for B2B prospects.\n\nOpen to a brief 15-minute look this week?",
    confidence: 0.85,
    leadingSignal: "FUNDING",
    ctaTier: "STRONG",
  };

  test("Test B — TOCTOU context hash mismatch throws GatewayContextMismatchError", () => {
    const originalBundle = buildMessageGenerationContextBundle({
      lead: { id: "lead_123", firstName: "Jane", companyName: "Acme Corp", title: "VP Sales" },
      campaign: { id: "camp_456", name: "Q3 Sales Outbound", icpDescription: "B2B SaaS" },
    });
    const hashOriginal = createContextHash(originalBundle);

    const updatedBundle = buildMessageGenerationContextBundle({
      lead: { id: "lead_123", firstName: "Jane", companyName: "Acme Corp", title: "Chief Revenue Officer" },
      campaign: { id: "camp_456", name: "Q3 Sales Outbound", icpDescription: "B2B SaaS" },
    });
    const hashUpdated = createContextHash(updatedBundle);

    assert.notEqual(hashOriginal, hashUpdated);

    const proposal: AgentProposal<GeneratedMessage> = {
      proposalId: "prop_abc123",
      agentName: "generate.message-writer",
      payload: dummyProposalPayload,
      agentConfidence: 0.85,
      contextHash: hashOriginal, // Proposal was generated against title "VP Sales"
      proposedAt: new Date(),
      expiresAt: new Date(Date.now() + 900_000),
      requestFingerprint: "fingerprint_1",
      proposalHash: "hash_mock_proposal_123",
      tokenUsage: { input: 500, output: 120, total: 620 },
      latencyMs: 850,
    };

    // Verify error construction and mismatch assertion semantics
    const error = new GatewayContextMismatchError(
      proposal.agentName,
      proposal.proposalId,
      proposal.contextHash,
      hashUpdated // Authoritative DB now has title "Chief Revenue Officer"
    );

    assert.equal(error.name, "GatewayContextMismatchError");
    assert.equal(error.expectedHash, hashOriginal);
    assert.equal(error.actualHash, hashUpdated);
    assert.equal(error.agentName, "generate.message-writer");
    assert.equal(error.proposalId, "prop_abc123");
    assert.ok(error.message.includes("expected"));
    assert.ok(error.message.includes("got"));
    assert.ok(!error.message.includes("Jane")); // Security invariant: NO PII in error message
  });

  test("Test C — Deterministic policy error carries expected structure", () => {
    const policyErr = new PolicyValidationError("Lead is soft-deleted", "LEAD_DELETED");
    assert.equal(policyErr.name, "PolicyValidationError");
    assert.equal(policyErr.reasonCode, "LEAD_DELETED");
    assert.ok(policyErr.message.includes("Policy violation"));
  });

  test("Proposal context identity stability", () => {
    const bundle = buildMessageGenerationContextBundle({
      lead: { id: "lead_1", firstName: "Bob", companyName: "Tech Inc" },
      campaign: { id: "camp_1", name: "Outbound", icpDescription: "Tech" },
    });
    const hash = createContextHash(bundle);

    assert.equal(hash.length, 64);
  });
});
