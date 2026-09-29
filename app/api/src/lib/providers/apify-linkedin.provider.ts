// Target path in your repo: web/app/api/src/lib/providers/apify-linkedin.provider.ts
//
// LinkedIn person enrichment via Apify's harvestapi/linkedin-profile-scraper.
//
// IMPORTANT — read before wiring this in:
// enrichPerson() below NEVER calls Apify live. enrichPersonWaterfall() wraps
// every provider in safeEnrich() with PROVIDER_TIMEOUT_MS = 5000 (see
// enrichment-waterfall.agent.ts). A live actor.call() run — actor boot +
// fetching a LinkedIn profile — routinely takes well past 5s, so a naive
// "call Apify inside enrichPerson()" implementation would get aborted on
// nearly every run: silent timeouts, wasted Apify spend, zero data landed.
//
// SECOND THING — your repo actually has two separate enrichment pipelines:
//   - "enrich-waterfall" job -> runEnrichmentWaterfall -> enrichPersonWaterfall
//     -> lib/providers/* (where ApifyLinkedInProvider below plugs in).
//     Confirmed only enqueued from leads.controller.ts -- an on-demand,
//     manual/API-triggered path, not the automatic pipeline.
//   - "enrich-lead-batch" job -> runBatchEmailEnrichmentAgent (in
//     email-enrichment.agent.ts) -> an older Apollo+Hunter+website-discovery
//     pipeline that does NOT go through lib/providers/ at all. Confirmed
//     enqueued from discoveryLib/ranking.ts, gemini.agent.ts, and
//     workers/scoring.worker.ts -- i.e. this is the automatic, high-volume
//     path that runs as leads get scored/qualified.
// Because the real traffic goes through the second one, warmHarvestApiCache()
// alone isn't enough -- something has to actually read the cache back onto
// the Lead row on that path, since it never reaches enrichPerson(). That's
// what applyCachedHarvestApiData() is for. It's called directly from the
// "enrich-lead-batch" case in emailEnrichment.worker.ts, AFTER
// runBatchEmailEnrichmentAgent runs, and only fills fields still empty at
// that point -- so it can never clobber whatever Apollo/Hunter already found.
//
// Net effect: this file now serves both pipelines. enrichPerson()/the class
// export matters for the manual "enrich-waterfall" path; warmHarvestApiCache
// + applyCachedHarvestApiData matter for the automatic batch path. Unlike
// proxycurl.provider.ts / pdl.provider.ts, this file does touch Prisma
// directly (in applyCachedHarvestApiData) -- a deliberate exception, because
// the batch pipeline has no other merge/write step that would pick this data
// up otherwise.

import { ApifyClient } from "apify-client";
import { logger } from "../logger";
import { prisma } from "../prisma";
import {
  buildEnrichmentCacheKey,
  getCachedEnrichmentValue,
  setCachedEnrichmentValue,
} from "../../modules/gemini/enrichment-cache";
import { EMAIL_SOURCE } from "../../modules/gemini/email-enrichment.agent";
import { CompanyEnrichResult, PersonEnrichResult, EnrichmentProvider } from "./types";

// harvestapi/linkedin-profile-scraper — "LinkedIn Profile Scraper + Email"
// Pricing per the actor's own Input tab: $4/1k profiles, $10/1k with email search.
const ACTOR_ID = "harvestapi/linkedin-profile-scraper";
const CACHE_NAMESPACE = "person" as const;

function cacheKeyFor(linkedinUrl: string): string {
  return buildEnrichmentCacheKey(["harvestapi", linkedinUrl]);
}

let _client: ApifyClient | null = null;
function client(): ApifyClient | null {
  if (!process.env.APIFY_API_KEY) return null;
  if (!_client) _client = new ApifyClient({ token: process.env.APIFY_API_KEY });
  return _client;
}

// Field names per HarvestAPI's own API reference (docs.harvest-api.com) —
// spot check one real dataset item in Apify Console before trusting this in
// production; the same defensiveness proxycurl.provider.ts / pdl.provider.ts
// already use for third-party field drift.
function mapProfile(item: Record<string, any>): PersonEnrichResult {
  const current = item.currentPosition?.[0] ?? item.experience?.[0];
  return {
    firstName: item.firstName ?? undefined,
    lastName: item.lastName ?? undefined,
    title: current?.position ?? item.headline ?? undefined,
    department: current?.companyName ?? undefined,
    linkedinUrl: item.linkedinUrl ?? undefined,
    // NB: HarvestAPI returns `emails: string[]` (plural) — not `email`.
    email: Array.isArray(item.emails) ? item.emails[0] : undefined,
    source: "harvestapi",
  };
}

/**
 * Batch-fetch and cache LinkedIn profiles ahead of the per-lead waterfall.
 * Skips URLs already cached, so re-running is cheap. Safe to call from
 * either pipeline; by itself this only warms the cache, it doesn't write
 * to any Lead row (see applyCachedHarvestApiData for that).
 *
 * @param findEmail  Use the pricier "+ email search" mode ($10/1k vs $4/1k).
 *                    Leave off if Apollo/Hunter/PDL already cover email for
 *                    you — this is here mainly for title/company/headline.
 */
export async function warmHarvestApiCache(
  linkedinUrls: string[],
  opts: { findEmail?: boolean } = {}
): Promise<void> {
  const apify = client();
  if (!apify) return;

  const unique = [...new Set(linkedinUrls.filter(Boolean))];
  const uncached: string[] = [];
  for (const url of unique) {
    const hit = await getCachedEnrichmentValue<PersonEnrichResult>(cacheKeyFor(url), CACHE_NAMESPACE);
    if (!hit) uncached.push(url);
  }
  if (uncached.length === 0) return;

  try {
    const run = await apify.actor(ACTOR_ID).call(
      {
        urls: uncached,
        profileScraperMode: opts.findEmail
          ? "Profile details + email search ($10 per 1k)"
          : "Profile details no email ($4 per 1k)",
      },
      { memory: 2048, timeout: 300 }
    );
    const { items } = await apify.dataset(run.defaultDatasetId).listItems();

    for (const item of items as Record<string, any>[]) {
      if (!item.linkedinUrl) continue;
      await setCachedEnrichmentValue(cacheKeyFor(item.linkedinUrl), CACHE_NAMESPACE, mapProfile(item));
    }
    logger.info(
      { requested: uncached.length, received: items.length },
      "[apify-linkedin] cache warm complete"
    );
  } catch (err) {
    logger.warn(
      { err, count: uncached.length },
      "[apify-linkedin] batch fetch failed — affected leads fall through to other providers"
    );
  }
}

/**
 * Writes cached HarvestAPI data onto Lead rows directly. Needed because the
 * "enrich-lead-batch" pipeline (email-enrichment.agent.ts) never calls
 * enrichPerson() below, so nothing else reads the cache back out on that
 * path. Call this AFTER runBatchEmailEnrichmentAgent so it only fills
 * whatever Apollo/Hunter left empty — it never overwrites existing data.
 */
export async function applyCachedHarvestApiData(leadIds: string[]): Promise<void> {
  if (leadIds.length === 0) return;

  const leads = await prisma.lead.findMany({
    where: { id: { in: leadIds }, linkedinUrl: { not: null } },
    select: {
      id: true,
      linkedinUrl: true,
      firstName: true,
      lastName: true,
      title: true,
      department: true,
      email: true,
    },
  });

  for (const lead of leads) {
    const cached = await getCachedEnrichmentValue<PersonEnrichResult>(
      cacheKeyFor(lead.linkedinUrl!),
      CACHE_NAMESPACE
    );
    if (!cached) continue;

    const patch: Record<string, unknown> = {};
    if (!lead.firstName && cached.firstName) patch.firstName = cached.firstName;
    if (!lead.lastName && cached.lastName) patch.lastName = cached.lastName;
    if (!lead.title && cached.title) patch.title = cached.title;
    if (!lead.department && cached.department) patch.department = cached.department;
    if (!lead.email && cached.email) {
      patch.email = cached.email;
      patch.emailSource = EMAIL_SOURCE.HARVESTAPI;
    }
    if (Object.keys(patch).length === 0) continue;

    patch.lastEnrichedAt = new Date();
    await prisma.lead.update({ where: { id: lead.id }, data: patch });
  }

  logger.info({ checked: leads.length }, "[apify-linkedin] applied cached data to batch");
}

export class ApifyLinkedInProvider implements EnrichmentProvider {
  readonly name = "harvestapi";
  // After apollo/pdl/hunter/crunchbase (priorities 1–4): this only needs a
  // linkedinUrl to begin with, so it can't help leads the earlier providers
  // haven't already given one to, and it's one of the pricier calls in the
  // waterfall. Treat it as a LinkedIn-specific fallback, not a first stop.
  // Move it earlier if LinkedIn data should win over the others.
  readonly priority = 5;

  async enrichCompany(_domain: string): Promise<CompanyEnrichResult | null> {
    return null;
  }

  async enrichPerson(params: {
    email?: string;
    linkedinUrl?: string;
    firstName?: string;
    lastName?: string;
    domain?: string;
  }): Promise<PersonEnrichResult | null> {
    if (!process.env.APIFY_API_KEY || !params.linkedinUrl) return null;

    const cached = await getCachedEnrichmentValue<PersonEnrichResult>(
      cacheKeyFor(params.linkedinUrl),
      CACHE_NAMESPACE
    );
    if (!cached) {
      logger.debug(
        { linkedinUrl: params.linkedinUrl },
        "[harvestapi] cache miss — skipping rather than risking the 5s provider timeout live"
      );
    }
    return cached;
  }
}
