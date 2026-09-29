/**
 * Sprint 1 Tests — StateTransitionRegistry
 *
 * All pure unit tests. No DB, no network.
 * Run with: node --test src/lib/state/state-transition-registry.test.ts
 * Or via pnpm: pnpm test:unit src/lib/state/state-transition-registry.test.ts
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  validateTransition,
  getTransitionMap,
  IllegalStateTransitionError,
} from "./state-transition-registry";

// ---------------------------------------------------------------------------
// CampaignRun
// ---------------------------------------------------------------------------
describe("StateTransitionRegistry — CampaignRun", () => {
  test("CREATED → RUNNING is legal", () => {
    assert.doesNotThrow(() => validateTransition("CampaignRun", "CREATED", "RUNNING"));
  });

  test("CREATED → SENT is illegal", () => {
    assert.throws(
      () => validateTransition("CampaignRun", "CREATED", "SENT"),
      IllegalStateTransitionError,
    );
  });

  test("RUNNING → COMPLETED is legal", () => {
    assert.doesNotThrow(() => validateTransition("CampaignRun", "RUNNING", "COMPLETED"));
  });

  test("RUNNING → CREATED is illegal (no going backward)", () => {
    assert.throws(
      () => validateTransition("CampaignRun", "RUNNING", "CREATED"),
      IllegalStateTransitionError,
    );
  });

  test("COMPLETED → RUNNING is illegal (terminal)", () => {
    assert.throws(
      () => validateTransition("CampaignRun", "COMPLETED", "RUNNING"),
      IllegalStateTransitionError,
    );
  });

  test("FAILED → RECOVERING is legal", () => {
    assert.doesNotThrow(() => validateTransition("CampaignRun", "FAILED", "RECOVERING"));
  });

  test("RECOVERING → RUNNING is legal", () => {
    assert.doesNotThrow(() => validateTransition("CampaignRun", "RECOVERING", "RUNNING"));
  });

  test("RECOVERING → CREATED is illegal", () => {
    assert.throws(
      () => validateTransition("CampaignRun", "RECOVERING", "CREATED"),
      IllegalStateTransitionError,
    );
  });
});

// ---------------------------------------------------------------------------
// SendIntent
// ---------------------------------------------------------------------------
describe("StateTransitionRegistry — SendIntent", () => {
  test("PENDING → DISPATCHING is legal", () => {
    assert.doesNotThrow(() => validateTransition("SendIntent", "PENDING", "DISPATCHING"));
  });

  test("PENDING → SENT is illegal (must go through DISPATCHING)", () => {
    assert.throws(
      () => validateTransition("SendIntent", "PENDING", "SENT"),
      IllegalStateTransitionError,
    );
  });

  test("DISPATCHING → UNKNOWN is legal", () => {
    assert.doesNotThrow(() => validateTransition("SendIntent", "DISPATCHING", "UNKNOWN"));
  });

  test("UNKNOWN → RECONCILING is legal", () => {
    assert.doesNotThrow(() => validateTransition("SendIntent", "UNKNOWN", "RECONCILING"));
  });

  test("SENT → FAILED is illegal (terminal)", () => {
    assert.throws(
      () => validateTransition("SendIntent", "SENT", "FAILED"),
      IllegalStateTransitionError,
    );
  });

  test("HUMAN_REVIEW → SENT is legal (operator resolution)", () => {
    assert.doesNotThrow(() => validateTransition("SendIntent", "HUMAN_REVIEW", "SENT"));
  });
});

// ---------------------------------------------------------------------------
// QuotaReservation
// ---------------------------------------------------------------------------
describe("StateTransitionRegistry — QuotaReservation", () => {
  test("RESERVED → CONSUMED is legal", () => {
    assert.doesNotThrow(() => validateTransition("QuotaReservation", "RESERVED", "CONSUMED"));
  });

  test("RESERVED → RELEASED is legal", () => {
    assert.doesNotThrow(() => validateTransition("QuotaReservation", "RESERVED", "RELEASED"));
  });

  test("CONSUMED → RELEASED is illegal (terminal)", () => {
    assert.throws(
      () => validateTransition("QuotaReservation", "CONSUMED", "RELEASED"),
      IllegalStateTransitionError,
    );
  });

  test("RELEASED → CONSUMED is illegal (terminal)", () => {
    assert.throws(
      () => validateTransition("QuotaReservation", "RELEASED", "CONSUMED"),
      IllegalStateTransitionError,
    );
  });
});

// ---------------------------------------------------------------------------
// Operation
// ---------------------------------------------------------------------------
describe("StateTransitionRegistry — Operation", () => {
  test("PENDING → RUNNING is legal", () => {
    assert.doesNotThrow(() => validateTransition("Operation", "PENDING", "RUNNING"));
  });

  test("RUNNING → SUCCEEDED is legal", () => {
    assert.doesNotThrow(() => validateTransition("Operation", "RUNNING", "SUCCEEDED"));
  });

  test("RUNNING → LEASE_EXPIRED is legal", () => {
    assert.doesNotThrow(() => validateTransition("Operation", "RUNNING", "LEASE_EXPIRED"));
  });

  test("LEASE_EXPIRED → RUNNING is legal (recovery)", () => {
    assert.doesNotThrow(() => validateTransition("Operation", "LEASE_EXPIRED", "RUNNING"));
  });

  test("SUCCEEDED → RUNNING is illegal (terminal)", () => {
    assert.throws(
      () => validateTransition("Operation", "SUCCEEDED", "RUNNING"),
      IllegalStateTransitionError,
    );
  });
});

// ---------------------------------------------------------------------------
// Campaign
// ---------------------------------------------------------------------------
describe("StateTransitionRegistry — Campaign", () => {
  test("DRAFT → RESEARCHING is legal", () => {
    assert.doesNotThrow(() => validateTransition("Campaign", "DRAFT", "RESEARCHING"));
  });

  test("DRAFT → SENDING is illegal", () => {
    assert.throws(
      () => validateTransition("Campaign", "DRAFT", "SENDING"),
      IllegalStateTransitionError,
    );
  });

  test("COMPLETED → SENDING is illegal (terminal)", () => {
    assert.throws(
      () => validateTransition("Campaign", "COMPLETED", "SENDING"),
      IllegalStateTransitionError,
    );
  });

  test("CANCELED → DRAFT is illegal (terminal)", () => {
    assert.throws(
      () => validateTransition("Campaign", "CANCELED", "DRAFT"),
      IllegalStateTransitionError,
    );
  });
});

// ---------------------------------------------------------------------------
// Lead
// ---------------------------------------------------------------------------
describe("StateTransitionRegistry — Lead", () => {
  test("DISCOVERED → RESEARCH_PENDING is legal", () => {
    assert.doesNotThrow(() => validateTransition("Lead", "DISCOVERED", "RESEARCH_PENDING"));
  });

  test("SENT → WAITING_FOR_REPLY is legal", () => {
    assert.doesNotThrow(() => validateTransition("Lead", "SENT", "WAITING_FOR_REPLY"));
  });

  test("DISQUALIFIED → RESEARCH_PENDING is illegal (terminal)", () => {
    assert.throws(
      () => validateTransition("Lead", "DISQUALIFIED", "RESEARCH_PENDING"),
      IllegalStateTransitionError,
    );
  });

  test("CONVERTED → anything is illegal (terminal)", () => {
    assert.throws(
      () => validateTransition("Lead", "CONVERTED", "SENT"),
      IllegalStateTransitionError,
    );
  });
});

// ---------------------------------------------------------------------------
// Error shape
// ---------------------------------------------------------------------------
describe("IllegalStateTransitionError shape", () => {
  test("has correct name", () => {
    const err = new IllegalStateTransitionError("SendIntent", "SENT", "PENDING");
    assert.equal(err.name, "IllegalStateTransitionError");
  });

  test("message contains model, from, to", () => {
    const err = new IllegalStateTransitionError("CampaignRun", "COMPLETED", "RUNNING");
    assert.match(err.message, /CampaignRun/);
    assert.match(err.message, /COMPLETED/);
    assert.match(err.message, /RUNNING/);
  });

  test("is instance of Error", () => {
    const err = new IllegalStateTransitionError("Lead", "CONVERTED", "SENT");
    assert.ok(err instanceof Error);
  });
});

// ---------------------------------------------------------------------------
// getTransitionMap introspection
// ---------------------------------------------------------------------------
describe("getTransitionMap", () => {
  test("returns non-empty map for CampaignRun", () => {
    const map = getTransitionMap("CampaignRun");
    assert.ok(Object.keys(map).length > 0);
    assert.ok(Array.isArray(map["CREATED"]));
  });

  test("CREATED has exactly 1 successor for CampaignRun", () => {
    const map = getTransitionMap("CampaignRun");
    assert.deepEqual(map["CREATED"], ["RUNNING"]);
  });

  test("COMPLETED has 0 successors for CampaignRun", () => {
    const map = getTransitionMap("CampaignRun");
    assert.deepEqual(map["COMPLETED"], []);
  });
});

// ---------------------------------------------------------------------------
// Unknown predecessor (defense against garbage input)
// ---------------------------------------------------------------------------
describe("Unknown predecessor states", () => {
  test("nonexistent predecessor throws", () => {
    assert.throws(
      () => validateTransition("CampaignRun", "NONEXISTENT", "RUNNING"),
      IllegalStateTransitionError,
    );
  });

  test("empty string predecessor throws", () => {
    assert.throws(
      () => validateTransition("SendIntent", "", "DISPATCHING"),
      IllegalStateTransitionError,
    );
  });
});
