import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";

// ─── Provider cost table (cents per call) ───────────────────────────────────
// These are approximate per-call costs.  Adjust when pricing changes.
export const PROVIDER_COSTS: Record<string, number> = {
  APOLLO: 5,            // ~$0.05 per reveal
  APOLLO_REVEAL: 5,
  HUNTER: 3,            // ~$0.03 per lookup
  ZEROBOUNCE: 2,        // ~$0.02 per verification
  PDL: 10,              // ~$0.10 per enrichment
  CRUNCHBASE: 0,        // included in subscription
  PROXYCURL: 5,         // ~$0.05 per profile
  APIFY_LINKEDIN: 3,    // ~$0.03 per scrape
  PATTERN: 0,           // local — no cost
};

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Record a single enrichment cost event.
 *
 * Safe to call fire-and-forget — logs errors but never throws.
 */
export async function recordEnrichmentCost(params: {
  leadId: string;
  campaignId: string;
  provider: string;
  operation: string;
}): Promise<void> {
  const costCents = PROVIDER_COSTS[params.provider.toUpperCase()] ?? 0;

  if (costCents === 0) return; // don't clutter the ledger with free calls

  try {
    await prisma.enrichmentCostLedger.create({
      data: {
        leadId: params.leadId,
        campaignId: params.campaignId,
        provider: params.provider.toUpperCase(),
        operation: params.operation,
        costCents,
      },
    });

    logger.debug(
      { ...params, costCents },
      "[enrichment-cost] recorded",
    );
  } catch (err) {
    // Best-effort — cost tracking must never block enrichment
    logger.warn(
      { ...params, costCents, err },
      "[enrichment-cost] failed to record cost (non-fatal)",
    );
  }
}

/**
 * Total enrichment spend for a campaign, in cents.
 */
export async function getCampaignEnrichmentSpend(
  campaignId: string,
): Promise<number> {
  const result = await prisma.enrichmentCostLedger.aggregate({
    where: { campaignId },
    _sum: { costCents: true },
  });

  return result._sum.costCents ?? 0;
}

/**
 * Check whether a campaign has exhausted its enrichment budget.
 *
 * Returns `false` if no budget is set (unlimited enrichment).
 */
export async function isCampaignBudgetExhausted(
  campaignId: string,
): Promise<boolean> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    select: { enrichmentBudgetCents: true },
  });

  if (
    campaign?.enrichmentBudgetCents == null ||
    campaign.enrichmentBudgetCents <= 0
  ) {
    return false; // no budget set → unlimited
  }

  const spent = await getCampaignEnrichmentSpend(campaignId);
  const exhausted = spent >= campaign.enrichmentBudgetCents;

  if (exhausted) {
    logger.info(
      { campaignId, spent, budget: campaign.enrichmentBudgetCents },
      "[enrichment-cost] campaign budget exhausted — paid providers will be skipped",
    );
  }

  return exhausted;
}
