import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalize,
  createContextHash,
  buildMessageGenerationContextBundle,
  DEFAULT_CONTEXT_HASH_VERSION,
} from "./context-hash";

describe("Canonical Context Hashing", () => {

  test("Test 1: same input produces same hash", () => {
    const input = { leadId: "L-100", campaignId: "C-200", title: "VP Sales" };
    const hash1 = createContextHash(input);
    const hash2 = createContextHash(input);

    assert.equal(hash1, hash2);
    assert.equal(typeof hash1, "string");
    assert.equal(hash1.length, 64); // SHA-256 hex string length
  });

  test("Test 2: different object property order produces same hash", () => {
    const inputA = { leadId: "L-100", campaignId: "C-200", title: "VP Sales" };
    const inputB = { title: "VP Sales", campaignId: "C-200", leadId: "L-100" };

    const hashA = createContextHash(inputA);
    const hashB = createContextHash(inputB);

    assert.equal(hashA, hashB);
  });

  test("Test 3: nested property key reordering produces same hash", () => {
    const inputA = {
      lead: { id: "L-1", name: "Alice", meta: { region: "US", tier: 1 } },
      campaign: { id: "C-1", active: true },
    };
    const inputB = {
      campaign: { active: true, id: "C-1" },
      lead: { meta: { tier: 1, region: "US" }, id: "L-1", name: "Alice" },
    };

    assert.equal(canonicalize(inputA), canonicalize(inputB));
    assert.equal(createContextHash(inputA), createContextHash(inputB));
  });

  test("Test 4: array ordering is preserved (different order → different hash)", () => {
    const inputA = { signals: ["FUNDING", "HIRING"] };
    const inputB = { signals: ["HIRING", "FUNDING"] };

    assert.notEqual(canonicalize(inputA), canonicalize(inputB));
    assert.notEqual(createContextHash(inputA), createContextHash(inputB));
  });

  test("Test 5: semantic field modification produces different hash", () => {
    const base = { leadId: "L-1", title: "CEO" };
    const modified = { leadId: "L-1", title: "CTO" };

    assert.notEqual(createContextHash(base), createContextHash(modified));
  });

  test("Test 6: version change produces different hash", () => {
    const input = { leadId: "L-1", campaignId: "C-1" };

    const hashV1 = createContextHash(input, { version: "v1" });
    const hashV2 = createContextHash(input, { version: "v2" });

    assert.notEqual(hashV1, hashV2);
  });

  test("Test 7: volatile timestamp fields do not affect context hash", () => {
    const inputA = {
      leadId: "L-1",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
      createdAt: new Date("2026-01-01T00:00:00Z"),
    };
    const inputB = {
      leadId: "L-1",
      updatedAt: new Date("2026-08-10T12:34:56Z"),
      createdAt: new Date("2026-08-10T12:34:56Z"),
    };

    assert.equal(createContextHash(inputA), createContextHash(inputB));
  });

  test("buildMessageGenerationContextBundle builds canonical structure", () => {
    const bundle = buildMessageGenerationContextBundle({
      lead: {
        id: "lead_123",
        firstName: "Jane",
        companyName: "Acme",
        signals: [{ signalType: "FUNDING", value: "Series B", confidence: 0.9 }],
      },
      campaign: {
        id: "camp_456",
        name: "Q3 Outbound",
        icpDescription: "B2B SaaS VPs",
      },
    });

    assert.equal(typeof bundle, "object");
    assert.equal(bundle.agentName, "generate.message-writer");
    const hash = createContextHash(bundle);
    assert.equal(typeof hash, "string");
    assert.equal(hash.length, 64);
  });
});
