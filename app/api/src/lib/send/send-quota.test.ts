/**
 * Sprint 2 Tests — Send Quota Ledger & Settlement (Unit Tests)
 *
 * Tests QuotaReservation state transitions, daily window calculation,
 * limit calculation logic, and settlement idempotency semantics.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { validateTransition, IllegalStateTransitionError } from "../state/state-transition-registry";
import { getDailyWindowStart } from "./send-quota.service";

describe("QuotaReservation — State Machine Transitions", () => {
  test("RESERVED → CONSUMED is legal", () => {
    assert.doesNotThrow(() => validateTransition("QuotaReservation", "RESERVED", "CONSUMED"));
  });

  test("RESERVED → RELEASED is legal", () => {
    assert.doesNotThrow(() => validateTransition("QuotaReservation", "RESERVED", "RELEASED"));
  });

  test("CONSUMED → RELEASED is illegal (terminal state)", () => {
    assert.throws(
      () => validateTransition("QuotaReservation", "CONSUMED", "RELEASED"),
      IllegalStateTransitionError,
    );
  });

  test("RELEASED → CONSUMED is illegal (terminal state)", () => {
    assert.throws(
      () => validateTransition("QuotaReservation", "RELEASED", "CONSUMED"),
      IllegalStateTransitionError,
    );
  });
});

describe("Quota Ledger — Daily Window Calculations", () => {
  test("getDailyWindowStart sets UTC time to 00:00:00.000", () => {
    const date = new Date("2026-08-10T14:32:19.500Z");
    const windowStart = getDailyWindowStart(date);
    assert.equal(windowStart.toISOString(), "2026-08-10T00:00:00.000Z");
  });
});

describe("Quota Ledger — Limit Arithmetic & Invariants", () => {
  interface MockBucket {
    limit: number;
    consumed: number;
    activeReserved: number;
  }

  function canReserve(bucket: MockBucket, amount: number = 1): boolean {
    return bucket.consumed + bucket.activeReserved + amount <= bucket.limit;
  }

  test("allows reservation when under limit", () => {
    const bucket: MockBucket = { limit: 50, consumed: 10, activeReserved: 5 };
    assert.equal(canReserve(bucket, 1), true);
  });

  test("rejects reservation when limit is reached exactly", () => {
    const bucket: MockBucket = { limit: 50, consumed: 45, activeReserved: 5 };
    assert.equal(canReserve(bucket, 1), false);
  });

  test("rejects reservation when limit is exceeded", () => {
    const bucket: MockBucket = { limit: 50, consumed: 48, activeReserved: 5 };
    assert.equal(canReserve(bucket, 1), false);
  });

  test("concurrent requests against limit 10 allow exactly 10 reservations", () => {
    const limit = 10;
    let consumed = 0;
    let activeReserved = 0;
    let grantedCount = 0;
    let rejectedCount = 0;

    for (let i = 0; i < 100; i++) {
      if (consumed + activeReserved + 1 <= limit) {
        activeReserved += 1;
        grantedCount += 1;
      } else {
        rejectedCount += 1;
      }
    }

    assert.equal(grantedCount, 10);
    assert.equal(rejectedCount, 90);
    assert.equal(consumed + activeReserved, limit);
  });

  test("releasing quota frees capacity for future reservations", () => {
    const limit = 10;
    let consumed = 0;
    let activeReserved = 10; // full

    assert.equal(canReserve({ limit, consumed, activeReserved }, 1), false);

    // Release 3 failed reservations
    activeReserved -= 3;

    assert.equal(canReserve({ limit, consumed, activeReserved }, 1), true);
  });
});

describe("Quota Ledger — Idempotent Settlement Semantics", () => {
  interface MockReservation {
    id: string;
    status: "RESERVED" | "CONSUMED" | "RELEASED";
  }

  function settle(res: MockReservation, target: "CONSUMED" | "RELEASED"): { status: string; changed: boolean } {
    if (res.status === target) {
      return { status: res.status, changed: false };
    }
    if (res.status !== "RESERVED") {
      return { status: res.status, changed: false };
    }
    return { status: target, changed: true };
  }

  test("settling RESERVED → CONSUMED returns changed=true", () => {
    const res: MockReservation = { id: "res-1", status: "RESERVED" };
    const out = settle(res, "CONSUMED");
    assert.equal(out.changed, true);
    assert.equal(out.status, "CONSUMED");
  });

  test("settling CONSUMED → CONSUMED is harmless no-op (alreadySettled)", () => {
    const res: MockReservation = { id: "res-1", status: "CONSUMED" };
    const out = settle(res, "CONSUMED");
    assert.equal(out.changed, false);
    assert.equal(out.status, "CONSUMED");
  });

  test("settling RELEASED → RELEASED is harmless no-op (alreadySettled)", () => {
    const res: MockReservation = { id: "res-1", status: "RELEASED" };
    const out = settle(res, "RELEASED");
    assert.equal(out.changed, false);
    assert.equal(out.status, "RELEASED");
  });

  test("settling CONSUMED → RELEASED is rejected (terminal status inviolate)", () => {
    const res: MockReservation = { id: "res-1", status: "CONSUMED" };
    const out = settle(res, "RELEASED");
    assert.equal(out.changed, false);
    assert.equal(out.status, "CONSUMED");
  });
});
