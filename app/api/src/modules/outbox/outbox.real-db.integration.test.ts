/**
 * Sprint 10 — Real PostgreSQL Outbox Integration Tests
 *
 * LOCATION: app/api/src/modules/outbox/outbox.real-db.integration.test.ts
 *
 * REQUIREMENTS:
 * Must execute against PostgreSQL via Prisma client.
 * Verifies real PostgreSQL unique constraints, transaction atomicity, lease fencing,
 * operator replay concurrency, and lease reclamation.
 */

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma";
import { createOutboxEvent, buildEmailSendIdempotencyKey } from "./outbox.service";
import { replayDeadLetterEvent } from "./outbox-operator.service";

console.log("Running Sprint 10 Real PostgreSQL Outbox Integration Tests...");

async function runRealPostgresTests() {
  // Test Setup Cleanup
  const testRunId = `pg_test_${Date.now()}_${Math.floor(Math.random() * 10000)}`;

  try {
    // -------------------------------------------------------------------------
    // Test A — Unique Constraint Race
    // -------------------------------------------------------------------------
    console.log("  Running Test A — Unique Constraint Race against PostgreSQL...");
    const idempotencyKey = `email:pg_race_${testRunId}`;
    
    // 4 concurrent workers attempt to insert the same OutboxEvent idempotencyKey
    const attempts = await Promise.allSettled(
      Array.from({ length: 4 }).map(async (_, idx) => {
        return prisma.outboxEvent.create({
          data: {
            organizationId: "org_real_test",
            eventType: "EMAIL_SEND_REQUESTED",
            aggregateType: "OutreachMessage",
            aggregateId: `msg_race_${testRunId}`,
            idempotencyKey,
            payload: { workerIdx: idx },
            status: "PENDING",
          },
        });
      }),
    );

    const fulfilled = attempts.filter((a) => a.status === "fulfilled");
    const rejected = attempts.filter((a) => a.status === "rejected");

    assert.equal(fulfilled.length, 1, "Exactly 1 outbox event creation MUST succeed in PostgreSQL");
    assert.equal(rejected.length, 3, "Exactly 3 concurrent insertions MUST fail due to PostgreSQL unique constraint");
    console.log("  ✓ Test A Passed: PostgreSQL enforced unique constraint (1 succeeded, 3 rejected)");

    // -------------------------------------------------------------------------
    // Test B — Lease Fencing
    // -------------------------------------------------------------------------
    console.log("  Running Test B — Lease Fencing against PostgreSQL...");
    const eventIdB = (fulfilled[0] as PromiseFulfilledResult<any>).value.id;
    const tokenA = `token_A_${randomUUID()}`;
    const tokenB = `token_B_${randomUUID()}`;

    // Claim for Worker A
    await prisma.outboxEvent.update({
      where: { id: eventIdB },
      data: { status: "PROCESSING", leaseToken: tokenA, leaseExpiresAt: new Date(Date.now() + 300000) },
    });

    // Reclaim for Worker B (overwriting tokenA with tokenB)
    await prisma.outboxEvent.update({
      where: { id: eventIdB },
      data: { status: "PROCESSING", leaseToken: tokenB, leaseExpiresAt: new Date(Date.now() + 300000) },
    });

    // Stalled Worker A attempts fenced completion with tokenA
    const fencedAttemptA = await prisma.outboxEvent.updateMany({
      where: { id: eventIdB, status: "PROCESSING", leaseToken: tokenA },
      data: { status: "SUCCEEDED" },
    });

    assert.equal(fencedAttemptA.count, 0, "Stale Worker A completion attempt MUST affect 0 rows in PostgreSQL");

    // Verify status is still PROCESSING owned by tokenB
    const currentB = await prisma.outboxEvent.findUnique({ where: { id: eventIdB } });
    assert.equal(currentB?.status, "PROCESSING");
    assert.equal(currentB?.leaseToken, tokenB);
    console.log("  ✓ Test B Passed: Stale Worker A write rejected with 0 affected rows");

    // -------------------------------------------------------------------------
    // Test C — Transaction Atomicity
    // -------------------------------------------------------------------------
    console.log("  Running Test C — Transaction Atomicity against PostgreSQL...");
    const txProposalId = `prop_tx_${testRunId}`;
    const txIdempotencyKey = `email:pg_tx_${testRunId}`;

    // ROLLBACK test
    try {
      await prisma.$transaction(async (tx) => {
        await tx.agentProposalExecution.create({
          data: {
            proposalId: txProposalId,
            agentName: "outreach.message-writer",
            requestFingerprint: `fp_${testRunId}`,
            proposalHash: "hash_123",
            contextHash: "ctx_123",
            startedAt: new Date(),
            status: "SUCCEEDED",
          },
        });

        await createOutboxEvent(tx, {
          organizationId: "org_real_test",
          eventType: "EMAIL_SEND_REQUESTED",
          aggregateType: "OutreachMessage",
          aggregateId: `msg_${testRunId}`,
          idempotencyKey: txIdempotencyKey,
          payload: { outreachMessageId: `msg_${testRunId}`, leadId: `lead_${testRunId}`, campaignId: `camp_${testRunId}` },
        });

        throw new Error("Simulated Transaction Failure");
      });
    } catch (err: any) {
      assert.equal(err.message, "Simulated Transaction Failure");
    }

    const executionRolledBack = await prisma.agentProposalExecution.findUnique({ where: { proposalId: txProposalId } });
    const eventRolledBack = await prisma.outboxEvent.findUnique({ where: { idempotencyKey: txIdempotencyKey } });
    assert.equal(executionRolledBack, null, "Rolled-back business mutation MUST be absent in PostgreSQL");
    assert.equal(eventRolledBack, null, "Rolled-back OutboxEvent MUST be absent in PostgreSQL");

    // COMMIT test
    await prisma.$transaction(async (tx) => {
      await tx.agentProposalExecution.create({
        data: {
          proposalId: txProposalId,
          agentName: "outreach.message-writer",
          requestFingerprint: `fp_${testRunId}`,
          proposalHash: "hash_123",
          contextHash: "ctx_123",
          startedAt: new Date(),
          status: "SUCCEEDED",
        },
      });

      await createOutboxEvent(tx, {
        organizationId: "org_real_test",
        eventType: "EMAIL_SEND_REQUESTED",
        aggregateType: "OutreachMessage",
        aggregateId: `msg_${testRunId}`,
        idempotencyKey: txIdempotencyKey,
        payload: { outreachMessageId: `msg_${testRunId}`, leadId: `lead_${testRunId}`, campaignId: `camp_${testRunId}` },
      });
    });

    const executionCommitted = await prisma.agentProposalExecution.findUnique({ where: { proposalId: txProposalId } });
    const eventCommitted = await prisma.outboxEvent.findUnique({ where: { idempotencyKey: txIdempotencyKey } });
    assert.ok(executionCommitted, "Committed business mutation MUST exist in PostgreSQL");
    assert.ok(eventCommitted, "Committed OutboxEvent MUST exist in PostgreSQL");

    // Clean up committed test entities
    await prisma.outboxEvent.delete({ where: { id: eventCommitted!.id } });
    await prisma.agentProposalExecution.delete({ where: { id: executionCommitted!.id } });

    console.log("  ✓ Test C Passed: Transaction atomicity verified (0 mutations on rollback, both present on commit)");

    // -------------------------------------------------------------------------
    // Test D — Concurrent Operator Replay
    // -------------------------------------------------------------------------
    console.log("  Running Test D — Concurrent Operator Replay against PostgreSQL...");
    const deadEv = await prisma.outboxEvent.create({
      data: {
        organizationId: "org_real_test",
        eventType: "EMAIL_SEND_REQUESTED",
        aggregateType: "OutreachMessage",
        aggregateId: `msg_dead_${testRunId}`,
        idempotencyKey: `email:pg_dead_${testRunId}`,
        payload: {},
        status: "DEAD_LETTER",
        attempts: 5,
        lastError: "Fatal 404 Error",
      },
    });

    // Two operators concurrently attempt replay
    const replayResults = await Promise.allSettled([
      replayDeadLetterEvent({ eventId: deadEv.id, organizationId: "org_real_test", operatorId: "op_1" }),
      replayDeadLetterEvent({ eventId: deadEv.id, organizationId: "org_real_test", operatorId: "op_2" }),
    ]);

    const replayFulfilled = replayResults.filter((r) => r.status === "fulfilled");
    const replayRejected = replayResults.filter((r) => r.status === "rejected");

    assert.equal(replayFulfilled.length, 1, "Exactly 1 operator replay MUST succeed");
    assert.equal(replayRejected.length, 1, "Second concurrent operator replay MUST be rejected");

    const replayedInDb = await prisma.outboxEvent.findUnique({ where: { id: deadEv.id } });
    assert.equal(replayedInDb?.status, "PENDING");
    assert.equal(replayedInDb?.attempts, 0);

    await prisma.outboxEvent.delete({ where: { id: deadEv.id } });
    console.log("  ✓ Test D Passed: Exactly 1 concurrent operator replay succeeded, second rejected");

    // -------------------------------------------------------------------------
    // Test E — Lease Reclamation
    // -------------------------------------------------------------------------
    console.log("  Running Test E — Lease Reclamation against PostgreSQL...");
    const expireEv = await prisma.outboxEvent.create({
      data: {
        organizationId: "org_real_test",
        eventType: "EMAIL_SEND_REQUESTED",
        aggregateType: "OutreachMessage",
        aggregateId: `msg_rec_${testRunId}`,
        idempotencyKey: `email:pg_rec_${testRunId}`,
        payload: {},
        status: "PROCESSING",
        leaseToken: `stale_${randomUUID()}`,
        leaseExpiresAt: new Date(Date.now() - 10000), // Expired 10 seconds ago
      },
    });

    // Worker B reclaims expired lease
    const tokenBReclaim = `active_${randomUUID()}`;
    const reclaimed = await prisma.outboxEvent.updateMany({
      where: {
        id: expireEv.id,
        status: "PROCESSING",
        leaseExpiresAt: { lte: new Date() },
      },
      data: {
        leaseToken: tokenBReclaim,
        leaseExpiresAt: new Date(Date.now() + 300000),
      },
    });

    assert.equal(reclaimed.count, 1, "Worker B MUST successfully reclaim expired lease");

    // Stale Worker A attempts completion with old leaseToken
    const staleCompletion = await prisma.outboxEvent.updateMany({
      where: {
        id: expireEv.id,
        status: "PROCESSING",
        leaseToken: expireEv.leaseToken,
      },
      data: { status: "SUCCEEDED" },
    });

    assert.equal(staleCompletion.count, 0, "Stale Worker A completion MUST affect 0 rows in PostgreSQL");

    await prisma.outboxEvent.delete({ where: { id: expireEv.id } });
    await prisma.outboxEvent.delete({ where: { id: eventIdB } });

    console.log("  ✓ Test E Passed: Worker B reclaimed expired lease, stale Worker A write blocked");

    console.log("✅ All Real PostgreSQL Integration Tests Passed Cleanly!");
  } catch (err) {
    console.error("Real PostgreSQL Test Error:", err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runRealPostgresTests();
