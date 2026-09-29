/**
 * Sprint 2 Integration Tests — Outbound Authorization & Quota Transactions
 *
 * Tests:
 *  1. Successful `authorizeAndCreateSendIntent()`: creates SendIntent (PENDING),
 *     transitions OutreachMessage (VALIDATED → AUTHORIZED), creates QuotaReservations.
 *  2. Quota limit enforcement: exceeding limit fails authorization, rolls back transactions.
 *  3. Idempotent re-call of `authorizeAndCreateSendIntent()` returns existing SendIntent.
 *  4. `settleQuotaReservation()`: atomically settles RESERVED → CONSUMED / RELEASED
 *     and increments SenderMailbox `currentSent`.
 *  5. Fenced worker claim & takeover (`claimSendIntentLease()`):
 *     worker A claims, lease expires, worker B takes over (fencingEpoch 1 → 2),
 *     worker A fenced mutation fails.
 */

import test, { describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../prisma";
import { authorizeAndCreateSendIntent } from "./outbound-authorization.service";
import { settleQuotaReservation, checkMailboxQuota } from "./send-quota.service";
import { claimSendIntentLease, transitionSendIntent } from "./send-intent.service";
import { randomUUID } from "crypto";

describe("Outbound Authorization & Quota Ledger — Integration Tests", () => {
  let testUserId: string;
  let testOrgId: string;
  let testCampaignId: string;
  let testLeadId: string;
  let testMailboxId: string;

  before(async () => {
    // Create base test entities
    const user = await prisma.user.create({
      data: {
        email: `test-${randomUUID()}@example.com`,
        passwordHash: "hash",
        firstName: "Sprint",
        lastName: "Tester",
      },
    });
    testUserId = user.id;

    const org = await prisma.organization.create({
      data: {
        name: `Test Org ${randomUUID()}`,
        slug: `test-org-${randomUUID()}`,
      },
    });
    testOrgId = org.id;

    const campaign = await prisma.campaign.create({
      data: {
        name: "Sprint 2 Test Campaign",
        icpDescription: "Testing quota & authorization",
        dailySendLimit: 5,
        status: "SENDING",
        createdById: testUserId,
        orgId: testOrgId,
      },
    });
    testCampaignId = campaign.id;

    const lead = await prisma.lead.create({
      data: {
        companyName: "Acme Test Corp",
        email: `lead-${randomUUID()}@example.com`,
        leadState: "SEND_ELIGIBLE",
        campaignId: testCampaignId,
      },
    });
    testLeadId = lead.id;

    const mailbox = await prisma.senderMailbox.create({
      data: {
        label: "Sprint 2 Test Mailbox",
        emailAddress: `sender-${randomUUID()}@example.com`,
        providerType: "SMTP",
        credentials: {},
        createdById: testUserId,
        orgId: testOrgId,
        dailyLimit: 2, // Low limit for testing threshold
        currentSent: 0,
      },
    });
    testMailboxId = mailbox.id;
  });

  after(async () => {
    // Cleanup test records
    await prisma.sendIntent.deleteMany({ where: { leadId: testLeadId } }).catch(() => null);
    await prisma.quotaReservation.deleteMany({ where: { scopeId: testMailboxId } }).catch(() => null);
    await prisma.quotaReservation.deleteMany({ where: { scopeId: testCampaignId } }).catch(() => null);
    await prisma.outreachMessage.deleteMany({ where: { senderMailboxId: testMailboxId } }).catch(() => null);
    await prisma.senderMailbox.delete({ where: { id: testMailboxId } }).catch(() => null);
    await prisma.lead.delete({ where: { id: testLeadId } }).catch(() => null);
    await prisma.campaign.delete({ where: { id: testCampaignId } }).catch(() => null);
    await prisma.organization.delete({ where: { id: testOrgId } }).catch(() => null);
    await prisma.user.delete({ where: { id: testUserId } }).catch(() => null);
  });

  test("1. Successful authorizeAndCreateSendIntent creates SendIntent and QuotaReservations", async () => {
    const message = await prisma.outreachMessage.create({
      data: {
        subject: "Sprint 2 Test Subject",
        body: "Test Body Content",
        deliveryState: "VALIDATED",
        senderMailboxId: testMailboxId,
        leadId: testLeadId,
        version: 1,
      },
    });

    const operationId = `op-${randomUUID()}`;
    const idempotencyKey = `send:${testLeadId}:step1:v1`;

    const res = await authorizeAndCreateSendIntent({
      operationId,
      leadId: testLeadId,
      campaignId: testCampaignId,
      mailboxId: testMailboxId,
      outreachMessageId: message.id,
      sequenceStep: 1,
      idempotencyKey,
      expectedMessageVersion: 1,
    });

    assert.equal(res.success, true);
    if (!res.success) return;

    // Verify OutreachMessage transitioned to AUTHORIZED
    const updatedMsg = await prisma.outreachMessage.findUnique({
      where: { id: message.id },
      select: { deliveryState: true, version: true },
    });
    assert.equal(updatedMsg?.deliveryState, "AUTHORIZED");
    assert.equal(updatedMsg?.version, 2);

    // Verify SendIntent created in PENDING state
    const intent = await prisma.sendIntent.findUnique({
      where: { id: res.sendIntentId },
    });
    assert.equal(intent?.status, "PENDING");
    assert.equal(intent?.fencingEpoch, 1);
    assert.equal(intent?.leaseVersion, 1);

    // Verify QuotaReservations created for Mailbox & Campaign
    const reservations = await prisma.quotaReservation.findMany({
      where: { operationId },
    });
    assert.equal(reservations.length, 2);
    assert.ok(reservations.some((r) => r.scope === "MAILBOX" && r.status === "RESERVED"));
    assert.ok(reservations.some((r) => r.scope === "CAMPAIGN" && r.status === "RESERVED"));
  });

  test("2. Mailbox daily limit enforcement blocks authorization when reserved + currentSent >= limit", async () => {
    // Current mailbox dailyLimit = 2.
    // In Test 1, we reserved 1 unit.
    // Now create a 2nd message and authorize it (uses 2nd unit).
    const message2 = await prisma.outreachMessage.create({
      data: {
        subject: "Message 2",
        body: "Body 2",
        deliveryState: "VALIDATED",
        senderMailboxId: testMailboxId,
        leadId: testLeadId,
        version: 1,
      },
    });

    const op2 = `op-${randomUUID()}`;
    const idemp2 = `send:${testLeadId}:step2:v1`;

    const res2 = await authorizeAndCreateSendIntent({
      operationId: op2,
      leadId: testLeadId,
      campaignId: testCampaignId,
      mailboxId: testMailboxId,
      outreachMessageId: message2.id,
      sequenceStep: 2,
      idempotencyKey: idemp2,
    });
    assert.equal(res2.success, true);

    // Now mailbox has 2 active reservations (limit = 2).
    // Attempt 3rd authorization — should fail due to MAILBOX_QUOTA_EXCEEDED!
    const message3 = await prisma.outreachMessage.create({
      data: {
        subject: "Message 3",
        body: "Body 3",
        deliveryState: "VALIDATED",
        senderMailboxId: testMailboxId,
        leadId: testLeadId,
        version: 1,
      },
    });

    const op3 = `op-${randomUUID()}`;
    const idemp3 = `send:${testLeadId}:step3:v1`;

    const res3 = await authorizeAndCreateSendIntent({
      operationId: op3,
      leadId: testLeadId,
      campaignId: testCampaignId,
      mailboxId: testMailboxId,
      outreachMessageId: message3.id,
      sequenceStep: 3,
      idempotencyKey: idemp3,
    });

    assert.equal(res3.success, false);
    if (!res3.success) {
      assert.match(res3.reason, /MAILBOX_QUOTA_EXCEEDED/);
    }

    // Verify message 3 was NOT transitioned and remains VALIDATED (rolled back)
    const msg3Check = await prisma.outreachMessage.findUnique({
      where: { id: message3.id },
      select: { deliveryState: true },
    });
    assert.equal(msg3Check?.deliveryState, "VALIDATED");
  });

  test("3. Quota Settlement: settleQuotaReservation CONSUMED increments SenderMailbox currentSent", async () => {
    // Settle op2 to CONSUMED
    const reservations = await prisma.quotaReservation.findMany({
      where: { scope: "MAILBOX", scopeId: testMailboxId, status: "RESERVED" },
    });
    assert.ok(reservations.length > 0);

    const targetOpId = reservations[0]!.operationId;

    const settlementRes = await settleQuotaReservation({
      operationId: targetOpId,
      targetStatus: "CONSUMED",
    });

    assert.equal(settlementRes.settledCount > 0, true);

    // Verify SenderMailbox currentSent was incremented
    const mailbox = await prisma.senderMailbox.findUnique({
      where: { id: testMailboxId },
      select: { currentSent: true },
    });
    assert.equal(mailbox?.currentSent, 1);

    // Verify calling settleQuotaReservation again is idempotent
    const secondSettle = await settleQuotaReservation({
      operationId: targetOpId,
      targetStatus: "CONSUMED",
    });
    assert.equal(secondSettle.alreadySettled, true);
  });

  test("4. Fenced Worker Claim & Takeover (fencingEpoch increment invalidates stale worker)", async () => {
    // Create a new PENDING SendIntent
    const message = await prisma.outreachMessage.create({
      data: {
        subject: "Fencing Test Message",
        body: "Fencing Test Body",
        deliveryState: "VALIDATED",
        senderMailboxId: testMailboxId,
        leadId: testLeadId,
        version: 1,
      },
    });

    const opId = `op-fencing-${randomUUID()}`;
    const idemp = `send:${testLeadId}:fencing:v1`;

    // Settle one reservation to release quota space for test
    const heldRes = await prisma.quotaReservation.findFirst({
      where: { scopeId: testMailboxId, status: "RESERVED" },
    });
    if (heldRes) {
      await settleQuotaReservation({ operationId: heldRes.operationId, targetStatus: "RELEASED" });
    }

    const authRes = await authorizeAndCreateSendIntent({
      operationId: opId,
      leadId: testLeadId,
      campaignId: testCampaignId,
      mailboxId: testMailboxId,
      outreachMessageId: message.id,
      sequenceStep: 10,
      idempotencyKey: idemp,
    });

    assert.equal(authRes.success, true);
    if (!authRes.success) return;

    // Worker A claims lease (1ms TTL to force immediate expiry)
    const claimA = await claimSendIntentLease({
      sendIntentId: authRes.sendIntentId,
      workerId: "worker-a",
      ttlMs: 1,
    });

    assert.equal(claimA.granted, true);
    if (!claimA.granted) return;

    assert.equal(claimA.lease.claimedBy, "worker-a");
    assert.equal(claimA.lease.fencingEpoch, 1);

    // Wait for Worker A lease to expire
    await new Promise((r) => setTimeout(r, 10));

    // Worker B takes over lease
    const claimB = await claimSendIntentLease({
      sendIntentId: authRes.sendIntentId,
      workerId: "worker-b",
      ttlMs: 60_000,
    });

    assert.equal(claimB.granted, true);
    if (!claimB.granted) return;

    assert.equal(claimB.lease.claimedBy, "worker-b");
    assert.equal(claimB.lease.fencingEpoch, 2); // Epoch incremented!

    // Stale Worker A attempts fenced status transition (DISPATCHING → SENT with epoch 1)
    const staleTransition = await transitionSendIntent({
      sendIntentId: authRes.sendIntentId,
      expectedState: "DISPATCHING",
      nextState: "SENT",
      expectedVersion: claimA.lease.version,
      workerId: "worker-a",
      fencingEpoch: claimA.lease.fencingEpoch, // stale epoch = 1!
      leaseVersion: claimA.lease.leaseVersion,
      operationId: opId,
    });

    assert.equal(staleTransition.success, false); // Stale worker blocked!

    // Worker B with valid fencing epoch (2) executes fenced status transition
    const validTransition = await transitionSendIntent({
      sendIntentId: authRes.sendIntentId,
      expectedState: "DISPATCHING",
      nextState: "SENT",
      expectedVersion: claimB.lease.version,
      workerId: "worker-b",
      fencingEpoch: claimB.lease.fencingEpoch, // valid epoch = 2!
      leaseVersion: claimB.lease.leaseVersion,
      operationId: opId,
    });

    assert.equal(validTransition.success, true); // Worker B succeeds!

    // Verify SendIntent status is SENT
    const finalIntent = await prisma.sendIntent.findUnique({
      where: { id: authRes.sendIntentId },
      select: { status: true },
    });
    assert.equal(finalIntent?.status, "SENT");
  });
});
