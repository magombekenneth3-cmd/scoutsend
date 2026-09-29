/**
 * Forensic Aggregate Metrics Service (Sprint 13 P1)
 *
 * Computes authoritative aggregate delivery and status breakdown metrics for a campaign,
 * strictly separating terminal delivery from ambiguous / in-flight states.
 *
 * EQUATIONS:
 * 1. Total Intended = ACCEPTED + FAILED + CANCELED + QUEUED + DISPATCHING + UNKNOWN + RECONCILING + MANUAL_REVIEW
 * 2. Terminal Count = ACCEPTED + FAILED + CANCELED
 * 3. Ambiguous Count = UNKNOWN + RECONCILING + MANUAL_REVIEW
 * 4. Delivery Rate = ACCEPTED / Terminal Count
 */

import { prisma } from "../prisma";

export interface CampaignForensicMetrics {
  campaignId: string;
  totalIntended: number;
  terminalCount: number;
  ambiguousCount: number;
  inFlightCount: number;
  deliveryRate: number;
  breakdown: {
    accepted: number;
    failed: number;
    canceled: number;
    queued: number;
    dispatching: number;
    unknown: number;
    reconciling: number;
    manualReview: number;
  };
  computedAt: string;
}

export async function getCampaignForensicMetrics(campaignId: string): Promise<CampaignForensicMetrics> {
  const computedAt = new Date().toISOString();

  const intents = await prisma.sendIntent.findMany({
    where: { campaignId },
    select: { status: true },
  });

  const breakdown = {
    accepted: 0,
    failed: 0,
    canceled: 0,
    queued: 0,
    dispatching: 0,
    unknown: 0,
    reconciling: 0,
    manualReview: 0,
  };

  for (const intent of intents) {
    switch (intent.status) {
      case "ACCEPTED":
        breakdown.accepted++;
        break;
      case "FAILED":
        breakdown.failed++;
        break;
      case "PENDING":
        breakdown.queued++;
        break;
      case "DISPATCHING":
        breakdown.dispatching++;
        break;
      case "UNKNOWN":
        breakdown.unknown++;
        break;
      default:
        breakdown.unknown++;
        break;
    }
  }

  const totalIntended = intents.length;
  const terminalCount = breakdown.accepted + breakdown.failed + breakdown.canceled;
  const ambiguousCount = breakdown.unknown + breakdown.reconciling + breakdown.manualReview;
  const inFlightCount = breakdown.queued + breakdown.dispatching;

  const deliveryRate = terminalCount > 0 ? breakdown.accepted / terminalCount : 0;

  return {
    campaignId,
    totalIntended,
    terminalCount,
    ambiguousCount,
    inFlightCount,
    deliveryRate: Number(deliveryRate.toFixed(4)),
    breakdown,
    computedAt,
  };
}
