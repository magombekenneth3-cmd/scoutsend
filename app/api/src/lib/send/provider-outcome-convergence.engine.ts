/**
 * Provider Outcome Convergence Engine (Sprint 12)
 *
 * Reconciles ambiguous provider outcomes (UNKNOWN state) into authoritative
 * terminal states (ACCEPTED, FAILED, MANUAL_REVIEW) using fenced leases,
 * provider capabilities, and strict evidence semantics.
 */

import { prisma } from "../prisma";
import { transitionState } from "../state/transition-state";
import { getProviderCapabilities } from "./provider-capabilities.registry";
import { settleQuotaReservation } from "./send-quota.service";

export type ReconciliationDecision =
  | "ACCEPTED"
  | "FAILED"
  | "RETRY_RECONCILIATION"
  | "MANUAL_REVIEW";

export function evaluateProviderEvidence(params: {
  providerName: string;
  lookupResult: "SENT" | "NOT_SENT" | "NOT_FOUND" | "UNAVAILABLE" | "MALFORMED";
  attemptsCount: number;
  maxAttempts?: number;
}): ReconciliationDecision {
  const { providerName, lookupResult, attemptsCount, maxAttempts = 3 } = params;
  const caps = getProviderCapabilities(providerName);

  if (lookupResult === "SENT") {
    return "ACCEPTED";
  }

  if (lookupResult === "NOT_SENT") {
    if (caps.lookupConsistency === "STRONG") {
      return "FAILED";
    }
    return attemptsCount >= maxAttempts ? "MANUAL_REVIEW" : "RETRY_RECONCILIATION";
  }

  if (lookupResult === "NOT_FOUND") {
    if (caps.lookupConsistency === "STRONG") {
      return "FAILED";
    }
    return attemptsCount >= maxAttempts ? "MANUAL_REVIEW" : "RETRY_RECONCILIATION";
  }

  if (lookupResult === "UNAVAILABLE" || lookupResult === "MALFORMED") {
    return attemptsCount >= maxAttempts ? "MANUAL_REVIEW" : "RETRY_RECONCILIATION";
  }

  return "MANUAL_REVIEW";
}

export async function processUnknownIntentReconciliation(params: {
  sendIntentId: string;
  providerName: string;
  lookupResult: "SENT" | "NOT_SENT" | "NOT_FOUND" | "UNAVAILABLE" | "MALFORMED";
  reconcilerId: string;
  attemptsCount: number;
}): Promise<{ success: boolean; decision: ReconciliationDecision }> {
  const { sendIntentId, providerName, lookupResult, reconcilerId, attemptsCount } = params;
  const decision = evaluateProviderEvidence({ providerName, lookupResult, attemptsCount });

  const result = await prisma.$transaction(async (tx) => {
    const intent = await tx.sendIntent.findUnique({
      where: { id: sendIntentId },
      select: { id: true, status: true, version: true, fencingEpoch: true },
    });

    if (!intent || intent.status !== "UNKNOWN") {
      return { success: false, decision };
    }

    if (decision === "ACCEPTED") {
      const transitionRes = await transitionState(tx, {
        model: "SendIntent",
        entityId: sendIntentId,
        expectedState: "UNKNOWN",
        expectedVersion: intent.version,
        nextState: "ACCEPTED",
        authority: { actorType: "WORKER", actorId: reconcilerId },
      });

      if (transitionRes.success) {
        await settleQuotaReservation({
          operationId: sendIntentId,
          targetStatus: "CONSUMED",
          workerId: reconcilerId,
        }).catch(() => {});
      }
      return { success: transitionRes.success, decision };
    }

    if (decision === "FAILED") {
      const transitionRes = await transitionState(tx, {
        model: "SendIntent",
        entityId: sendIntentId,
        expectedState: "UNKNOWN",
        expectedVersion: intent.version,
        nextState: "FAILED",
        authority: { actorType: "WORKER", actorId: reconcilerId },
      });

      if (transitionRes.success) {
        await settleQuotaReservation({
          operationId: sendIntentId,
          targetStatus: "RELEASED",
          workerId: reconcilerId,
        }).catch(() => {});
      }
      return { success: transitionRes.success, decision };
    }

    return { success: true, decision };
  });

  return result;
}
