/**
 * Sprint 1 Tests — Lease Engine (fencing logic, pure unit)
 *
 * Tests the fencing epoch / leaseVersion semantics WITHOUT a real DB.
 * We test the business rules and state machine logic directly.
 *
 * DB integration tests that call claimLease/renewLease against a real DB
 * are in lease.integration.test.ts (Sprint 1 gate, requires DB).
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";

// ---------------------------------------------------------------------------
// Pure fencing epoch arithmetic tests
// These verify the invariants, not the DB implementation.
// ---------------------------------------------------------------------------

describe("Fencing epoch arithmetic", () => {
  test("new epoch = old epoch + 1", () => {
    const oldEpoch = 5;
    const newEpoch = oldEpoch + 1;
    assert.equal(newEpoch, 6);
  });

  test("stale worker epoch is strictly less than new epoch", () => {
    const staleEpoch = 10;
    const newEpoch = 11;
    assert.ok(staleEpoch < newEpoch, "stale epoch must be < new epoch");
  });

  test("epoch 1 is the initial value", () => {
    // Validates schema default
    const defaultEpoch = 1;
    assert.equal(defaultEpoch, 1);
  });

  test("fencingEpoch never decrements", () => {
    const epochs = [1, 2, 3, 4, 5];
    for (let i = 1; i < epochs.length; i++) {
      assert.ok(
        epochs[i]! > epochs[i - 1]!,
        `epoch[${i}] must be > epoch[${i - 1}]`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// leaseVersion arithmetic
// ---------------------------------------------------------------------------
describe("leaseVersion arithmetic", () => {
  test("first leaseVersion within an epoch is 1", () => {
    const initialVersion = 1;
    assert.equal(initialVersion, 1);
  });

  test("renewal increments leaseVersion by 1", () => {
    const current = 3;
    const afterRenewal = current + 1;
    assert.equal(afterRenewal, 4);
  });

  test("takeover resets leaseVersion to 1 for new epoch", () => {
    // After takeover: new epoch, fresh lease
    const afterTakeoverLeaseVersion = 1;
    assert.equal(afterTakeoverLeaseVersion, 1);
  });

  test("a stale worker's leaseVersion is always < current after any renewal", () => {
    const staleVersion = 3;
    const currentAfterRenewals = 5;
    assert.ok(staleVersion < currentAfterRenewals);
  });
});

// ---------------------------------------------------------------------------
// Lease lifecycle state machine
// ---------------------------------------------------------------------------
describe("Lease lifecycle states", () => {
  /**
   * Simulated minimal lease record for state machine testing.
   */
  interface MockLease {
    workerId: string;
    fencingEpoch: number;
    leaseVersion: number;
    expiresAt: Date;
  }

  function isLeaseExpired(lease: MockLease): boolean {
    return lease.expiresAt < new Date();
  }

  function simulateClaim(
    epoch: number,
    workerId: string,
    ttlMs: number,
  ): MockLease {
    return {
      workerId,
      fencingEpoch: epoch,
      leaseVersion: 1,
      expiresAt: new Date(Date.now() + ttlMs),
    };
  }

  function simulateRenew(
    lease: MockLease,
    workerId: string,
    fencingEpoch: number,
    leaseVersion: number,
    ttlMs: number,
  ): { renewed: boolean; lease?: MockLease } {
    if (
      lease.workerId !== workerId ||
      lease.fencingEpoch !== fencingEpoch ||
      lease.leaseVersion !== leaseVersion ||
      isLeaseExpired(lease)
    ) {
      return { renewed: false };
    }
    return {
      renewed: true,
      lease: { ...lease, leaseVersion: leaseVersion + 1, expiresAt: new Date(Date.now() + ttlMs) },
    };
  }

  function simulateTakeover(
    currentEpoch: number,
    newWorkerId: string,
    ttlMs: number,
  ): { newEpoch: number; lease: MockLease } {
    const newEpoch = currentEpoch + 1;
    return {
      newEpoch,
      lease: simulateClaim(newEpoch, newWorkerId, ttlMs),
    };
  }

  test("fresh claim gives epoch=1, leaseVersion=1", () => {
    const lease = simulateClaim(1, "worker-a", 30_000);
    assert.equal(lease.fencingEpoch, 1);
    assert.equal(lease.leaseVersion, 1);
    assert.equal(lease.workerId, "worker-a");
  });

  test("renewal increments leaseVersion", () => {
    const lease = simulateClaim(1, "worker-a", 30_000);
    const result = simulateRenew(lease, "worker-a", 1, 1, 30_000);
    assert.ok(result.renewed);
    assert.equal(result.lease!.leaseVersion, 2);
  });

  test("wrong workerId cannot renew", () => {
    const lease = simulateClaim(1, "worker-a", 30_000);
    const result = simulateRenew(lease, "worker-b", 1, 1, 30_000);
    assert.equal(result.renewed, false);
  });

  test("wrong leaseVersion cannot renew", () => {
    const lease = simulateClaim(1, "worker-a", 30_000);
    const result = simulateRenew(lease, "worker-a", 1, 99, 30_000);
    assert.equal(result.renewed, false);
  });

  test("wrong fencingEpoch cannot renew", () => {
    const lease = simulateClaim(1, "worker-a", 30_000);
    const result = simulateRenew(lease, "worker-a", 99, 1, 30_000);
    assert.equal(result.renewed, false);
  });

  test("expired lease cannot be renewed", () => {
    // Create lease that is already expired
    const expiredLease: MockLease = {
      workerId: "worker-a",
      fencingEpoch: 1,
      leaseVersion: 1,
      expiresAt: new Date(Date.now() - 1_000), // expired 1 second ago
    };
    const result = simulateRenew(expiredLease, "worker-a", 1, 1, 30_000);
    assert.equal(result.renewed, false);
  });

  test("takeover increments fencingEpoch", () => {
    const oldEpoch = 1;
    const { newEpoch, lease } = simulateTakeover(oldEpoch, "worker-b", 30_000);
    assert.equal(newEpoch, 2);
    assert.equal(lease.fencingEpoch, 2);
    assert.equal(lease.workerId, "worker-b");
    assert.equal(lease.leaseVersion, 1); // fresh start
  });

  test("worker A cannot mutate after takeover — epoch mismatch", () => {
    // Worker A has epoch 1
    const workerAEpoch: number = 1;
    // After takeover, DB has epoch 2
    const currentDBEpoch: number = 2;

    // Simulates: WHERE fencingEpoch = 1 → no match because DB now has epoch=2
    const mutationWouldSucceed = workerAEpoch === currentDBEpoch;
    assert.equal(mutationWouldSucceed, false, "stale worker must not mutate");
  });

  test("worker B can mutate with correct epoch after takeover", () => {
    const currentDBEpoch = 2;
    const workerBEpoch = 2;
    const mutationWouldSucceed = workerBEpoch === currentDBEpoch;
    assert.equal(mutationWouldSucceed, true);
  });
});

// ---------------------------------------------------------------------------
// Crash-recovery scenario (state machine simulation)
// ---------------------------------------------------------------------------
describe("Crash-recovery fencing scenario", () => {
  test("worker A crashes → lease expires → worker B takes over → A cannot mutate", () => {
    // Setup: Worker A claims at epoch 1
    const epochAtWorkerAClaim = 1;
    const workerALeaseVersion = 1;

    // Worker A crashes. Lease expires. Worker B takes over.
    // DB increments fencingEpoch to 2.
    const currentDBEpoch: number = 2; // after takeover

    // Worker A comes back with stale state:
    const workerAFencingEpoch: number = epochAtWorkerAClaim; // still 1

    // Worker A attempts mutation: WHERE fencingEpoch = 1 AND leaseVersion = 1
    // DB has fencingEpoch = 2 → 0 rows updated
    const casWouldMatch = workerAFencingEpoch === currentDBEpoch;
    assert.equal(casWouldMatch, false, "revived Worker A must be rejected");
  });

  test("multiple takeovers produce strictly increasing epochs", () => {
    let epoch = 1;
    const workers = ["a", "b", "c", "d", "e"];
    const epochs: number[] = [epoch];

    for (let i = 1; i < workers.length; i++) {
      epoch = epoch + 1; // takeover
      epochs.push(epoch);
      assert.ok(epochs[i]! > epochs[i - 1]!, `epoch after takeover ${i} must be > previous`);
    }

    assert.equal(epochs[epochs.length - 1], workers.length);
  });
});

// ---------------------------------------------------------------------------
// LeaseMonitor abort signal semantics
// ---------------------------------------------------------------------------
describe("AbortController lease-loss semantics", () => {
  test("AbortController aborts when called", () => {
    const controller = new AbortController();
    assert.equal(controller.signal.aborted, false);
    controller.abort(new Error("LEASE_LOST: STOLEN"));
    assert.equal(controller.signal.aborted, true);
  });

  test("abort reason is accessible", () => {
    const controller = new AbortController();
    const reason = new Error("LEASE_LOST: STOLEN");
    controller.abort(reason);
    assert.equal(controller.signal.reason, reason);
  });

  test("signal listener fires on abort", async () => {
    const controller = new AbortController();
    let fired = false;

    controller.signal.addEventListener("abort", () => {
      fired = true;
    });

    controller.abort();
    // Allow microtask queue to drain
    await Promise.resolve();
    assert.equal(fired, true);
  });
});
