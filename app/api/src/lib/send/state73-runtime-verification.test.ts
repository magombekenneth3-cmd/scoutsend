import { test, describe, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../prisma";
import { finalizeReconciledIntent, finalizeSendIntent } from "./send-finalize.service";
import {
  claimSendIntentLease,
  renewSendIntentLease,
  assertSendIntentOwnership,
  transitionSendIntent,
  recordReconciledFailed,
  recordUnresolved,
  findStaleIntents,
} from "./send-intent.service";
import { transitionState } from "../state/transition-state";
import { QuotaScope, QuotaReservationStatus } from "@prisma/client";
import { randomUUID } from "crypto";
import { encryptJson } from "../mail/crypto";

// ---------------------------------------------------------------------------
// Raw-SQL helpers for columns that exist in the Prisma schema but NOT in
// the current DB (schema drift: OutreachMessage.senderMailboxId,
// SenderMailbox.spfValid). Using Prisma ORM on these models in SELECT/UPDATE
// causes P2022 "column does not exist". We use $queryRaw to avoid it.
// ---------------------------------------------------------------------------
async function readMailboxCurrentSent(mailboxId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ currentSent: number }[]>`
    SELECT "currentSent" FROM "SenderMailbox" WHERE "id" = ${mailboxId}
  `;
  return rows[0]?.currentSent ?? -1;
}

async function readOutreachDeliveryState(msgId: string): Promise<string> {
  const rows = await prisma.$queryRaw<{ deliveryState: string }[]>`
    SELECT "deliveryState"::text FROM "OutreachMessage" WHERE "id" = ${msgId}
  `;
  return rows[0]?.deliveryState ?? "NOT_FOUND";
}

async function readOutreachVersion(msgId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ version: number }[]>`
    SELECT "version" FROM "OutreachMessage" WHERE "id" = ${msgId}
  `;
  return rows[0]?.version ?? -1;
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/** UIDs of every fixture created in this run — cleaned up in afterEach. */
const createdUids: string[] = [];

async function createTestFixture(opts: {
  status?: string;
  leaseExpiresAt?: Date | null;
  claimedBy?: string | null;
  fencingEpoch?: number;
  leaseVersion?: number;
  updatedAt?: Date;
  msgDeliveryState?: string;
}) {
  const uid = randomUUID().substring(0, 8);
  const userId    = `user_test_${uid}`;
  const orgId     = `org_test_${uid}`;
  const campaignId = `camp_test_${uid}`;
  const leadId    = `lead_test_${uid}`;
  const domainId  = `dom_test_${uid}`;
  const mailboxId = `mb_test_${uid}`;
  const msgId     = `msg_test_${uid}`;
  const intentId  = `intent_test_${uid}`;
  const opId      = `op_test_${uid}`;
  const resId     = `res_test_${uid}`;
  const idempKey  = `idemp_test_${uid}`;

  // 1. User & Org
  await prisma.user.create({
    data: {
      id: userId,
      email: `user_${uid}@example.com`,
      passwordHash: "hash",
      firstName: "Test",
      lastName: "User",
    },
  });

  await prisma.organization.create({
    data: { id: orgId, name: `Test Org ${uid}`, slug: `test-org-${uid}` },
  });

  // 2. Campaign
  await prisma.campaign.create({
    data: {
      id: campaignId,
      orgId,
      createdById: userId,
      name: `Test Campaign ${uid}`,
      icpDescription: "Test ICP",
    },
  });

  // 3. Lead — raw SQL to avoid Prisma selecting non-existent columns
  await prisma.$executeRaw`
    INSERT INTO "Lead" ("id", "companyName", "campaignId", "email", "firstName", "lastName", "updatedAt", "createdAt")
    VALUES (${leadId}, ${`Company ${uid}`}, ${campaignId}, ${`lead_${uid}@example.com`}, 'Test', 'User', NOW(), NOW())
  `;

  // 4. SenderDomain & SenderMailbox — raw SQL to avoid P2022 on SenderMailbox.spfValid
  await prisma.senderDomain.create({
    data: { id: domainId, orgId, createdById: userId, domain: `testdomain-${uid}.com` },
  });

  // Must match SmtpCredentials interface exactly (types.ts:136-150).
  const encryptedCreds = encryptJson({
    type: "SMTP",
    smtpHost: "smtp.example.com",
    smtpPort: 587,
    secure: false,
    username: `box_${uid}@testdomain-${uid}.com`,
    password: "test-password-fixture",
  } satisfies import("../mail/types").SmtpCredentials);

  await prisma.$executeRaw`
    INSERT INTO "SenderMailbox" ("id", "orgId", "createdById", "emailAddress", "label", "providerType", "credentials", "currentSent", "updatedAt", "createdAt")
    VALUES (${mailboxId}, ${orgId}, ${userId}, ${`box_${uid}@testdomain-${uid}.com`}, ${`Box ${uid}`}, 'SMTP', to_jsonb(${encryptedCreds}::text), 0, NOW(), NOW())
  `;

  // 5. OutreachMessage — raw SQL to avoid P2022 on OutreachMessage.senderMailboxId
  const msgState = opts.msgDeliveryState ?? "SENDING";
  await prisma.$executeRaw`
    INSERT INTO "OutreachMessage" ("id", "leadId", "deliveryState", "subject", "body", "updatedAt", "createdAt")
    VALUES (${msgId}, ${leadId}, ${msgState}::"DeliveryState", 'Test Subject', 'Test Body', NOW(), NOW())
  `;

  // 6. QuotaReservation
  await prisma.quotaReservation.create({
    data: {
      id: resId,
      operationId: opId,
      scope: QuotaScope.MAILBOX,
      scopeId: mailboxId,
      amount: 1,
      windowStart: new Date(),
      expiresAt: new Date(Date.now() + 3600_000),
      status: QuotaReservationStatus.RESERVED,
    },
  });

  // 7. SendIntent
  // NOTE: version defaults to 1 in DB schema (not 0). All CAS proofs must use
  // the actual version read from the created record.
  const intent = await prisma.sendIntent.create({
    data: {
      id: intentId,
      operationId: opId,
      leadId,
      outreachMessageId: msgId,
      sequenceStep: 1,
      idempotencyKey: idempKey,
      status: (opts.status as any) || "RECONCILING",
      claimedBy: opts.claimedBy ?? null,
      fencingEpoch: opts.fencingEpoch ?? 0,
      leaseVersion: opts.leaseVersion ?? 0,
      leaseExpiresAt: opts.leaseExpiresAt ?? null,
      ...(opts.updatedAt && { updatedAt: opts.updatedAt }),
    },
  });

  // Register uid so afterEach cleanup deletes this fixture's rows.
  createdUids.push(uid);

  return {
    userId, orgId, campaignId, leadId, domainId, mailboxId,
    msgId, intentId, opId, resId, idempKey,
    intent,
    // version is always 1 as created (Prisma schema default = 1)
    intentVersion: intent.version,
  };
}

/** Delete all rows created by a single test fixture, in FK-safe order. */
async function cleanupFixture(uid: string): Promise<void> {
  // Delete in reverse-dependency order.
  // OutboxEvent references operationId (string), no FK constraint — safe direct delete.
  await prisma.$executeRaw`DELETE FROM "OutboxEvent"    WHERE "operationId" LIKE ${'op_test_' + uid + '%'}`;
  await prisma.$executeRaw`DELETE FROM "QuotaReservation" WHERE id LIKE ${'res_test_' + uid + '%'}`;
  await prisma.$executeRaw`DELETE FROM "SendIntent"     WHERE id LIKE ${'intent_test_' + uid + '%'}`;
  await prisma.$executeRaw`DELETE FROM "Operation"      WHERE "operationId" LIKE ${'op_test_' + uid + '%'}`;
  await prisma.$executeRaw`DELETE FROM "OutreachMessage" WHERE id LIKE ${'msg_test_' + uid + '%'}`;
  // Lead CASCADE-deletes from Campaign.
  await prisma.$executeRaw`DELETE FROM "Lead"           WHERE id LIKE ${'lead_test_' + uid + '%'}`;
  // SenderMailbox: Campaign/OutreachMessage FKs are SET NULL — safe to delete directly.
  await prisma.$executeRaw`DELETE FROM "SenderMailbox"  WHERE id LIKE ${'mb_test_' + uid + '%'}`;
  await prisma.$executeRaw`DELETE FROM "SenderDomain"   WHERE id LIKE ${'dom_test_' + uid + '%'}`;
  await prisma.$executeRaw`DELETE FROM "Campaign"       WHERE id LIKE ${'camp_test_' + uid + '%'}`;
  await prisma.$executeRaw`DELETE FROM "Organization"   WHERE id LIKE ${'org_test_' + uid + '%'}`;
  await prisma.$executeRaw`DELETE FROM "User"           WHERE id LIKE ${'user_test_' + uid + '%'}`;
}

describe("STATE 7.3 — SendIntent Pipeline Runtime Verification", () => {
  afterEach(async () => {
    // Clean up every fixture created in this test, even if the test failed.
    for (const uid of createdUids.splice(0)) {
      await cleanupFixture(uid).catch((err) =>
        console.error(`[test cleanup] failed for uid=${uid}`, err),
      );
    }
  });

  after(async () => {
    await prisma.$disconnect();
  });

  // -------------------------------------------------------------------------
  // 1. VERIFY FINALIZE/SETTLEMENT ATOMICITY
  // -------------------------------------------------------------------------
  test("1. Finalize settlement produces all-or-nothing atomic writes", async () => {
    const fx = await createTestFixture({ status: "RECONCILING" });
    const providerMsgId = `prov_msg_${randomUUID()}`;

    const result = await finalizeReconciledIntent({
      sendIntentId: fx.intentId,
      operationId: fx.opId,
      outreachMessageId: fx.msgId,
      expectedVersion: fx.intentVersion,   // must be actual DB version (1)
      nextState: "SENT",
      quotaSettlement: "CONSUMED",
      providerMessageId: providerMsgId,
    });

    assert.equal(result.success, true, `Expected success=true, got: ${JSON.stringify(result)}`);

    // Stage 1: SendIntent → SENT
    const updatedIntent = await prisma.sendIntent.findUnique({ where: { id: fx.intentId } });
    assert.equal(updatedIntent?.status, "SENT");
    assert.equal(updatedIntent?.providerMessageId, providerMsgId);

    // Stage 2: QuotaReservation → CONSUMED
    const updatedRes = await prisma.quotaReservation.findUnique({ where: { id: fx.resId } });
    assert.equal(updatedRes?.status, "CONSUMED");

    // Stage 3: currentSent incremented — raw SQL to avoid P2022
    const currentSent = await readMailboxCurrentSent(fx.mailboxId);
    assert.equal(currentSent, 1);

    // Stage 4: OutboxEvent created
    const outboxEvents = await prisma.outboxEvent.findMany({ where: { operationId: fx.opId } });
    assert.equal(outboxEvents.length, 1);
    assert.equal(outboxEvents[0].eventType, "SEND_INTENT_RECONCILED_SENT");

    // Stage 5: OutreachMessage delivery state updated — raw SQL to avoid P2022
    const msgState = await readOutreachDeliveryState(fx.msgId);
    assert.equal(msgState, "SENT");
  });

  test("1b. Failure injection inside finalize transaction causes complete rollback", async () => {
    const fx = await createTestFixture({ status: "RECONCILING" });

    // Pass wrong version to trigger CAS conflict (atomic failure at stage 1)
    const result = await finalizeReconciledIntent({
      sendIntentId: fx.intentId,
      operationId: fx.opId,
      outreachMessageId: fx.msgId,
      expectedVersion: fx.intentVersion + 999, // WRONG VERSION → CAS CONFLICT
      nextState: "SENT",
      quotaSettlement: "CONSUMED",
    });

    assert.equal(result.success, false);
    assert.equal((result as any).reason, "SEND_INTENT_CAS_CONFLICT");

    // Verify zero mutations occurred — all stages must be unchanged
    const intent = await prisma.sendIntent.findUnique({ where: { id: fx.intentId } });
    assert.equal(intent?.status, "RECONCILING", "SendIntent status must not have changed");

    const res = await prisma.quotaReservation.findUnique({ where: { id: fx.resId } });
    assert.equal(res?.status, "RESERVED", "QuotaReservation must not have been consumed");

    const currentSent = await readMailboxCurrentSent(fx.mailboxId);
    assert.equal(currentSent, 0, "currentSent must not have been incremented");

    const outbox = await prisma.outboxEvent.findMany({ where: { operationId: fx.opId } });
    assert.equal(outbox.length, 0, "No OutboxEvent must have been created");

    const msgState = await readOutreachDeliveryState(fx.msgId);
    assert.equal(msgState, "SENDING", "OutreachMessage deliveryState must not have changed");
  });

  // -------------------------------------------------------------------------
  // 2. VERIFY SETTLEMENT CONCURRENCY
  // -------------------------------------------------------------------------
  test("2. Concurrent finalizeReconciledIntent calls result in exactly 1 success and 1 CAS conflict", async () => {
    const fx = await createTestFixture({ status: "RECONCILING" });

    const [res1, res2] = await Promise.all([
      finalizeReconciledIntent({
        sendIntentId: fx.intentId,
        operationId: fx.opId,
        outreachMessageId: fx.msgId,
        expectedVersion: fx.intentVersion,
        nextState: "SENT",
        quotaSettlement: "CONSUMED",
        providerMessageId: "prov_concurrent_1",
      }),
      finalizeReconciledIntent({
        sendIntentId: fx.intentId,
        operationId: fx.opId,
        outreachMessageId: fx.msgId,
        expectedVersion: fx.intentVersion,
        nextState: "SENT",
        quotaSettlement: "CONSUMED",
        providerMessageId: "prov_concurrent_2",
      }),
    ]);

    const successes = [res1, res2].filter((r) => r.success);
    const failures  = [res1, res2].filter((r) => !r.success);

    assert.equal(successes.length, 1, "Exactly one settlement must succeed");
    assert.equal(failures.length, 1, "Exactly one settlement must be rejected");
    assert.equal((failures[0] as any).reason, "SEND_INTENT_CAS_CONFLICT");

    // SendIntent must be SENT exactly once
    const intent = await prisma.sendIntent.findUnique({ where: { id: fx.intentId } });
    assert.equal(intent?.status, "SENT");

    // currentSent must be incremented exactly once
    const currentSent = await readMailboxCurrentSent(fx.mailboxId);
    assert.equal(currentSent, 1, "currentSent must be incremented exactly once");

    // Exactly one OutboxEvent
    const outbox = await prisma.outboxEvent.findMany({ where: { operationId: fx.opId } });
    assert.equal(outbox.length, 1, "Exactly one OutboxEvent must exist");
  });

  // -------------------------------------------------------------------------
  // 3. VERIFY LEASE TAKEOVER CAS
  // -------------------------------------------------------------------------
  test("3. Concurrent stale lease takeovers: exactly 1 succeeds, second is rejected", async () => {
    const past = new Date(Date.now() - 120_000);
    const fx = await createTestFixture({
      status: "DISPATCHING",
      claimedBy: "old_worker",
      fencingEpoch: 1,
      leaseVersion: 1,
      leaseExpiresAt: past,
    });

    const [claim1, claim2] = await Promise.all([
      claimSendIntentLease({ sendIntentId: fx.intentId, workerId: "worker_new_1" }),
      claimSendIntentLease({ sendIntentId: fx.intentId, workerId: "worker_new_2" }),
    ]);

    const granted  = [claim1, claim2].filter((c) => c.granted);
    const rejected = [claim1, claim2].filter((c) => !c.granted);

    // Exactly one worker must win the takeover
    assert.equal(granted.length, 1, "Exactly one claim must be granted");
    assert.equal(rejected.length, 1, "Exactly one claim must be rejected");

    // The rejected worker gets CAS_CONFLICT (version predicate) or LEASE_HELD (active lease
    // written by the winning worker). Both are correct serialization outcomes.
    const rejectedReason = (rejected[0] as any).reason;
    assert.ok(
      rejectedReason === "CAS_CONFLICT" || rejectedReason === "LEASE_HELD",
      `Expected CAS_CONFLICT or LEASE_HELD, got: ${rejectedReason}`,
    );

    // Fencing epoch must have advanced exactly once
    const finalIntent = await prisma.sendIntent.findUnique({ where: { id: fx.intentId } });
    assert.equal(finalIntent?.fencingEpoch, 2, "fencingEpoch must have advanced to 2");
    assert.equal(finalIntent?.claimedBy, granted[0].granted ? (granted[0] as any).lease.claimedBy : "unknown");
  });

  // -------------------------------------------------------------------------
  // 4. VERIFY LEASE OWNERSHIP / FENCING
  // -------------------------------------------------------------------------
  test("4. Stale worker is fenced out after takeover by new worker", async () => {
    const past = new Date(Date.now() - 120_000);
    const fx = await createTestFixture({
      status: "DISPATCHING",
      claimedBy: "worker_A",
      fencingEpoch: 1,
      leaseVersion: 1,
      leaseExpiresAt: past,
    });

    const claimB = await claimSendIntentLease({ sendIntentId: fx.intentId, workerId: "worker_B" });
    assert.equal(claimB.granted, true, "worker_B must win the takeover");
    if (!claimB.granted) return;

    assert.equal(claimB.lease.fencingEpoch, 2, "worker_B must hold new fencingEpoch=2");

    // worker_A asserting ownership must fail
    await assert.rejects(
      async () => {
        await assertSendIntentOwnership({
          sendIntentId: fx.intentId,
          workerId: "worker_A",
          fencingEpoch: 1,
          leaseVersion: 1,
        });
      },
      (err: any) =>
        err.message.includes("claimed by worker_B") ||
        err.message.includes("Fencing violation"),
      "worker_A ownership assertion must throw",
    );

    // worker_A renewing must fail
    const renewA = await renewSendIntentLease({
      sendIntentId: fx.intentId,
      workerId: "worker_A",
      fencingEpoch: 1,
      leaseVersion: 1,
    });
    assert.equal(renewA.renewed, false, "Stale worker_A renewal must fail");

    // worker_A transitioning must fail
    const transA = await transitionSendIntent({
      sendIntentId: fx.intentId,
      expectedState: "DISPATCHING",
      nextState: "SENT",
      expectedVersion: fx.intentVersion,
      workerId: "worker_A",
      fencingEpoch: 1,
      leaseVersion: 1,
      operationId: fx.opId,
    });
    assert.equal(transA.success, false, "Stale worker_A state transition must fail");

    // Intent must still be claimed by worker_B
    const currentIntent = await prisma.sendIntent.findUnique({ where: { id: fx.intentId } });
    assert.equal(currentIntent?.claimedBy, "worker_B");
    assert.equal(currentIntent?.fencingEpoch, 2);
  });

  // -------------------------------------------------------------------------
  // 5. VERIFY OUTREACHMESSAGE CAS RECOVERY
  // -------------------------------------------------------------------------
  test("5. Concurrent OutreachMessage transition enforces CAS — only one wins", async () => {
    // DISPATCHING → SENT: canonical send-path state in the registry.
    // DeliveryState enum now includes DISPATCHING (migration 20260817000000_fix_schema_drift).
    const fx = await createTestFixture({ msgDeliveryState: "DISPATCHING" });

    const [t1, t2] = await Promise.all([
      transitionState(prisma, {
        model: "OutreachMessage",
        entityId: fx.msgId,
        expectedState: "DISPATCHING",
        expectedVersion: 1,
        nextState: "SENT",
        authority: { actorType: "WORKER", actorId: "w1" },
      }),
      transitionState(prisma, {
        model: "OutreachMessage",
        entityId: fx.msgId,
        expectedState: "DISPATCHING",
        expectedVersion: 1,
        nextState: "SENT",
        authority: { actorType: "WORKER", actorId: "w2" },
      }),
    ]);

    const succ = [t1, t2].filter((t) => t.success);
    const fail = [t1, t2].filter((t) => !t.success);

    assert.equal(succ.length, 1, "Exactly one transition must succeed");
    assert.equal(fail.length, 1, "Exactly one transition must fail");
    assert.equal(fail[0].reason, "CAS_CONFLICT", "Failed transition must be CAS_CONFLICT");

    const finalState = await readOutreachDeliveryState(fx.msgId);
    assert.equal(finalState, "SENT");

    const finalVersion = await readOutreachVersion(fx.msgId);
    assert.equal(finalVersion, 2, "version must have incremented exactly once");

    // Stale revert: DISPATCHING on an already-SENT message → illegal
    const staleRevert = await transitionState(prisma, {
      model: "OutreachMessage",
      entityId: fx.msgId,
      expectedState: "DISPATCHING",
      expectedVersion: 2,
      nextState: "SENT",
      authority: { actorType: "WORKER", actorId: "stale" },
    });
    assert.equal(staleRevert.success, false, "Stale revert must fail");
    assert.ok(
      staleRevert.reason === "ILLEGAL_TRANSITION" || staleRevert.reason === "CAS_CONFLICT",
      `Expected ILLEGAL_TRANSITION or CAS_CONFLICT, got: ${staleRevert.reason}`,
    );
  });



  // -------------------------------------------------------------------------
  // 6. VERIFY recordReconciledFailed ATOMICITY
  // -------------------------------------------------------------------------
  test("6. recordReconciledFailed executes status + errorMessage atomically inside a transaction", async () => {
    const fx = await createTestFixture({ status: "DISPATCHING" });

    await recordReconciledFailed(fx.idempKey, "Test reconciliation failure reason");

    const updated = await prisma.sendIntent.findUnique({ where: { id: fx.intentId } });
    assert.equal(updated?.status, "FAILED");
    assert.equal(updated?.errorMessage, "Test reconciliation failure reason");

    // Second call is idempotent — CAS prevents overwrite of already-terminal state
    await recordReconciledFailed(fx.idempKey, "Second reason — must not overwrite");
    const updated2 = await prisma.sendIntent.findUnique({ where: { id: fx.intentId } });
    assert.equal(
      updated2?.errorMessage,
      "Test reconciliation failure reason",
      "errorMessage must not be overwritten after terminal state",
    );
  });

  // -------------------------------------------------------------------------
  // 7. VERIFY UNRESOLVED STATE
  // -------------------------------------------------------------------------
  test("7. recordUnresolved writes UNRESOLVED state which persists and is omitted from findStaleIntents", async () => {
    // UNRESOLVED is only reachable from RECONCILING (registry: RECONCILING → UNRESOLVED).
    // recordUnresolved transitions from the intent's current status to UNRESOLVED.
    // The fixture must start in RECONCILING so that RECONCILING → UNRESOLVED is legal.
    const fx = await createTestFixture({ status: "RECONCILING" });

    await recordUnresolved(fx.idempKey);

    const intentInDb = await prisma.sendIntent.findUnique({ where: { id: fx.intentId } });
    assert.equal(intentInDb?.status, "UNRESOLVED", "recordUnresolved must write UNRESOLVED status");

    // UNRESOLVED intents must NOT be selected by findStaleIntents (which looks for DISPATCHING | UNKNOWN)
    const staleList = await findStaleIntents(0); // 0-minute cutoff selects everything
    const found = staleList.find((i) => i.id === fx.intentId);
    assert.equal(found, undefined, "UNRESOLVED intent must NOT appear in findStaleIntents");
  });

  // -------------------------------------------------------------------------
  // 8. VERIFY FENCED MODEL SAFETY
  // -------------------------------------------------------------------------
  test("8. transitionState with unsupported fenced model throws UNSUPPORTED_FENCED_MODEL with zero DB mutation", async () => {
    const fx = await createTestFixture({ status: "DISPATCHING" });

    // SendIntent supports fenced CAS. Using a model that does NOT support fencing
    // (e.g. Campaign) with a fencing proof triggers the UNSUPPORTED_FENCED_MODEL guard.
    // CampaignRun is the only other fenced model; Campaign/QuotaReservation/Operation are
    // NOT fenced. Use Campaign as the unsupported fenced target.
    await assert.rejects(
      async () => {
        await transitionState(prisma, {
          model: "Campaign",
          entityId: fx.campaignId,
          expectedState: "DRAFT",
          expectedVersion: 1,
          nextState: "RESEARCHING",
          authority: { actorType: "WORKER", actorId: "w1" },
          fencing: { fencingEpoch: 1, leaseVersion: 1 },
        });
      },
      (err: any) => {
        assert.ok(
          err.message.includes("UNSUPPORTED_FENCED_MODEL"),
          `Expected UNSUPPORTED_FENCED_MODEL, got: ${err.message}`,
        );
        return true;
      },
    );

    // Verify zero mutation — Campaign status must still be DRAFT
    const campaign = await prisma.campaign.findUnique({
      where: { id: fx.campaignId },
      select: { status: true },
    });
    assert.equal(campaign?.status, "DRAFT", "Campaign must not have been mutated");
  });

  // -------------------------------------------------------------------------
  // 9. VERIFY IDEMPOTENCY / OUTBOX
  // -------------------------------------------------------------------------
  test("9. Finalizing the same SendIntent twice is idempotent — no duplicate quota or outbox", async () => {
    const fx = await createTestFixture({ status: "RECONCILING" });

    const first = await finalizeReconciledIntent({
      sendIntentId: fx.intentId,
      operationId: fx.opId,
      outreachMessageId: fx.msgId,
      expectedVersion: fx.intentVersion,
      nextState: "SENT",
      quotaSettlement: "CONSUMED",
      providerMessageId: "prov_idemp",
    });

    assert.equal(first.success, true, "First finalization must succeed");

    // Second attempt: version is now stale (incremented by first finalize)
    const second = await finalizeReconciledIntent({
      sendIntentId: fx.intentId,
      operationId: fx.opId,
      outreachMessageId: fx.msgId,
      expectedVersion: fx.intentVersion, // stale version — CAS will reject
      nextState: "SENT",
      quotaSettlement: "CONSUMED",
      providerMessageId: "prov_idemp",
    });

    assert.equal(second.success, false, "Second finalization must fail");
    assert.equal((second as any).reason, "SEND_INTENT_CAS_CONFLICT");

    // currentSent must be exactly 1 — not 2
    const currentSent = await readMailboxCurrentSent(fx.mailboxId);
    assert.equal(currentSent, 1, "currentSent must be incremented exactly once");

    // Exactly one OutboxEvent — idempotent INSERT
    const outbox = await prisma.outboxEvent.findMany({ where: { operationId: fx.opId } });
    assert.equal(outbox.length, 1, "Exactly one OutboxEvent must exist");
  });

  // -------------------------------------------------------------------------
  // 10. VERIFY PHYSICAL DATABASE CATALOG
  // -------------------------------------------------------------------------
  test("10. Physical DB catalog: SendIntent has all required columns, indexes, and enum values", async () => {
    // SendIntent required columns
    const siCols = await prisma.$queryRaw<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'SendIntent'
    `;
    const siColNames = siCols.map((c) => c.column_name);

    const requiredSendIntentCols = [
      "traceId", "provider", "payloadHash", "lastAttemptAt",
      "claimedBy", "fencingEpoch", "leaseVersion", "leaseExpiresAt",
      "reconciliationAttempts", "version",
    ];
    for (const col of requiredSendIntentCols) {
      assert.ok(siColNames.includes(col), `SendIntent must have column: ${col}`);
    }

    // SendIntentStatus must have exactly 9 values
    const enumVals = await prisma.$queryRaw<{ enumlabel: string }[]>`
      SELECT enumlabel FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'SendIntentStatus'
      ORDER BY e.enumsortorder
    `;
    const enumLabels = enumVals.map((v) => v.enumlabel);
    const expectedStatuses = [
      "PENDING", "DISPATCHING", "ACCEPTED", "SENT", "FAILED",
      "UNKNOWN", "RECONCILING", "UNRESOLVED", "HUMAN_REVIEW",
    ];
    for (const s of expectedStatuses) {
      assert.ok(enumLabels.includes(s), `SendIntentStatus must contain: ${s}`);
    }
    assert.equal(enumLabels.length, 9, "SendIntentStatus must have exactly 9 values");

    // Required indexes
    const idxs = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'SendIntent'
      ORDER BY indexname
    `;
    const idxNames = idxs.map((i) => i.indexname);
    const requiredIndexes = [
      "SendIntent_claimedBy_leaseExpiresAt_idx",
      "SendIntent_status_leaseExpiresAt_idx",
      "SendIntent_status_reconciliationAttempts_updatedAt_idx",
    ];
    for (const idx of requiredIndexes) {
      assert.ok(idxNames.includes(idx), `Required index must exist: ${idx}`);
    }
  });

  // -------------------------------------------------------------------------
  // 11. RUNTIME PATH VERIFICATION
  // -------------------------------------------------------------------------
  test("11. Complete SendIntent runtime path: create -> claim -> renew -> finalize", async () => {
    const fx = await createTestFixture({ status: "PENDING" });

    // Step 1: claimSendIntentLease (PENDING → DISPATCHING)
    const claim = await claimSendIntentLease({ sendIntentId: fx.intentId, workerId: "worker_flow_1" });
    assert.equal(claim.granted, true, "claimSendIntentLease must succeed");
    if (!claim.granted) return;

    // Step 2: renewSendIntentLease
    const renew = await renewSendIntentLease({
      sendIntentId: fx.intentId,
      workerId: "worker_flow_1",
      fencingEpoch: claim.lease.fencingEpoch,
      leaseVersion: claim.lease.leaseVersion,
    });
    assert.equal(renew.renewed, true, "renewSendIntentLease must succeed");

    // Step 3: finalizeSendIntent (DISPATCHING → SENT, full atomic settlement)
    const finalized = await finalizeSendIntent({
      sendIntentId: fx.intentId,
      operationId: fx.opId,
      outreachMessageId: fx.msgId,
      workerId: "worker_flow_1",
      expectedVersion: claim.lease.version,
      fencingEpoch: claim.lease.fencingEpoch,
      leaseVersion: renew.nextLeaseVersion,
      nextState: "SENT",
      quotaSettlement: "CONSUMED",
      providerMessageId: "prov_flow_999",
    });
    assert.equal(finalized.success, true, `finalizeSendIntent must succeed, got: ${JSON.stringify(finalized)}`);

    // Verify final state in DB
    const finalDbIntent = await prisma.sendIntent.findUnique({ where: { id: fx.intentId } });
    assert.equal(finalDbIntent?.status, "SENT");
    assert.equal(finalDbIntent?.providerMessageId, "prov_flow_999");

    // currentSent incremented
    const currentSent = await readMailboxCurrentSent(fx.mailboxId);
    assert.equal(currentSent, 1);
  });
});
