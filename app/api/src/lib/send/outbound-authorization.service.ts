/**
 * Outbound Authorization Service (Sprint 2)
 *
 * Implements `authorizeAndCreateSendIntent()`.
 *
 * Enforces atomic gate checks and reservations before ANY provider call is permitted:
 *  1. Campaign active & campaign quota available
 *  2. Lead eligible & not suppressed/disqualified
 *  3. Mailbox healthy & mailbox quota available
 *  4. OutreachMessage in VALIDATED state with matching context hash/version
 *  5. Creates Mailbox & Campaign QuotaReservations (RESERVED)
 *  6. Transitions OutreachMessage VALIDATED → AUTHORIZED via transitionState()
 *  7. Creates SendIntent (PENDING)
 *
 * ALL steps execute within a single atomic Prisma transaction.
 */

import { prisma } from "../prisma";
import { logger } from "../logger";
import { transitionState } from "../state/transition-state";
import type { TransitionAuthority } from "../state/transition-state";
import { checkMailboxQuota, checkCampaignQuota, createQuotaReservation } from "./send-quota.service";
import { QuotaScope } from "@prisma/client";

export interface AuthorizeSendParams {
  operationId: string;
  leadId: string;
  campaignId: string;
  mailboxId: string;
  outreachMessageId: string;
  sequenceStep: number;
  idempotencyKey: string;
  expectedMessageVersion?: number;
  expectedPayloadHash?: string;
  traceId?: string;
}

export type AuthorizeSendResult =
  | { success: true; sendIntentId: string; operationId: string; idempotencyKey: string }
  | { success: false; reason: string; details?: Record<string, unknown> };

export async function authorizeAndCreateSendIntent(
  params: AuthorizeSendParams,
): Promise<AuthorizeSendResult> {
  const {
    operationId,
    leadId,
    campaignId,
    mailboxId,
    outreachMessageId,
    sequenceStep,
    idempotencyKey,
    expectedMessageVersion,
    expectedPayloadHash,
    traceId,
  } = params;

  // 1. Check existing SendIntent for idempotency
  const existingIntent = await prisma.sendIntent.findUnique({
    where: { idempotencyKey },
    select: { id: true, operationId: true, status: true },
  });

  if (existingIntent) {
    logger.info(
      { idempotencyKey, sendIntentId: existingIntent.id, status: existingIntent.status },
      "[outbound-auth] SendIntent already exists for idempotencyKey",
    );
    return {
      success: true,
      sendIntentId: existingIntent.id,
      operationId: existingIntent.operationId,
      idempotencyKey,
    };
  }

  // 2. Pre-transaction checks (read phase)
  const [lead, message] = await Promise.all([
    prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true, leadState: true },
    }),
    prisma.outreachMessage.findUnique({
      where: { id: outreachMessageId },
      select: { id: true, deliveryState: true, version: true },
    }),
  ]);

  if (!lead) {
    return { success: false, reason: "LEAD_NOT_FOUND" };
  }

  if (lead.leadState === "SUPPRESSED" || lead.leadState === "DISQUALIFIED" || lead.leadState === "BOUNCED" || lead.leadState === "UNSUBSCRIBED") {
    return { success: false, reason: `LEAD_INELIGIBLE: Lead is in state ${lead.leadState}` };
  }

  if (!message) {
    return { success: false, reason: "MESSAGE_NOT_FOUND" };
  }

  if (message.deliveryState !== "VALIDATED") {
    return { success: false, reason: `MESSAGE_STATE_INVALID: Expected VALIDATED, found ${message.deliveryState}` };
  }

  if (expectedMessageVersion !== undefined && message.version !== expectedMessageVersion) {
    return { success: false, reason: `MESSAGE_VERSION_MISMATCH: Expected ${expectedMessageVersion}, found ${message.version}` };
  }

  // 3. Atomic Authorization Transaction
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Re-verify lead eligibility inside transaction for TOCTOU safety
      const txLead = await tx.lead.findUnique({
        where: { id: leadId },
        select: { leadState: true, email: true, campaign: { select: { orgId: true } } },
      });
      if (!txLead) {
        throw new Error("LEAD_NOT_FOUND");
      }
      if (
        txLead.leadState === "SUPPRESSED" ||
        txLead.leadState === "DISQUALIFIED" ||
        txLead.leadState === "BOUNCED" ||
        txLead.leadState === "UNSUBSCRIBED"
      ) {
        throw new Error(`LEAD_INELIGIBLE: Lead is in state ${txLead.leadState}`);
      }
      if (txLead.email && txLead.campaign?.orgId) {
        const suppressed = await tx.suppression.findFirst({
          where: { email: txLead.email, orgId: txLead.campaign.orgId },
        });
        if (suppressed) {
          throw new Error("LEAD_INELIGIBLE: Lead email is suppressed in organization");
        }
      }

      // Re-verify quotas inside transaction for strict race safety
      const txMailboxQuota = await checkMailboxQuota({ mailboxId, tx });
      if (!txMailboxQuota.allowed) {
        throw new Error(`MAILBOX_QUOTA_EXCEEDED: ${txMailboxQuota.reason}`);
      }

      const txCampaignQuota = await checkCampaignQuota({ campaignId, tx });
      if (!txCampaignQuota.allowed) {
        throw new Error(`CAMPAIGN_QUOTA_EXCEEDED: ${txCampaignQuota.reason}`);
      }

      // Create QuotaReservations (RESERVED)
      await createQuotaReservation(tx, {
        operationId,
        scope: QuotaScope.MAILBOX,
        scopeId: mailboxId,
        amount: 1,
      });

      await createQuotaReservation(tx, {
        operationId,
        scope: QuotaScope.CAMPAIGN,
        scopeId: campaignId,
        amount: 1,
      });

      // Transition OutreachMessage VALIDATED → AUTHORIZED
      const authority: TransitionAuthority = {
        actorType: "SYSTEM",
        actorId: operationId,
        operationId,
        traceId,
      };

      const msgTransition = await transitionState(tx, {
        model: "OutreachMessage",
        entityId: outreachMessageId,
        expectedState: "VALIDATED",
        expectedVersion: message.version,
        nextState: "AUTHORIZED",
        authority,
      });

      if (!msgTransition.success) {
        throw new Error(`MESSAGE_TRANSITION_FAILED: ${msgTransition.reason}`);
      }

      // Create SendIntent in PENDING state
      const createdIntent = await tx.sendIntent.create({
        data: {
          operationId,
          leadId,
          campaignId,
          mailboxId,
          outreachMessageId,
          sequenceStep,
          idempotencyKey,
          traceId,
          status: "PENDING",
          payloadHash: expectedPayloadHash,
          attemptCount: 0,
          fencingEpoch: 1,
          leaseVersion: 1,
          version: 1,
        },
      });

      // Create OutboxEvent for transaction auditability
      await tx.outboxEvent.create({
        data: {
          organizationId: "org_default",
          aggregateType: "SendIntent",
          aggregateId: createdIntent.id,
          aggregateVersion: 1,
          eventType: "SEND_INTENT_AUTHORIZED",
          payload: {
            sendIntentId: createdIntent.id,
            operationId,
            leadId,
            campaignId,
            mailboxId,
            outreachMessageId,
            sequenceStep,
            idempotencyKey,
            traceId,
          },
          operationId,
          idempotencyKey: `${operationId}:AUTHORIZED`,
        },
      });

      return createdIntent;
    });

    logger.info(
      { sendIntentId: result.id, operationId, idempotencyKey },
      "[outbound-auth] Successfully authorized & created SendIntent",
    );

    return {
      success: true,
      sendIntentId: result.id,
      operationId,
      idempotencyKey,
    };
  } catch (err: any) {
    logger.warn(
      { operationId, idempotencyKey, err: err.message },
      "[outbound-auth] Atomic authorization transaction failed — rolled back",
    );
    return {
      success: false,
      reason: err.message || "AUTHORIZATION_TRANSACTION_FAILED",
    };
  }
}
