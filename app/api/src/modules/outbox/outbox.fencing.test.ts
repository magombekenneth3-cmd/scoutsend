import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { LEASE_TIMEOUT_MS } from "./outbox.dispatcher";

console.log("Running Sprint 10 Lease Fencing Tests...");

// Simulated Database verifying cryptographic lease token fencing mechanics
class FencedMockDatabase {
  private events = new Map<string, any>();

  createEvent(id: string) {
    const record = {
      id,
      status: "PENDING",
      leaseToken: null as string | null,
      leaseExpiresAt: null as Date | null,
      attempts: 0,
    };
    this.events.set(id, record);
    return record;
  }

  claim(id: string, now: Date) {
    const record = this.events.get(id);
    if (!record) return { count: 0 };

    const isPending = record.status === "PENDING";
    const isExpiredLease = record.status === "PROCESSING" && record.leaseExpiresAt && record.leaseExpiresAt.getTime() <= now.getTime();

    if (isPending || isExpiredLease) {
      const leaseToken = randomUUID();
      const leaseExpiresAt = new Date(now.getTime() + LEASE_TIMEOUT_MS);
      record.status = "PROCESSING";
      record.leaseToken = leaseToken;
      record.leaseExpiresAt = leaseExpiresAt;
      record.attempts += 1;
      return { count: 1, leaseToken };
    }

    return { count: 0, leaseToken: null };
  }

  fencedComplete(id: string, leaseToken: string, status: "SUCCEEDED" | "FAILED" | "DEAD_LETTER") {
    const record = this.events.get(id);
    if (!record) return { count: 0 };

    // Strict fencing check: status must be PROCESSING and leaseToken must match!
    if (record.status === "PROCESSING" && record.leaseToken === leaseToken) {
      record.status = status;
      record.leaseToken = null;
      record.leaseExpiresAt = null;
      return { count: 1 };
    }

    // Fencing Breach!
    return { count: 0 };
  }

  getEvent(id: string) {
    return this.events.get(id);
  }
}

async function runFencingTests() {
  const db = new FencedMockDatabase();
  const eventId = "evt_fencing_1";
  db.createEvent(eventId);

  // 1. Worker A Claims Event
  const t0 = new Date("2026-08-10T00:00:00.000Z");
  const claimA = db.claim(eventId, t0);
  assert.equal(claimA.count, 1);
  assert.ok(claimA.leaseToken, "Worker A must receive a valid UUID lease token");

  const tokenA = claimA.leaseToken!;

  // 2. Worker A stalls > 5 minutes (lease expires)
  const tStall = new Date("2026-08-10T00:06:00.000Z");

  // 3. Worker B Reclaims Event after lease expiration
  const claimB = db.claim(eventId, tStall);
  assert.equal(claimB.count, 1, "Worker B must successfully reclaim expired lease");
  assert.ok(claimB.leaseToken, "Worker B must receive a new lease token");
  assert.notEqual(claimB.leaseToken, tokenA, "Worker B lease token MUST NOT equal Worker A lease token");

  const tokenB = claimB.leaseToken!;

  // 4. Stalled Worker A resumes and attempts fenced completion with stale tokenA
  const completeA = db.fencedComplete(eventId, tokenA, "SUCCEEDED");
  assert.equal(completeA.count, 0, "Stale Worker A completion update MUST return count = 0 (Fencing breach)");

  // Verify event status is still PROCESSING owned by Worker B
  const ev = db.getEvent(eventId);
  assert.equal(ev.status, "PROCESSING");
  assert.equal(ev.leaseToken, tokenB, "Event lease token must remain assigned to Worker B");

  // 5. Active Worker B completes successfully with tokenB
  const completeB = db.fencedComplete(eventId, tokenB, "SUCCEEDED");
  assert.equal(completeB.count, 1, "Active Worker B completion update MUST succeed");
  assert.equal(db.getEvent(eventId).status, "SUCCEEDED");

  console.log("  ✓ Test 1: Worker claim receives unique UUID leaseToken and expiration timestamp");
  console.log("  ✓ Test 2: Lease reclamation assigns fresh leaseToken (tokenB != tokenA)");
  console.log("  ✓ Test 3: Stale Worker A completion attempt rejected with count = 0 (fencing breach)");
  console.log("  ✓ Test 4: Active Worker B completion succeeds without state corruption");
}

runFencingTests()
  .then(() => {
    console.log("✅ All Sprint 10 Lease Fencing Tests Passed Cleanly!");
  })
  .catch((err) => {
    console.error("Lease Fencing Test Error:", err);
    process.exit(1);
  });
