import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../../lib/prisma";
import {
  inspectDeadLetterEvents,
  replayDeadLetterEvent,
  getOutboxHealthEngineStatus,
  OutboxOperatorError,
} from "./outbox-operator.service";
import { processOutboxEvent, registerProviderDeliveryHandler, resetProviderDeliveryHandler } from "./outbox.dispatcher";
import { createOutboxEvent } from "./outbox.service";

console.log("Running Sprint 11 Live PostgreSQL Observability & Multi-Tenant Integration Tests...");

async function runRealDbObservabilityTests() {
  const testRunId = randomUUID().slice(0, 8);
  const tenantA = `org_test_a_${testRunId}`;
  const tenantB = `org_test_b_${testRunId}`;

  try {
    // -------------------------------------------------------------------------
    // Test 1: Deterministic Tenancy Backfill & Mandatory Tenant Isolation
    // -------------------------------------------------------------------------
    console.log("  Running Test 1: Mandatory Tenant Isolation & Inspection...");
    const deadEvA = await prisma.outboxEvent.create({
      data: {
        organizationId: tenantA,
        eventType: "EMAIL_SEND_REQUESTED",
        aggregateType: "OutreachMessage",
        aggregateId: `msg_a_${testRunId}`,
        idempotencyKey: `email:a_${testRunId}`,
        payload: { msg: "Tenant A Event" },
        status: "DEAD_LETTER",
        attempts: 5,
        lastError: "Tenant A Provider Failure",
      },
    });

    const deadEvB = await prisma.outboxEvent.create({
      data: {
        organizationId: tenantB,
        eventType: "EMAIL_SEND_REQUESTED",
        aggregateType: "OutreachMessage",
        aggregateId: `msg_b_${testRunId}`,
        idempotencyKey: `email:b_${testRunId}`,
        payload: { msg: "Tenant B Event" },
        status: "DEAD_LETTER",
        attempts: 5,
        lastError: "Tenant B Provider Failure",
      },
    });

    // Inspect Tenant A -> returns only Tenant A event
    const inspectA = await inspectDeadLetterEvents({ organizationId: tenantA });
    assert.equal(inspectA.length, 1);
    assert.equal(inspectA[0].id, deadEvA.id);

    // Tenant B operator attempts to replay Tenant A event -> REJECTED with OutboxOperatorError
    await assert.rejects(
      async () => {
        await replayDeadLetterEvent({
          eventId: deadEvA.id,
          organizationId: tenantB,
          operatorId: "op_tenant_b",
          reason: "Cross-tenant intrusion test",
        });
      },
      (err: any) => err instanceof OutboxOperatorError && err.message.includes("Access denied"),
      "Tenant B operator MUST be denied access to Tenant A event",
    );

    console.log("  ✓ Test 1 Passed: Tenant isolation enforced on inspection and replay");

    // -------------------------------------------------------------------------
    // Test 2: Atomic TOCTOU Replay & Immutable Audit Trail
    // -------------------------------------------------------------------------
    console.log("  Running Test 2: Atomic TOCTOU Replay & Immutable Audit Log...");
    const replayRes = await replayDeadLetterEvent({
      eventId: deadEvA.id,
      organizationId: tenantA,
      operatorId: "op_tenant_a",
      reason: "Legitimate Tenant A operator replay",
    });

    assert.equal(replayRes.success, true);
    assert.ok(replayRes.auditId);

    // Verify OutboxEvent state reset in PostgreSQL
    const replayedEv = await prisma.outboxEvent.findUnique({ where: { id: deadEvA.id } });
    assert.equal(replayedEv?.status, "PENDING");
    assert.equal(replayedEv?.attempts, 0);
    assert.equal(replayedEv?.lastError, null);

    // Verify OutboxOperatorAudit log in PostgreSQL
    const auditRecord = await prisma.outboxOperatorAudit.findUnique({ where: { id: replayRes.auditId } });
    assert.equal(auditRecord?.organizationId, tenantA);
    assert.equal(auditRecord?.outboxEventId, deadEvA.id);
    assert.equal(auditRecord?.operatorId, "op_tenant_a");
    assert.equal(auditRecord?.previousStatus, "DEAD_LETTER");
    assert.equal(auditRecord?.resultingStatus, "PENDING");
    assert.equal(auditRecord?.previousAttempts, 5);
    assert.equal(auditRecord?.previousLastError, "Tenant A Provider Failure");

    console.log("  ✓ Test 2 Passed: Replay atomically reset OutboxEvent and created OutboxOperatorAudit log");

    // -------------------------------------------------------------------------
    // Test 3: ProviderDeliveryAttempt Unique Constraint & Forensic Tracking
    // -------------------------------------------------------------------------
    console.log("  Running Test 3: ProviderDeliveryAttempt Unique Constraint & Forensic Tracking...");
    registerProviderDeliveryHandler(async () => {
      return { success: true, statusCode: 200, providerMessageId: "msg_ext_123" } as any;
    });

    const pendingEv = await prisma.outboxEvent.create({
      data: {
        organizationId: tenantA,
        eventType: "EMAIL_SEND_REQUESTED",
        aggregateType: "OutreachMessage",
        aggregateId: `msg_disp_${testRunId}`,
        idempotencyKey: `email:disp_${testRunId}`,
        payload: {},
        status: "PENDING",
      },
    });

    const dispatchSuccess = await processOutboxEvent(pendingEv.id);
    assert.equal(dispatchSuccess, true);

    const attemptsInDb = await prisma.providerDeliveryAttempt.findMany({
      where: { outboxEventId: pendingEv.id },
    });
    assert.equal(attemptsInDb.length, 1);
    assert.equal(attemptsInDb[0].organizationId, tenantA);
    assert.equal(attemptsInDb[0].attemptNumber, 1);
    assert.equal(attemptsInDb[0].outcome, "SUCCESS");
    assert.equal(attemptsInDb[0].statusCode, 200);
    assert.equal(attemptsInDb[0].providerMessageId, "msg_ext_123");

    resetProviderDeliveryHandler();
    console.log("  ✓ Test 3 Passed: ProviderDeliveryAttempt persisted with attemptNumber, status, and providerMessageId");

    // -------------------------------------------------------------------------
    // Test 4: Post-Crash Attempt Forensics (PROCESSING Unresolved State)
    // -------------------------------------------------------------------------
    console.log("  Running Test 4: Post-Crash Attempt Forensics...");
    const crashEv = await prisma.outboxEvent.create({
      data: {
        organizationId: tenantA,
        eventType: "EMAIL_SEND_REQUESTED",
        aggregateType: "OutreachMessage",
        aggregateId: `msg_crash_${testRunId}`,
        idempotencyKey: `email:crash_${testRunId}`,
        payload: {},
        status: "PENDING",
      },
    });

    // Simulate worker crash during provider delivery by throwing inside handler
    registerProviderDeliveryHandler(async () => {
      throw new Error("Simulated Process Crash");
    });

    await processOutboxEvent(crashEv.id).catch(() => {});

    const crashAttempt = await prisma.providerDeliveryAttempt.findFirst({
      where: { outboxEventId: crashEv.id, attemptNumber: 1 },
    });
    assert.ok(crashAttempt);
    assert.equal(crashAttempt?.outcome, "RETRYABLE_ERROR");

    resetProviderDeliveryHandler();
    console.log("  ✓ Test 4 Passed: Post-crash attempt record preserved for forensic duplicate delivery tracking");

    // -------------------------------------------------------------------------
    // Test 5: 3-Window Health Engine Verification
    // -------------------------------------------------------------------------
    console.log("  Running Test 5: 3-Window Health Engine Verification against PostgreSQL...");
    const health = await getOutboxHealthEngineStatus({ organizationId: tenantA });

    assert.equal(health.organizationId, tenantA);
    assert.ok(health.state === "HEALTHY" || health.state === "DEGRADED" || health.state === "CRITICAL");
    assert.ok(health.current);
    assert.ok(health.windows.current);
    assert.ok(health.windows.shortTerm);
    assert.ok(health.windows.longTerm);

    console.log("  ✓ Test 5 Passed: 3-window health engine computed deterministic health status");

    // -------------------------------------------------------------------------
    // Test 6: Post-Provider-Send Worker Crash & Recovery Forensics
    // -------------------------------------------------------------------------
    console.log("  Running Test 6: Post-Provider-Send Worker Crash & Forensic Recovery...");
    const postSendCrashEv = await prisma.outboxEvent.create({
      data: {
        organizationId: tenantA,
        eventType: "EMAIL_SEND_REQUESTED",
        aggregateType: "OutreachMessage",
        aggregateId: `msg_post_crash_${testRunId}`,
        idempotencyKey: `email:post_crash_${testRunId}`,
        payload: {},
        status: "PENDING",
      },
    });

    // Simulate Worker 1: claims event (attempt #1), creates ProviderDeliveryAttempt(PROCESSING),
    // succeeds at provider call, BUT crashes before updating OutboxEvent in PostgreSQL.
    const worker1LeaseToken = `lease_w1_${randomUUID()}`;
    await prisma.outboxEvent.update({
      where: { id: postSendCrashEv.id },
      data: {
        status: "PROCESSING",
        leaseToken: worker1LeaseToken,
        leaseExpiresAt: new Date(Date.now() - 5000), // Lease expired 5s ago (worker crashed)
        attempts: 1,
      },
    });

    await prisma.providerDeliveryAttempt.create({
      data: {
        organizationId: tenantA,
        outboxEventId: postSendCrashEv.id,
        attemptNumber: 1,
        leaseToken: worker1LeaseToken,
        workerId: "worker_1",
        provider: "GMAIL",
        outcome: "PROCESSING", // Unresolved forensic artifact
        startedAt: new Date(Date.now() - 30000),
      },
    });

    // Worker 2 reclaims expired lease via processOutboxEvent (attempt #2)
    registerProviderDeliveryHandler(async () => {
      return { success: true, statusCode: 200, providerMessageId: "msg_w2_success_1000" } as any;
    });

    const worker2Success = await processOutboxEvent(postSendCrashEv.id);
    assert.equal(worker2Success, true);

    // Verify OutboxEvent state is SUCCEEDED
    const finalEv = await prisma.outboxEvent.findUnique({ where: { id: postSendCrashEv.id } });
    assert.equal(finalEv?.status, "SUCCEEDED");

    // Forensic Investigation Verification:
    // Attempt #1 MUST remain in PROCESSING state (unresolved post-crash artifact)
    // Attempt #2 MUST be SUCCESS with worker 2 provider message ID
    const attempts = await prisma.providerDeliveryAttempt.findMany({
      where: { outboxEventId: postSendCrashEv.id },
      orderBy: { attemptNumber: "asc" },
    });

    assert.equal(attempts.length, 2);
    assert.equal(attempts[0].attemptNumber, 1);
    assert.equal(attempts[0].outcome, "PROCESSING");
    assert.equal(attempts[0].workerId, "worker_1");

    assert.equal(attempts[1].attemptNumber, 2);
    assert.equal(attempts[1].outcome, "SUCCESS");
    assert.equal(attempts[1].providerMessageId, "msg_w2_success_1000");

    resetProviderDeliveryHandler();
    console.log("  ✓ Test 6 Passed: Post-provider-send worker crash leaves attempt #1 in PROCESSING state, Worker 2 completes under attempt #2");

    // -------------------------------------------------------------------------
    // Test 6B: Pre-Response Worker Crash Forensics (providerMessageId = null)
    // -------------------------------------------------------------------------
    console.log("  Running Test 6B: Pre-Response Worker Crash Forensics (Null ProviderMessageId)...");
    const preResponseCrashEv = await prisma.outboxEvent.create({
      data: {
        organizationId: tenantA,
        eventType: "EMAIL_SEND_REQUESTED",
        aggregateType: "OutreachMessage",
        aggregateId: `msg_pre_resp_${testRunId}`,
        idempotencyKey: `email:pre_resp_${testRunId}`,
        payload: {},
        status: "PENDING",
      },
    });

    const w1Token = `lease_w1_no_resp_${randomUUID()}`;
    await prisma.outboxEvent.update({
      where: { id: preResponseCrashEv.id },
      data: {
        status: "PROCESSING",
        leaseToken: w1Token,
        leaseExpiresAt: new Date(Date.now() - 5000),
        attempts: 1,
      },
    });

    // Worker 1 crashed BEFORE receiving response -> providerMessageId is null
    await prisma.providerDeliveryAttempt.create({
      data: {
        organizationId: tenantA,
        outboxEventId: preResponseCrashEv.id,
        attemptNumber: 1,
        leaseToken: w1Token,
        workerId: "worker_1_no_resp",
        provider: "GMAIL",
        outcome: "PROCESSING",
        providerMessageId: null, // Null providerMessageId
        startedAt: new Date(Date.now() - 30000),
      },
    });

    registerProviderDeliveryHandler(async () => {
      return { success: true, statusCode: 200, providerMessageId: "msg_w2_recovered_2000" } as any;
    });

    const w2Recovered = await processOutboxEvent(preResponseCrashEv.id);
    assert.equal(w2Recovered, true);

    const attempts6B = await prisma.providerDeliveryAttempt.findMany({
      where: { outboxEventId: preResponseCrashEv.id },
      orderBy: { attemptNumber: "asc" },
    });

    assert.equal(attempts6B.length, 2);
    assert.equal(attempts6B[0].outcome, "PROCESSING");
    assert.equal(attempts6B[0].providerMessageId, null);
    assert.equal(attempts6B[1].outcome, "SUCCESS");
    assert.equal(attempts6B[1].providerMessageId, "msg_w2_recovered_2000");

    resetProviderDeliveryHandler();
    console.log("  ✓ Test 6B Passed: Pre-response crash correctly logged with providerMessageId = null, Worker 2 recovered");

    // -------------------------------------------------------------------------
    // Test 7: Hostile Fail-Closed Tenancy Migration Test
    // -------------------------------------------------------------------------
    console.log("  Running Test 7: Hostile Fail-Closed Tenancy Migration Test...");
    // Run the migration backfill and assertion inside a transaction that temporarily drops NOT NULL
    await assert.rejects(
      async () => {
        await prisma.$transaction(async (tx) => {
          // 1. Simulate step 1 of migration: allow NULL organizationId temporarily during backfill
          await tx.$executeRawUnsafe(`ALTER TABLE "OutboxEvent" ALTER COLUMN "organizationId" DROP NOT NULL;`);

          // 2. Insert unresolvable orphan OutboxEvent with organizationId = NULL
          await tx.$executeRawUnsafe(
            `INSERT INTO "OutboxEvent" ("id", "aggregateType", "aggregateId", "eventType", "payload", "idempotencyKey", "status", "organizationId")
             VALUES ('orphan_${testRunId}', 'UNRESOLVABLE_ORPHAN', 'orphan_id', 'ORPHAN_EVENT', '{}', 'idemp_orphan_${testRunId}', 'PENDING', NULL);`
          );

          // 3. Run strict backfill queries (no fallback default org)
          await tx.$executeRawUnsafe(
            `UPDATE "OutboxEvent" e
             SET "organizationId" = (
               SELECT c."orgId"
               FROM "OutreachMessage" m
               JOIN "Lead" l ON l."id" = m."leadId"
               JOIN "Campaign" c ON c."id" = l."campaignId"
               WHERE m."id" = e."aggregateId" AND c."orgId" IS NOT NULL
               LIMIT 1
             )
             WHERE e."organizationId" IS NULL AND e."aggregateType" = 'OutreachMessage';`
          );

          // 4. Fail-closed assertion check (MUST THROW EXCEPTION AND ROLLBACK)
          await tx.$executeRawUnsafe(
            `DO $$
             BEGIN
               IF EXISTS (SELECT 1 FROM "OutboxEvent" WHERE "organizationId" IS NULL) THEN
                 RAISE EXCEPTION 'Migration failed: OutboxEvent contains unresolvable organizationId rows';
               END IF;
             END $$;`
          );

          // 5. Enforce NOT NULL (unreachable because step 4 throws)
          await tx.$executeRawUnsafe(`ALTER TABLE "OutboxEvent" ALTER COLUMN "organizationId" SET NOT NULL;`);
        });
      },
      (err: any) => err.message.includes("Migration failed: OutboxEvent contains unresolvable organizationId rows"),
      "Strict migration check MUST raise exception and abort when an unresolvable orphan OutboxEvent exists",
    );

    console.log("  ✓ Test 7 Passed: Hostile migration failed closed when unresolvable orphan event was present");

    // Cleanup test records
    await prisma.outboxOperatorAudit.deleteMany({ where: { organizationId: { in: [tenantA, tenantB] } } });
    await prisma.providerDeliveryAttempt.deleteMany({ where: { organizationId: { in: [tenantA, tenantB] } } });
    await prisma.outboxFencingIncident.deleteMany({ where: { organizationId: { in: [tenantA, tenantB] } } });
    await prisma.outboxEvent.deleteMany({ where: { organizationId: { in: [tenantA, tenantB] } } });

    console.log("✅ All Sprint 11 Real PostgreSQL Integration Tests Passed Cleanly!");
  } catch (err) {
    console.error("Sprint 11 Real PostgreSQL Test Error:", err);
    process.exit(1);
  }
}

runRealDbObservabilityTests();
