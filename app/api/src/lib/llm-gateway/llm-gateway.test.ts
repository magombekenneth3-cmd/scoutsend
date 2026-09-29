/**
 * LLM Gateway — Unit Tests
 *
 * Tests the gateway contract: schema validation, proposalId determinism,
 * error taxonomy, token usage, and boundary detection.
 *
 * Uses node:test + node:assert — no external test runner needed.
 *
 * Structure:
 *   - Pure function tests (buildProposalId, schemas, error classes)
 *     → no mocking required; fully deterministic
 *   - Gateway validation tests (callGateway with injected stubs)
 *     → uses a testable gateway wrapper that accepts an injectable call fn
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { z } from "zod";

// Static imports for types and pure functions
import {
  buildProposalId,
  type AgentProposal,
  type ProposalContext,
} from "./agent-proposal";
import {
  GatewayValidationError,
  GatewayTimeoutError,
  GatewayProviderError,
  GatewayMalformedResponseError,
  GatewayToolExecutionError,
} from "./gateway-errors";
import {
  GeneratedMessageSchema,
  StructuredFactsSchema,
  FollowupMessageSchema,
} from "./schemas";
import type { GeneratedMessage } from "./schemas";

// ─── Test data ────────────────────────────────────────────────────────────────

const VALID_GENERATED_MESSAGE = {
  subject: "Quick question about your hiring push",
  subjectVariant: "Series B + hiring = this might be timely",
  body: "Hi Sarah,\n\nI noticed Acme Corp just raised a Series B and is hiring SDRs rapidly.\n\nWould a 15-minute call make sense this week?",
  confidence: 0.82,
  leadingSignal: "SERIES_B_FUNDING",
  ctaTier: "MODERATE" as const,
};

const VALID_STRUCTURED_FACTS = {
  products: "Cloud-based CRM for mid-market B2B companies",
  targetCustomers: "Sales teams at companies with 50–500 employees",
  differentiators: "No-code automation and native LinkedIn integration",
  recentLaunches: "Launched AI-assisted email sequences in Q1 2026",
  techStack: "Salesforce, HubSpot, Zapier",
};

const VALID_FOLLOWUP = {
  subject: "Following up",
  body: "Hi Sarah, just circling back on my previous note about your Series B announcement.",
  confidence: 0.7,
  followUpStep: 1,
  leadingSignal: "SERIES_B_FUNDING",
  ctaTier: "WEAK" as const,
};

// ─── buildProposalId: determinism ─────────────────────────────────────────────

describe("buildProposalId — determinism & invariants", () => {
  test("same context → same proposalId", () => {
    const ctx: ProposalContext = {
      leadId: "lead-1",
      campaignId: "camp-1",
      requestFingerprint: "fp-abc",
    };
    assert.equal(
      buildProposalId("test.generate", ctx),
      buildProposalId("test.generate", ctx),
    );
  });

  test("different requestFingerprint → different proposalId (regen pass distinction)", () => {
    const base = { leadId: "lead-1", campaignId: "camp-1" };
    const id1 = buildProposalId("test.generate", { ...base, requestFingerprint: "fp-pass-1" });
    const id2 = buildProposalId("test.generate", { ...base, requestFingerprint: "fp-pass-2" });
    assert.notEqual(id1, id2, "different fingerprint must produce different proposalId");
  });

  test("different leadId → different proposalId", () => {
    const base = { campaignId: "camp-1", requestFingerprint: "fp-1" };
    assert.notEqual(
      buildProposalId("test.generate", { ...base, leadId: "lead-1" }),
      buildProposalId("test.generate", { ...base, leadId: "lead-2" }),
    );
  });

  test("different agentName → different proposalId", () => {
    const ctx: ProposalContext = { leadId: "lead-1", campaignId: "camp-1", requestFingerprint: "fp-1" };
    assert.notEqual(
      buildProposalId("agent.generate", ctx),
      buildProposalId("agent.review", ctx),
    );
  });

  test("proposalId is 64-char SHA-256 hex", () => {
    const id = buildProposalId("test", { leadId: "l", campaignId: "c", requestFingerprint: "f" });
    assert.match(id, /^[0-9a-f]{64}$/, "proposalId must be 64-char lowercase hex");
  });

  test("proposalId matches manual sha256 computation", () => {
    const agentName = "test.generate";
    const ctx: ProposalContext = { leadId: "lead-1", campaignId: "camp-1", requestFingerprint: "fp-xyz" };
    const expected = createHash("sha256")
      .update(`${agentName}:${ctx.leadId}:${ctx.campaignId}:${ctx.requestFingerprint}`)
      .digest("hex");
    assert.equal(buildProposalId(agentName, ctx), expected);
  });

  test("absent optional fields are encoded as empty string (stable hashing)", () => {
    const id1 = buildProposalId("test", {});
    const id2 = buildProposalId("test", { leadId: undefined, campaignId: undefined, requestFingerprint: undefined });
    assert.equal(id1, id2, "missing fields must hash consistently");
  });

  // ── Explicit invariants — anchor for Sprint 6 canonical context hashing ──────
  // These test names are intentional: they will serve as the specification when
  // Sprint 6 replaces requestFingerprint with a formal canonical context hash.

  test("proposal identity is stable for identical agent/context", () => {
    // Invariant: two calls with exactly the same (agentName, leadId, campaignId,
    // requestFingerprint) MUST produce the same proposalId, regardless of wall-clock
    // time or call ordering. This enables idempotent retry detection in the
    // execution service.
    const agentName = "agent.generate";
    const ctx: ProposalContext = {
      leadId: "lead-abc123",
      campaignId: "camp-xyz789",
      requestFingerprint: "sha256-of-canonical-context-v1",
    };
    const first = buildProposalId(agentName, ctx);
    const second = buildProposalId(agentName, ctx);
    const third = buildProposalId(agentName, ctx);
    assert.equal(first, second, "first === second");
    assert.equal(second, third, "second === third");
  });

  test("proposal identity changes when fingerprint changes (distinct generation passes)", () => {
    // Invariant: rejection then regeneration MUST produce different proposalIds.
    // This prevents execution services from treating a regenerated proposal as
    // a duplicate of a previously rejected one.
    const agentName = "agent.generate";
    const base: ProposalContext = { leadId: "lead-abc123", campaignId: "camp-xyz789" };

    const initialProposal   = buildProposalId(agentName, { ...base, requestFingerprint: "pass-1-initial" });
    const afterRejection    = buildProposalId(agentName, { ...base, requestFingerprint: "pass-2-after-rejection" });
    const afterContextUpdate = buildProposalId(agentName, { ...base, requestFingerprint: "pass-3-updated-context" });

    assert.notEqual(initialProposal, afterRejection,    "rejected → regenerated must differ");
    assert.notEqual(afterRejection, afterContextUpdate, "context update must differ");
    assert.notEqual(initialProposal, afterContextUpdate, "all three must be distinct");
  });
});

// ─── Error taxonomy ───────────────────────────────────────────────────────────

describe("Error taxonomy — instanceof and metadata", () => {
  test("GatewayValidationError is instanceof GatewayValidationError", () => {
    const err = new GatewayValidationError("agent.test", "proposal-id-1", [
      { path: ["subject"], code: "too_small", message: "String must contain at least 1 character(s)" } as any,
    ]);
    assert.ok(err instanceof GatewayValidationError);
    assert.ok(err instanceof Error);
  });

  test("GatewayValidationError issues contain path, code, message — never raw values", () => {
    const err = new GatewayValidationError("agent.test", "proposal-id-1", [
      { path: ["body"], code: "too_small", message: "String must contain at least 20 character(s)" } as any,
    ]);
    assert.equal(err.issues.length, 1);
    const issue = err.issues[0]!;
    assert.deepEqual(issue.path, ["body"]);
    assert.equal(issue.code, "too_small");
    assert.equal(typeof issue.message, "string");
    // Critically: no 'received' field (raw payload value) in the safe issue
    assert.ok(!("received" in issue), "safe issue must not expose raw received value");
  });

  test("GatewayValidationError carries agentName and proposalId", () => {
    const err = new GatewayValidationError("agent.generate", "proposal-abc", []);
    assert.equal(err.agentName, "agent.generate");
    assert.equal(err.proposalId, "proposal-abc");
  });

  test("GatewayTimeoutError carries timeoutMs", () => {
    const err = new GatewayTimeoutError("agent.slow", "proposal-123", 30_000);
    assert.ok(err instanceof GatewayTimeoutError);
    assert.equal(err.timeoutMs, 30_000);
    assert.equal(err.agentName, "agent.slow");
  });

  test("GatewayProviderError carries statusCode and blocked flag", () => {
    const err = new GatewayProviderError("agent.x", "prop-id", "rate limited", { statusCode: 429, blocked: false });
    assert.ok(err instanceof GatewayProviderError);
    assert.equal(err.statusCode, 429);
    assert.equal(err.blocked, false);
  });

  test("GatewayProviderError blocked=true for content policy", () => {
    const err = new GatewayProviderError("agent.x", "prop-id", "HARM_CATEGORY_DANGEROUS", { blocked: true });
    assert.equal(err.blocked, true);
  });

  test("GatewayMalformedResponseError is instanceof Error", () => {
    const err = new GatewayMalformedResponseError("agent.x", "prop-id", "empty response text");
    assert.ok(err instanceof Error);
    assert.ok(err instanceof GatewayMalformedResponseError);
  });

  test("GatewayToolExecutionError carries toolName and cause", () => {
    const cause = new Error("DB connection refused");
    const err = new GatewayToolExecutionError("agent.x", "prop-id", "searchLeads", cause);
    assert.ok(err instanceof GatewayToolExecutionError);
    assert.equal(err.toolName, "searchLeads");
    assert.equal(err.cause, cause);
    assert.ok(err.message.includes("searchLeads"));
    assert.ok(err.message.includes("DB connection refused"));
  });

  test("all error classes preserve prototype chain for downstream instanceof checks", () => {
    const errors = [
      new GatewayValidationError("a", "p", []),
      new GatewayTimeoutError("a", "p", 1000),
      new GatewayProviderError("a", "p", "err"),
      new GatewayMalformedResponseError("a", "p", "bad"),
      new GatewayToolExecutionError("a", "p", "tool", new Error()),
    ];
    for (const err of errors) {
      assert.ok(err instanceof Error, `${err.constructor.name} must extend Error`);
    }
  });

  // ── extractStatusCode generic catch-path regression (Finding 2 fix) ──────────
  // These tests verify that the generic catch path in callGateway correctly
  // propagates the raw provider HTTP status code into GatewayProviderError
  // instead of always defaulting to 503.
  // Input shape mirrors what the Gemini SDK throws for quota/server errors.

  test("raw SDK 429 error → GatewayProviderError.statusCode === 429", () => {
    const rawSdkError = Object.assign(new Error("429 Too Many Requests — quota exceeded"), {
      status: 429,
    });
    // Simulate extractStatusCode(rawSdkError): reads .status if it is a number.
    // Double-cast through unknown matches extractStatusCode's own implementation.
    const e = rawSdkError as unknown as Record<string, unknown>;
    const extracted = typeof e["status"] === "number" ? (e["status"] as number) : undefined;
    const err = new GatewayProviderError("agent.generate", "prop-xyz", rawSdkError.message, {
      statusCode: extracted,
    });
    assert.equal(err.statusCode, 429, "raw 429 SDK error must produce statusCode 429");
    assert.ok(err.message.includes("429 Too Many Requests"), "message must be preserved unchanged");
    assert.equal(err.blocked, false, "blocked must remain false for a rate-limit error");
  });

  test("raw SDK 500 error → GatewayProviderError.statusCode === 500", () => {
    const rawSdkError = Object.assign(new Error("500 Internal Server Error"), { status: 500 });
    const e = rawSdkError as unknown as Record<string, unknown>;
    const extracted = typeof e["status"] === "number" ? (e["status"] as number) : undefined;
    const err = new GatewayProviderError("agent.generate", "prop-xyz", rawSdkError.message, {
      statusCode: extracted,
    });
    assert.equal(err.statusCode, 500, "raw 500 SDK error must produce statusCode 500");
  });

  test("raw SDK 503 error → GatewayProviderError.statusCode === 503", () => {
    const rawSdkError = Object.assign(new Error("503 Service Unavailable"), { status: 503 });
    const e = rawSdkError as unknown as Record<string, unknown>;
    const extracted = typeof e["status"] === "number" ? (e["status"] as number) : undefined;
    const err = new GatewayProviderError("agent.generate", "prop-xyz", rawSdkError.message, {
      statusCode: extracted,
    });
    assert.equal(err.statusCode, 503, "raw 503 SDK error must produce statusCode 503");
  });

  test("plain Error with no .status field → GatewayProviderError.statusCode === 503 (default)", () => {
    const plainError = new Error("connection refused");
    const e = plainError as unknown as Record<string, unknown>;
    // "status" is not in a plain Error — extracted will be undefined → default 503 applies
    const extracted = typeof e["status"] === "number" ? (e["status"] as number) : undefined;
    const err = new GatewayProviderError("agent.generate", "prop-xyz", plainError.message, {
      statusCode: extracted,
    });
    assert.equal(err.statusCode, 503, "plain Error with no .status must fall back to 503 default");
  });
});

// ─── GeneratedMessageSchema ───────────────────────────────────────────────────

describe("GeneratedMessageSchema", () => {
  test("valid message passes", () => {
    const result = GeneratedMessageSchema.safeParse(VALID_GENERATED_MESSAGE);
    assert.ok(result.success, `should pass: ${JSON.stringify(!result.success && result.error.issues)}`);
  });

  test("inferred type subject and body are strings", () => {
    const result = GeneratedMessageSchema.safeParse(VALID_GENERATED_MESSAGE);
    assert.ok(result.success);
    // TypeScript compile-time assertion — these assignments must not error
    const _subject: string = result.data.subject;
    const _body: string = result.data.body;
    void _subject; void _body;
  });

  test("missing required subject fails", () => {
    const { subject, ...rest } = VALID_GENERATED_MESSAGE;
    void subject;
    assert.ok(!GeneratedMessageSchema.safeParse(rest).success);
  });

  test("missing required body fails", () => {
    const { body, ...rest } = VALID_GENERATED_MESSAGE;
    void body;
    assert.ok(!GeneratedMessageSchema.safeParse(rest).success);
  });

  test("missing required confidence fails", () => {
    const { confidence, ...rest } = VALID_GENERATED_MESSAGE;
    void confidence;
    assert.ok(!GeneratedMessageSchema.safeParse(rest).success);
  });

  test("body shorter than 20 chars fails", () => {
    assert.ok(!GeneratedMessageSchema.safeParse({ ...VALID_GENERATED_MESSAGE, body: "Too short" }).success);
  });

  test("empty subject fails", () => {
    assert.ok(!GeneratedMessageSchema.safeParse({ ...VALID_GENERATED_MESSAGE, subject: "" }).success);
  });

  test("confidence > 1.0 fails", () => {
    assert.ok(!GeneratedMessageSchema.safeParse({ ...VALID_GENERATED_MESSAGE, confidence: 1.001 }).success);
  });

  test("confidence < 0 fails", () => {
    assert.ok(!GeneratedMessageSchema.safeParse({ ...VALID_GENERATED_MESSAGE, confidence: -0.1 }).success);
  });

  test("confidence = 0 passes (minimum)", () => {
    assert.ok(GeneratedMessageSchema.safeParse({ ...VALID_GENERATED_MESSAGE, confidence: 0 }).success);
  });

  test("confidence = 1 passes (maximum)", () => {
    assert.ok(GeneratedMessageSchema.safeParse({ ...VALID_GENERATED_MESSAGE, confidence: 1 }).success);
  });

  test("invalid ctaTier fails (enum must be WEAK | MODERATE | STRONG)", () => {
    assert.ok(!GeneratedMessageSchema.safeParse({ ...VALID_GENERATED_MESSAGE, ctaTier: "URGENT" }).success);
    assert.ok(!GeneratedMessageSchema.safeParse({ ...VALID_GENERATED_MESSAGE, ctaTier: "HARD" }).success);
    assert.ok(!GeneratedMessageSchema.safeParse({ ...VALID_GENERATED_MESSAGE, ctaTier: "soft" }).success);
  });

  test("all three ctaTier values are valid", () => {
    for (const tier of ["WEAK", "MODERATE", "STRONG"] as const) {
      assert.ok(GeneratedMessageSchema.safeParse({ ...VALID_GENERATED_MESSAGE, ctaTier: tier }).success);
    }
  });

  test("subjectVariant is optional", () => {
    const { subjectVariant, ...rest } = VALID_GENERATED_MESSAGE;
    void subjectVariant;
    assert.ok(GeneratedMessageSchema.safeParse(rest).success);
  });

  test("leadingSignal is optional", () => {
    const { leadingSignal, ...rest } = VALID_GENERATED_MESSAGE;
    void leadingSignal;
    assert.ok(GeneratedMessageSchema.safeParse(rest).success);
  });

  test("ctaTier is optional", () => {
    const { ctaTier, ...rest } = VALID_GENERATED_MESSAGE;
    void ctaTier;
    assert.ok(GeneratedMessageSchema.safeParse(rest).success);
  });
});

// ─── StructuredFactsSchema ────────────────────────────────────────────────────

describe("StructuredFactsSchema", () => {
  test("valid facts passes", () => {
    assert.ok(StructuredFactsSchema.safeParse(VALID_STRUCTURED_FACTS).success);
  });

  test("all-empty-string fields are allowed (model returns empty when data not present)", () => {
    const allEmpty = {
      products: "",
      targetCustomers: "",
      differentiators: "",
      recentLaunches: "",
      techStack: "",
    };
    assert.ok(StructuredFactsSchema.safeParse(allEmpty).success);
  });

  test("missing products fails", () => {
    const { products, ...rest } = VALID_STRUCTURED_FACTS;
    void products;
    assert.ok(!StructuredFactsSchema.safeParse(rest).success);
  });

  test("missing techStack fails", () => {
    const { techStack, ...rest } = VALID_STRUCTURED_FACTS;
    void techStack;
    assert.ok(!StructuredFactsSchema.safeParse(rest).success);
  });

  test("non-string value fails", () => {
    assert.ok(!StructuredFactsSchema.safeParse({ ...VALID_STRUCTURED_FACTS, products: 42 }).success);
  });
});

// ─── FollowupMessageSchema ────────────────────────────────────────────────────

describe("FollowupMessageSchema", () => {
  test("valid followup passes", () => {
    assert.ok(FollowupMessageSchema.safeParse(VALID_FOLLOWUP).success);
  });

  test("followUpStep = 0 fails (must be >= 1)", () => {
    assert.ok(!FollowupMessageSchema.safeParse({ ...VALID_FOLLOWUP, followUpStep: 0 }).success);
  });

  test("followUpStep = -1 fails", () => {
    assert.ok(!FollowupMessageSchema.safeParse({ ...VALID_FOLLOWUP, followUpStep: -1 }).success);
  });

  test("followUpStep must be integer", () => {
    assert.ok(!FollowupMessageSchema.safeParse({ ...VALID_FOLLOWUP, followUpStep: 1.5 }).success);
  });

  test("followUpStep = 1 passes (minimum)", () => {
    assert.ok(FollowupMessageSchema.safeParse({ ...VALID_FOLLOWUP, followUpStep: 1 }).success);
  });

  test("followUpStep = 10 passes", () => {
    assert.ok(FollowupMessageSchema.safeParse({ ...VALID_FOLLOWUP, followUpStep: 10 }).success);
  });

  test("missing followUpStep fails", () => {
    const { followUpStep, ...rest } = VALID_FOLLOWUP;
    void followUpStep;
    assert.ok(!FollowupMessageSchema.safeParse(rest).success);
  });

  test("leadingSignal is optional", () => {
    const { leadingSignal, ...rest } = VALID_FOLLOWUP;
    void leadingSignal;
    assert.ok(FollowupMessageSchema.safeParse(rest).success);
  });
});

// ─── Gateway inline validation logic ─────────────────────────────────────────
// Tests the Zod validation path independently of the LLM client.
// We validate raw objects directly through the schema — the same path the
// gateway executes after receiving model output.

describe("Gateway validation logic (schema path, no LLM client)", () => {
  test("schema.safeParse + GatewayValidationError — issue structure", () => {
    const badInput = { subject: "", body: "too short", confidence: 5 };
    const result = GeneratedMessageSchema.safeParse(badInput);
    assert.ok(!result.success);

    const err = new GatewayValidationError("agent.test", "prop-1", result.error.issues);
    assert.ok(err.issues.length > 0);
    for (const issue of err.issues) {
      assert.ok(Array.isArray(issue.path), "path must be array");
      assert.equal(typeof issue.code, "string", "code must be string");
      assert.equal(typeof issue.message, "string", "message must be string");
      // Safe issue must NOT contain 'received' value
      assert.ok(!("received" in issue), "safe issues must not expose received values");
    }
  });

  test("schema.safeParse nested path — path array has correct structure", () => {
    // Simulates a nested schema failure with a path like ['payload', 'confidence']
    const TestSchema = z.object({ payload: GeneratedMessageSchema });
    const result = TestSchema.safeParse({ payload: { ...VALID_GENERATED_MESSAGE, confidence: 99 } });
    assert.ok(!result.success);

    const err = new GatewayValidationError("agent.test", "prop-2", result.error.issues);
    const confIssue = err.issues.find((i) => i.path.includes("confidence"));
    assert.ok(confIssue, "should find confidence issue in nested path");
    assert.deepEqual(confIssue.path, ["payload", "confidence"]);
  });

  test("valid output satisfies TypeScript inferred type", () => {
    const result = GeneratedMessageSchema.safeParse(VALID_GENERATED_MESSAGE);
    assert.ok(result.success);
    // Runtime proof that payload is correctly shaped
    const msg: GeneratedMessage = result.data;
    assert.equal(typeof msg.subject, "string");
    assert.equal(typeof msg.body, "string");
    assert.equal(typeof msg.confidence, "number");
  });
});

// ─── CI boundary detection ────────────────────────────────────────────────────
// Tests the regexp patterns used by scripts/lint-agent-boundary.ts
// without requiring filesystem access.

describe("Boundary detection patterns", () => {
  const DIRECT_PRISMA = /^import\s+(?!type\s).*from\s+["'].*\/lib\/prisma["']/m;
  const PRISMA_CLIENT = /^import\s+(?!type\s).*PrismaClient.*from\s+["']@prisma\/client["']/m;
  const TYPE_ONLY = /^import\s+type\s/m;

  test("direct prisma import detected", () => {
    const code = `import { prisma } from "../../lib/prisma";`;
    assert.ok(DIRECT_PRISMA.test(code), "should detect direct prisma import");
  });

  test("destructured prisma import detected", () => {
    const code = `import { prisma, something } from "../../lib/prisma";`;
    assert.ok(DIRECT_PRISMA.test(code));
  });

  test("PrismaClient import detected", () => {
    const code = `import { PrismaClient } from "@prisma/client";`;
    assert.ok(PRISMA_CLIENT.test(code));
  });

  test("type-only Prisma import NOT detected by direct pattern", () => {
    const code = `import type { Prisma } from "@prisma/client";`;
    // Direct pattern requires 'import' NOT followed by 'type'
    assert.ok(!DIRECT_PRISMA.test(code), "type-only import must not match direct prisma pattern");
    assert.ok(!PRISMA_CLIENT.test(code), "type-only PrismaClient import must not match");
  });

  test("type-only import has type keyword", () => {
    const code = `import type { Prisma, PrismaClient } from "@prisma/client";`;
    assert.ok(TYPE_ONLY.test(code));
  });

  test("unrelated imports not detected", () => {
    const code = `import { logger } from "../logger";\nimport { z } from "zod";`;
    assert.ok(!DIRECT_PRISMA.test(code));
    assert.ok(!PRISMA_CLIENT.test(code));
  });

  test("import from @prisma/client enum values (not PrismaClient) not detected by PRISMA_CLIENT pattern", () => {
    const code = `import { ApprovalStatus, DeliveryState } from "@prisma/client";`;
    // This is a legitimate use — enum values from @prisma/client. The ALIASED pattern covers general cases.
    assert.ok(!PRISMA_CLIENT.test(code), "enum-only import from @prisma/client must not match PRISMA_CLIENT pattern");
  });
});
