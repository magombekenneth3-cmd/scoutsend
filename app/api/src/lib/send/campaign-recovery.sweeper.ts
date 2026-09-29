/**
 * Campaign Recovery Sweeper (Sprint 13 P1)
 *
 * Periodically sweeps active campaigns (SENDING, REVIEW, QUEUED) to evaluate
 * aggregate convergence and execution gating.
 *
 * Ensures campaign-level outcome updates occur asynchronously and continuously,
 * unblocking resolved states without requiring operator intervention.
 */

import { prisma } from "../prisma";
import { logger } from "../logger";
import { evaluateCampaignConvergence, CampaignConvergenceResult } from "./campaign-convergence.engine";
import { checkCampaignGatingConditions, CampaignGatingEvaluation } from "./campaign-gating.observer";

export interface CampaignSweeperSweepResult {
  evaluatedCount: number;
  results: Array<{
    campaignId: string;
    gating: CampaignGatingEvaluation;
    convergence: CampaignConvergenceResult;
  }>;
  errors: Array<{
    campaignId: string;
    error: string;
  }>;
}

export async function sweepActiveCampaigns(): Promise<CampaignSweeperSweepResult> {
  const activeCampaigns = await prisma.campaign.findMany({
    where: {
      status: {
        in: ["SENDING", "REVIEW", "QUEUED"],
      },
    },
    select: {
      id: true,
      status: true,
    },
  });

  const results: Array<{
    campaignId: string;
    gating: CampaignGatingEvaluation;
    convergence: CampaignConvergenceResult;
  }> = [];
  const errors: Array<{ campaignId: string; error: string }> = [];

  for (const campaign of activeCampaigns) {
    try {
      const gating = await checkCampaignGatingConditions(campaign.id);
      const convergence = await evaluateCampaignConvergence(campaign.id);

      results.push({
        campaignId: campaign.id,
        gating,
        convergence,
      });
    } catch (err: any) {
      logger.error(
        { campaignId: campaign.id, error: err.message },
        "[campaign-recovery-sweeper] Failed single campaign sweep evaluation",
      );
      errors.push({
        campaignId: campaign.id,
        error: err.message || "Unknown sweep error",
      });
    }
  }

  return {
    evaluatedCount: activeCampaigns.length,
    results,
    errors,
  };
}
