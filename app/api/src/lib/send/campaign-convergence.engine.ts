/**
 * Campaign Outcome Convergence Engine (Sprint 13 Canonical Contract)
 *
 * Evaluates aggregate campaign status authoritatively from the latest (authoritative)
 * SendIntent per lead, enforcing Set-Based Identity Completeness, Campaign-Row Lock
 * Serialization (FOR UPDATE), and Fail-Closed Decision Logic.
 *
 * INVARIANTS:
 * 1. SendIntent = Execution Truth; Campaign = Aggregate Outcome Truth.
 * 2. Authoritative Intent: For each lead, the latest SendIntent (by createdAt) represents
 *    the authoritative execution state. Historical retries are tracked as forensic attempts.
 * 3. Identity Completeness: ScheduledLeadSet === AuthoritativeSendIntentLeadSet (0 missing).
 * 4. Serialization: Evaluated under SELECT Campaign WHERE id = ? FOR UPDATE.
 * 5. Fenced CAS Commit: Mutates Campaign.status via version compare-and-swap.
 * 6. Fail-Closed: Unexpected/ambiguous child states prevent COMPLETED and hold NEEDS_REVIEW.
 */

import { prisma } from "../prisma";
import { logger } from "../logger";

export interface ChildStateCounts {
  accepted: number;
  failed: number;
  canceled: number;
  queued: number;
  dispatching: number;
  unknown: number;
  reconciling: number;
  manualReview: number;
  unexpected: number;
}

export interface AttemptForensics {
  totalSendIntents: number;
  authoritativeCount: number;
  retryAttempts: number;
}

export interface IdentityCompletenessProof {
  expectedLeadCount: number;
  distinctAuthoritativeLeadCount: number;
  missingLeadCount: number;
  unexpectedLeadCount: number;
  satisfied: boolean;
  missingLeadIds: string[];
}

export type CampaignDerivedOutcome =
  | "COMPLETED"
  | "PARTIALLY_COMPLETED"
  | "NEEDS_REVIEW"
  | "SENDING"
  | "FAILED";

export interface CampaignConvergenceResult {
  campaignId: string;
  expectedVersion: number;
  scheduledLeadCount: number;
  authoritativeIntentCount: number;
  counts: ChildStateCounts;
  attemptForensics: AttemptForensics;
  completeness: IdentityCompletenessProof;
  outcomeStatus: CampaignDerivedOutcome;
  executionGate: "RUNNABLE" | "PAUSED" | "BLOCKED";
  blockingReasons: string[];
  evaluatedAt: string;
  casCommitted: boolean;
  newState?: string;
  reason?: string;
}

export async function evaluateCampaignConvergence(
  campaignId: string,
  options: { maxRetries?: number; tenantOrgId?: string } = {},
): Promise<CampaignConvergenceResult> {
  const { maxRetries = 3 } = options;
  let attempt = 0;

  while (attempt < maxRetries) {
    attempt++;
    const result = await runSingleConvergenceEvaluation(campaignId, options.tenantOrgId);
    if (result.casCommitted || attempt >= maxRetries) {
      return result;
    }
    logger.warn(
      { campaignId, attempt, maxRetries },
      "[campaign-convergence] CAS conflict during update — retrying re-evaluation",
    );
    await new Promise((r) => setTimeout(r, 50 * attempt));
  }

  throw new Error(`[campaign-convergence] Exceeded max CAS retries (${maxRetries}) for campaign ${campaignId}`);
}

async function runSingleConvergenceEvaluation(
  campaignId: string,
  tenantOrgId?: string,
): Promise<CampaignConvergenceResult> {
  const evaluatedAt = new Date().toISOString();

  return await prisma.$transaction(async (tx) => {
    // 1. Acquire Campaign-Row Lock for serialization
    const campaignRows = await tx.$queryRaw<Array<{ id: string; status: string; version: number; orgId: string }>>`
      SELECT id, status, version, "orgId"
      FROM "Campaign"
      WHERE id = ${campaignId}
      FOR UPDATE
    `;

    if (campaignRows.length === 0) {
      throw new Error(`Campaign not found: ${campaignId}`);
    }

    const campaign = campaignRows[0]!;

    // Enforce Tenant Scoping if supplied
    if (tenantOrgId && campaign.orgId !== tenantOrgId) {
      throw new Error(`Forbidden: Tenant mismatch for campaign ${campaignId}`);
    }

    // 2. Load authoritative non-deleted scheduled leads
    const scheduledLeads = await tx.lead.findMany({
      where: { campaignId, deletedAt: null },
      select: { id: true },
    });

    const scheduledLeadIds = new Set(scheduledLeads.map((l) => l.id));
    const scheduledLeadCount = scheduledLeadIds.size;

    // 3. Load all SendIntents linked to this campaign, ordered by createdAt desc, id desc to resolve authoritative intent per lead deterministically
    const rawIntents = await tx.sendIntent.findMany({
      where: { campaignId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        id: true,
        status: true,
        leadId: true,
        createdAt: true,
      },
    });


    // 4. Resolve Authoritative SendIntent per lead (latest createdAt per leadId)
    const authoritativeIntentsByLead = new Map<string, typeof rawIntents[0]>();
    let retryAttempts = 0;

    for (const intent of rawIntents) {
      if (!authoritativeIntentsByLead.has(intent.leadId)) {
        authoritativeIntentsByLead.set(intent.leadId, intent);
      } else {
        retryAttempts++;
      }
    }

    const authoritativeIntents = Array.from(authoritativeIntentsByLead.values());
    const authoritativeIntentCount = authoritativeIntents.length;

    // 5. Compute Set-Based Identity Completeness on Authoritative Intents
    const counts: ChildStateCounts = {
      accepted: 0,
      failed: 0,
      canceled: 0,
      queued: 0,
      dispatching: 0,
      unknown: 0,
      reconciling: 0,
      manualReview: 0,
      unexpected: 0,
    };

    let unexpectedLeadCount = 0;

    for (const intent of authoritativeIntents) {
      if (!scheduledLeadIds.has(intent.leadId)) {
        unexpectedLeadCount++;
      }

      switch (intent.status) {
        case "ACCEPTED":
          counts.accepted++;
          break;
        case "FAILED":
          counts.failed++;
          break;
        case "PENDING":
          counts.queued++;
          break;
        case "DISPATCHING":
          counts.dispatching++;
          break;
        case "UNKNOWN":
          counts.unknown++;
          break;
        default:
          counts.unexpected++;
          break;
      }
    }

    const missingLeadIds: string[] = [];
    for (const leadId of scheduledLeadIds) {
      if (!authoritativeIntentsByLead.has(leadId)) {
        missingLeadIds.push(leadId);
      }
    }

    const missingLeadCount = missingLeadIds.length;
    const distinctAuthoritativeLeadCount = authoritativeIntentsByLead.size;

    const completenessSatisfied =
      scheduledLeadCount > 0 &&
      distinctAuthoritativeLeadCount === scheduledLeadCount &&
      missingLeadCount === 0 &&
      unexpectedLeadCount === 0;

    const completeness: IdentityCompletenessProof = {
      expectedLeadCount: scheduledLeadCount,
      distinctAuthoritativeLeadCount,
      missingLeadCount,
      unexpectedLeadCount,
      satisfied: completenessSatisfied,
      missingLeadIds,
    };

    const attemptForensics: AttemptForensics = {
      totalSendIntents: rawIntents.length,
      authoritativeCount: authoritativeIntentCount,
      retryAttempts,
    };

    // 6. Fail-Closed Decision Engine
    let outcomeStatus: CampaignDerivedOutcome = "SENDING";

    if (counts.unexpected > 0) {
      outcomeStatus = "NEEDS_REVIEW";
    } else if (scheduledLeadCount === 0) {
      outcomeStatus = "COMPLETED";
    } else if (!completenessSatisfied) {
      outcomeStatus = "SENDING";
    } else if (counts.unknown > 0 || counts.reconciling > 0 || counts.manualReview > 0) {
      outcomeStatus = "NEEDS_REVIEW";
    } else if (counts.queued > 0 || counts.dispatching > 0) {
      outcomeStatus = "SENDING";
    } else if (counts.accepted === scheduledLeadCount) {
      outcomeStatus = "COMPLETED";
    } else if (counts.accepted + counts.failed + counts.canceled === scheduledLeadCount) {
      outcomeStatus = "PARTIALLY_COMPLETED";
    } else {
      outcomeStatus = "NEEDS_REVIEW"; // Fail-closed default
    }

    // 7. Map Derived Outcome to Prisma CampaignStatus
    let prismaNextStatus: string = campaign.status;
    if (outcomeStatus === "COMPLETED") {
      prismaNextStatus = "COMPLETED";
    } else if (outcomeStatus === "PARTIALLY_COMPLETED") {
      prismaNextStatus = "COMPLETED";
    } else if (outcomeStatus === "NEEDS_REVIEW") {
      prismaNextStatus = "REVIEW";
    } else if (outcomeStatus === "SENDING") {
      prismaNextStatus = "SENDING";
    } else if (outcomeStatus === "FAILED") {
      prismaNextStatus = "FAILED";
    }

    // 8. Execute Fenced Compare-And-Swap (CAS) Update on Campaign
    let casCommitted = false;
    if (prismaNextStatus !== campaign.status) {
      const updateCount = await tx.$executeRaw`
        UPDATE "Campaign"
        SET "status" = ${prismaNextStatus}::"CampaignStatus",
            "previousStatus" = ${campaign.status}::"CampaignStatus",
            "version" = "version" + 1,
            "updatedAt" = NOW(),
            "completedAt" = CASE WHEN ${prismaNextStatus} = 'COMPLETED' THEN NOW() ELSE "completedAt" END
        WHERE id = ${campaignId}
          AND version = ${campaign.version}
      `;

      casCommitted = Number(updateCount) === 1;
    } else {
      casCommitted = true;
    }

    return {
      campaignId,
      expectedVersion: campaign.version,
      scheduledLeadCount,
      authoritativeIntentCount,
      counts,
      attemptForensics,
      completeness,
      outcomeStatus,
      executionGate: "RUNNABLE",
      blockingReasons: [],
      evaluatedAt,
      casCommitted,
      newState: prismaNextStatus,
    };
  });
}
