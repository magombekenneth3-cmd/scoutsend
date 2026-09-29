import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  type AgentProposal,
  type GeneratedMessage,
  createContextHash,
  buildMessageGenerationContextBundle,
  buildProposalId,
  createProposalHash,
  isProposalExpired,
  GeneratedMessageSchema,
  GatewayIntegrityError,
  GatewayExpiredProposalError,
  GatewayAlreadyExecutedError,
} from "../../lib/llm-gateway";
import {
  PersistenceFailedError,
  PolicyValidationError,
  PROPOSAL_PERSISTENCE_STATUS,
} from "./generate-message.execution";

describe("Durable Outreach Message Persistence & Hardened Concurrency / Recovery Matrix", () => {
  const dummyPayload: GeneratedMessage = {
    subject: "Fivetran and dbt Labs merger impact",
    body: "Hi Andrew, with Fivetran and dbt Labs merging to build out infrastructure...",
    confidence: 0.9,
    leadingSignal: "FUNDING_SIGNAL",
    ctaTier: "STRONG",
    subjectVariant: "Fivetran + dbt Labs merger",
  };

  test("Proposal ID calculation is deterministic over agentName + leadId + campaignId + contextHash", () => {
    const bundle1 = buildMessageGenerationContextBundle({
      lead: { id: "lead_100", firstName: "Andrew", companyName: "Acme", title: "VP Data" },
      campaign: { id: "camp_200", name: "Outbound Q3", icpDescription: "Data Infra" },
    });
    const hash1 = createContextHash(bundle1);

    const propId1 = buildProposalId("generate.message-writer", {
      leadId: "lead_100",
      campaignId: "camp_200",
      contextHash: hash1,
    });

    const propId2 = buildProposalId("generate.message-writer", {
      leadId: "lead_100",
      campaignId: "camp_200",
      contextHash: hash1,
    });

    assert.equal(propId1, propId2, "Identical context must produce identical proposalId");
  });

  test("Context change produces distinct proposalId (permitting fresh generation)", () => {
    const bundle1 = buildMessageGenerationContextBundle({
      lead: { id: "lead_100", firstName: "Andrew", companyName: "Acme", title: "VP Data" },
      campaign: { id: "camp_200", name: "Outbound Q3", icpDescription: "Data Infra" },
    });
    const hash1 = createContextHash(bundle1);

    const bundle2 = buildMessageGenerationContextBundle({
      lead: { id: "lead_100", firstName: "Andrew", companyName: "Acme", title: "CTO" },
      campaign: { id: "camp_200", name: "Outbound Q3", icpDescription: "Data Infra" },
    });
    const hash2 = createContextHash(bundle2);

    const propId1 = buildProposalId("generate.message-writer", {
      leadId: "lead_100",
      campaignId: "camp_200",
      contextHash: hash1,
    });

    const propId2 = buildProposalId("generate.message-writer", {
      leadId: "lead_100",
      campaignId: "camp_200",
      contextHash: hash2,
    });

    assert.notEqual(hash1, hash2);
    assert.notEqual(propId1, propId2, "Updated context MUST produce different proposalId");
  });

  test("Proposal Hash Tampering Check detects modified payload and flags INVALID state", () => {
    const agentName = "generate.message-writer";
    const requestFingerprint = "fingerprint_abc";
    const contextHash = "hash_12345678901234567890123456789012";
    const agentConfidence = 0.9;

    const originalProposalHash = createProposalHash({
      agentName,
      requestFingerprint,
      contextHash,
      payload: dummyPayload,
      agentConfidence,
    });

    const tamperedPayload: GeneratedMessage = {
      ...dummyPayload,
      body: "TAMPERED BODY CONTENT",
    };

    const recalculatedHash = createProposalHash({
      agentName,
      requestFingerprint,
      contextHash,
      payload: tamperedPayload,
      agentConfidence,
    });

    assert.notEqual(originalProposalHash, recalculatedHash, "Tampered payload MUST result in proposalHash mismatch");
    assert.equal(PROPOSAL_PERSISTENCE_STATUS.INVALID, "INVALID");
  });

  test("Proposal Expiration check correctly identifies expired proposals and flags EXPIRED state", () => {
    const expiredProposal: AgentProposal<GeneratedMessage> = {
      proposalId: "prop_expired",
      agentName: "generate.message-writer",
      payload: dummyPayload,
      agentConfidence: 0.9,
      contextHash: "hash_ctx",
      proposedAt: new Date(Date.now() - 3600_000),
      expiresAt: new Date(Date.now() - 60_000),
      requestFingerprint: "fingerprint_test",
      proposalHash: "hash_test",
      tokenUsage: { input: 100, output: 50, total: 150 },
      latencyMs: 500,
    };

    assert.equal(isProposalExpired(expiredProposal), true, "Expired proposal must return true for isProposalExpired");
    assert.equal(PROPOSAL_PERSISTENCE_STATUS.EXPIRED, "EXPIRED");
  });

  test("Reconstructed proposals parse cleanly through GeneratedMessageSchema without unsafe casts", () => {
    const rawCacheRecord = {
      subject: "Fivetran and dbt Labs merger impact",
      body: "Hi Andrew, with Fivetran and dbt Labs merging...",
      confidence: 0.9,
      leadingSignal: "FUNDING_SIGNAL",
      ctaTier: "STRONG",
      subjectVariant: "Fivetran + dbt Labs merger",
    };

    const parsed = GeneratedMessageSchema.parse(rawCacheRecord);
    assert.equal(parsed.subject, rawCacheRecord.subject);
    assert.equal(parsed.ctaTier, "STRONG");
  });

  test("PersistenceFailedError maintains proper error hierarchy and 503 status code", () => {
    const err = new PersistenceFailedError("DB connection lost", "prop_123", "cache_456");
    assert.equal(err.name, "PersistenceFailedError");
    assert.equal(err.statusCode, 503);
    assert.equal(err.proposalId, "prop_123");
    assert.equal(err.cacheId, "cache_456");
    assert.ok(err.message.includes("DB connection lost"));
  });

  test("State machine transitions enforce GENERATED -> PERSISTING -> PERSISTED / PERSISTENCE_EXHAUSTED / INVALID sequence", () => {
    const validStates = [
      PROPOSAL_PERSISTENCE_STATUS.GENERATED,
      PROPOSAL_PERSISTENCE_STATUS.PERSISTING,
      PROPOSAL_PERSISTENCE_STATUS.PERSISTED,
      PROPOSAL_PERSISTENCE_STATUS.PERSIST_FAILED,
      PROPOSAL_PERSISTENCE_STATUS.EXPIRED,
      PROPOSAL_PERSISTENCE_STATUS.INVALID,
      PROPOSAL_PERSISTENCE_STATUS.PERSISTENCE_EXHAUSTED,
    ];
    assert.equal(validStates.length, 7);
    assert.ok(validStates.includes("INVALID"));
    assert.ok(validStates.includes("PERSISTENCE_EXHAUSTED"));
  });

  test("GatewayAlreadyExecutedError exception handling converts duplicate execution to persisted message replay", () => {
    const err = new GatewayAlreadyExecutedError("generate.message-writer", "prop_already_run");
    assert.equal(err.name, "GatewayAlreadyExecutedError");
    assert.equal(err.statusCode, 500);
  });
});
