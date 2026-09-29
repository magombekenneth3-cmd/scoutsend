/**
 * Sprint 2 Tests — SendIntent Fencing & Lease Engine (Unit Tests)
 *
 * Tests SendIntent state machine transitions, fencing arithmetic,
 * lease renewal logic, ownership assertion, and takeover rules.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { validateTransition, IllegalStateTransitionError } from "../state/state-transition-registry";
import { buildSendIdempotencyKey } from "./send-intent.service";

describe("SendIntent — State Machine Transitions", () => {
  test("PENDING → DISPATCHING is legal", () => {
    assert.doesNotThrow(() => validateTransition("SendIntent", "PENDING", "DISPATCHING"));
  });

  test("PENDING → FAILED is legal (immediate gate failure)", () => {
    assert.doesNotThrow(() => validateTransition("SendIntent", "PENDING", "FAILED"));
  });

  test("PENDING → SENT is illegal (must pass DISPATCHING)", () => {
    assert.throws(
      () => validateTransition("SendIntent", "PENDING", "SENT"),
      IllegalStateTransitionError,
    );
  });

  test("DISPATCHING → SENT is legal", () => {
    assert.doesNotThrow(() => validateTransition("SendIntent", "DISPATCHING", "SENT"));
  });

  test("DISPATCHING → FAILED is legal", () => {
    assert.doesNotThrow(() => validateTransition("SendIntent", "DISPATCHING", "FAILED"));
  });

  test("DISPATCHING → UNKNOWN is legal", () => {
    assert.doesNotThrow(() => validateTransition("SendIntent", "DISPATCHING", "UNKNOWN"));
  });

  test("SENT → DISPATCHING is illegal (terminal state)", () => {
    assert.throws(
      () => validateTransition("SendIntent", "SENT", "DISPATCHING"),
      IllegalStateTransitionError,
    );
  });

  test("FAILED → DISPATCHING is illegal (terminal state)", () => {
    assert.throws(
      () => validateTransition("SendIntent", "FAILED", "DISPATCHING"),
      IllegalStateTransitionError,
    );
  });
});

describe("SendIntent — Idempotency Key Format", () => {
  test("generates predictable idempotency key", () => {
    const key = buildSendIdempotencyKey("lead-123", 1, "v2");
    assert.equal(key, "send:lead-123:step1:vv2");
  });

  test("different steps produce distinct keys", () => {
    const key1 = buildSendIdempotencyKey("lead-123", 1, "1");
    const key2 = buildSendIdempotencyKey("lead-123", 2, "1");
    assert.notEqual(key1, key2);
  });
});

describe("SendIntent — Fencing Invariants Simulation", () => {
  interface MockSendIntent {
    id: string;
    claimedBy: string | null;
    fencingEpoch: number;
    leaseVersion: number;
    leaseExpiresAt: Date | null;
    status: string;
  }

  function simulateWorkerClaim(
    intent: MockSendIntent,
    workerId: string,
    now: Date,
    ttlMs: number = 60_000,
  ): { granted: boolean; newIntent?: MockSendIntent } {
    if (intent.status === "SENT" || intent.status === "FAILED") {
      return { granted: false };
    }

    const isLeaseActive = intent.leaseExpiresAt && intent.leaseExpiresAt > now;

    if (isLeaseActive && intent.claimedBy !== workerId) {
      return { granted: false };
    }

    const isTakeover = intent.leaseExpiresAt && intent.leaseExpiresAt <= now && intent.claimedBy !== workerId;
    const fencingEpoch = isTakeover ? intent.fencingEpoch + 1 : intent.fencingEpoch;
    const leaseVersion = 1;

    return {
      granted: true,
      newIntent: {
        ...intent,
        claimedBy: workerId,
        fencingEpoch,
        leaseVersion,
        leaseExpiresAt: new Date(now.getTime() + ttlMs),
        status: "DISPATCHING",
      },
    };
  }

  function simulateFencedMutation(
    intent: MockSendIntent,
    workerId: string,
    fencingEpoch: number,
    leaseVersion: number,
    nextStatus: string,
  ): { success: boolean; newIntent?: MockSendIntent } {
    if (
      intent.claimedBy !== workerId ||
      intent.fencingEpoch !== fencingEpoch ||
      intent.leaseVersion !== leaseVersion
    ) {
      return { success: false };
    }

    return {
      success: true,
      newIntent: { ...intent, status: nextStatus },
    };
  }

  test("Worker A claims initial intent at fencingEpoch=1, leaseVersion=1", () => {
    const initial: MockSendIntent = {
      id: "intent-1",
      claimedBy: null,
      fencingEpoch: 1,
      leaseVersion: 1,
      leaseExpiresAt: null,
      status: "PENDING",
    };

    const now = new Date();
    const result = simulateWorkerClaim(initial, "worker-a", now);
    assert.ok(result.granted);
    assert.equal(result.newIntent!.claimedBy, "worker-a");
    assert.equal(result.newIntent!.fencingEpoch, 1);
    assert.equal(result.newIntent!.leaseVersion, 1);
    assert.equal(result.newIntent!.status, "DISPATCHING");
  });

  test("Worker B cannot claim while Worker A lease is active", () => {
    const now = new Date();
    const active: MockSendIntent = {
      id: "intent-1",
      claimedBy: "worker-a",
      fencingEpoch: 1,
      leaseVersion: 1,
      leaseExpiresAt: new Date(now.getTime() + 30_000),
      status: "DISPATCHING",
    };

    const result = simulateWorkerClaim(active, "worker-b", now);
    assert.equal(result.granted, false);
  });

  test("Worker B takeover after lease expiry increments fencingEpoch to 2", () => {
    const past = new Date(Date.now() - 10_000);
    const expired: MockSendIntent = {
      id: "intent-1",
      claimedBy: "worker-a",
      fencingEpoch: 1,
      leaseVersion: 2,
      leaseExpiresAt: past,
      status: "DISPATCHING",
    };

    const now = new Date();
    const result = simulateWorkerClaim(expired, "worker-b", now);
    assert.ok(result.granted);
    assert.equal(result.newIntent!.claimedBy, "worker-b");
    assert.equal(result.newIntent!.fencingEpoch, 2);
    assert.equal(result.newIntent!.leaseVersion, 1);
  });

  test("Stale Worker A with epoch 1 cannot commit post-provider mutation after Worker B takeover", () => {
    const afterTakeover: MockSendIntent = {
      id: "intent-1",
      claimedBy: "worker-b",
      fencingEpoch: 2,
      leaseVersion: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      status: "DISPATCHING",
    };

    // Worker A returns from slow provider call with epoch=1
    const workerAFencingEpoch: number = 1;
    const workerALeaseVersion: number = 2;

    const commitResult = simulateFencedMutation(
      afterTakeover,
      "worker-a",
      workerAFencingEpoch,
      workerALeaseVersion,
      "SENT",
    );

    assert.equal(commitResult.success, false, "stale Worker A commit must be rejected!");
  });

  test("Worker B with epoch 2 commits successfully", () => {
    const afterTakeover: MockSendIntent = {
      id: "intent-1",
      claimedBy: "worker-b",
      fencingEpoch: 2,
      leaseVersion: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      status: "DISPATCHING",
    };

    const commitResult = simulateFencedMutation(
      afterTakeover,
      "worker-b",
      2,
      1,
      "SENT",
    );

    assert.ok(commitResult.success);
    assert.equal(commitResult.newIntent!.status, "SENT");
  });
});
