/**
 * Manual Review Queue & Governance Service (Sprint 12)
 *
 * Provides structured operator governance for unresolvable provider ambiguities (UNKNOWN state).
 *
 * INVARIANT: Operator actions (CONFIRM_SENT, CONFIRM_NOT_SENT, RETRY, CANCEL) route strictly
 * through transitionState() with operator identity, org ID, reason, and evidence references.
 * Direct untracked provider HTTP calls from admin endpoints are prohibited.
 */

import { prisma } from "../prisma";
import { transitionState } from "../state/transition-state";
import { settleQuotaReservation } from "./send-quota.service";

export type OperatorAction = "CONFIRM_SENT" | "CONFIRM_NOT_SENT" | "RETRY" | "CANCEL";

export async function processOperatorReviewAction(params: {
  sendIntentId: string;
  organizationId: string;
  operatorId: string;
  action: OperatorAction;
  reason: string;
  evidenceRef?: string;
}): Promise<{ success: boolean; newState?: string; reason?: string }> {
  const { sendIntentId, organizationId, operatorId, action } = params;

  return await prisma.$transaction(async (tx) => {
    const intent = await tx.sendIntent.findUnique({
      where: { id: sendIntentId },
      select: {
        id: true,
        status: true,
        version: true,
        outreachMessageId: true,
      },
    });

    if (!intent) {
      return { success: false, reason: "INTENT_NOT_FOUND" };
    }

    if (intent.outreachMessageId) {
      const msg = await tx.outreachMessage.findUnique({
        where: { id: intent.outreachMessageId },
        select: {
          lead: {
            select: {
              campaign: {
                select: { orgId: true },
              },
            },
          },
        },
      });

      const intentOrgId = msg?.lead?.campaign?.orgId;
      if (intentOrgId && intentOrgId !== organizationId) {
        return { success: false, reason: "TENANT_MISMATCH" };
      }
    }

    if (intent.status !== "UNKNOWN") {
      return { success: false, reason: `CANNOT_REVIEW_INTENT_IN_STATE_${intent.status}` };
    }

    if (action === "CONFIRM_SENT") {
      const res = await transitionState(tx, {
        model: "SendIntent",
        entityId: sendIntentId,
        expectedState: intent.status,
        expectedVersion: intent.version,
        nextState: "ACCEPTED",
        authority: { actorType: "OPERATOR", actorId: operatorId },
      });

      if (res.success) {
        await settleQuotaReservation({
          operationId: sendIntentId,
          targetStatus: "CONSUMED",
          workerId: operatorId,
        }).catch(() => {});
      }
      return { success: res.success, newState: "ACCEPTED" };
    }

    if (action === "CONFIRM_NOT_SENT" || action === "CANCEL") {
      const res = await transitionState(tx, {
        model: "SendIntent",
        entityId: sendIntentId,
        expectedState: intent.status,
        expectedVersion: intent.version,
        nextState: "FAILED",
        authority: { actorType: "OPERATOR", actorId: operatorId },
      });

      if (res.success) {
        await settleQuotaReservation({
          operationId: sendIntentId,
          targetStatus: "RELEASED",
          workerId: operatorId,
        }).catch(() => {});
      }
      return { success: res.success, newState: "FAILED" };
    }

    if (action === "RETRY") {
      const res = await transitionState(tx, {
        model: "SendIntent",
        entityId: sendIntentId,
        expectedState: intent.status,
        expectedVersion: intent.version,
        nextState: "DISPATCHING",
        authority: { actorType: "OPERATOR", actorId: operatorId },
      });
      return { success: res.success, newState: "DISPATCHING" };
    }

    return { success: false, reason: "INVALID_OPERATOR_ACTION" };
  });
}
