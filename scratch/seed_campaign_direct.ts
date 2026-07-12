/**
 * Seeds the ScoutSend "B2B Cold Email – Apollo.io Users" campaign directly
 * via Prisma — no HTTP auth needed.
 *
 * Run from /web:
 *   npx tsx scratch/seed_campaign_direct.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter, log: ["error", "warn"] });

// ── Config ────────────────────────────────────────────────────────────────────

const CAMPAIGN_NAME = "ScoutSend – B2B Cold Email (Apollo / Outreach Users)";
const CAMPAIGN_ICP = `
We target B2B sales-led companies and SaaS businesses that actively use cold email or outbound prospecting tools such as Apollo.io, Lemlist, Outreach.io, Salesloft, Reply.io, Instantly, or Smartlead.

Ideal prospect profile:
- Company size: 50–1 000 employees
- Verticals: B2B SaaS, tech-enabled services, IT consulting, sales agencies, RevOps tooling
- Geography: United States, United Kingdom, Canada, Australia
- Job titles: VP of Sales, Head of Growth, SDR Manager, Revenue Operations Lead, Founder / CEO (≤ 200 employees), Director of Demand Generation
- Pain points: low reply rates on cold email sequences, high Apollo/Outreach seat costs, poor personalisation at scale, domain reputation issues, SDR burnout from manual research
- Buying signals: recently posted SDR job openings, hiring for "outbound", published posts about "cold email deliverability", switched from one cold email tool to another in the last 6 months, raised a Series A or B (scaling go-to-market), tech stack shows Apollo.io or Lemlist via BuiltWith
- Key message angle: ScoutSend replaces an entire SDR research stack — AI agent researches each lead, writes a hyper-personalised email referencing real signals (funding, hiring, tech stack), auto-reviews for spam risk, and sends within daily domain limits to protect deliverability. 3× reply rates, 60% lower cost vs. a full SDR seat.
`.trim();

const SEED_LEADS = [
  // Sales development agencies
  { companyName: "Belkins",           website: "https://belkins.io",           externalId: "belkins-io" },
  { companyName: "Cleverly",          website: "https://cleverly.co",          externalId: "cleverly-co" },
  { companyName: "Martal Group",      website: "https://martal.ca",            externalId: "martal-ca" },
  { companyName: "CIENCE",            website: "https://cience.com",           externalId: "cience-com" },
  { companyName: "SalesPipe",         website: "https://salespipe.co",         externalId: "salespipe-co" },
  { companyName: "Operatix",          website: "https://operatix.net",         externalId: "operatix-net" },
  // Cold-email / outbound tool companies (competitors or heavy users)
  { companyName: "Outreach",          website: "https://outreach.io",          externalId: "outreach-io" },
  { companyName: "Salesloft",         website: "https://salesloft.com",        externalId: "salesloft-com" },
  { companyName: "Lemlist",           website: "https://lemlist.com",          externalId: "lemlist-com" },
  { companyName: "Instantly",         website: "https://instantly.ai",         externalId: "instantly-ai" },
  { companyName: "Clay",              website: "https://clay.com",             externalId: "clay-com" },
  { companyName: "Smartlead",         website: "https://smartlead.ai",         externalId: "smartlead-ai" },
  { companyName: "Woodpecker",        website: "https://woodpecker.co",        externalId: "woodpecker-co" },
  { companyName: "Reply.io",          website: "https://reply.io",             externalId: "reply-io" },
  { companyName: "Klenty",            website: "https://klenty.com",           externalId: "klenty-com" },
  { companyName: "QuickMail",         website: "https://quickmail.com",        externalId: "quickmail-com" },
  { companyName: "Hunter.io",         website: "https://hunter.io",            externalId: "hunter-io" },
  { companyName: "Dropcontact",       website: "https://dropcontact.com",      externalId: "dropcontact-com" },
  { companyName: "Snov.io",           website: "https://snov.io",              externalId: "snov-io" },
  { companyName: "Expandi",           website: "https://expandi.io",           externalId: "expandi-io" },
  { companyName: "La Growth Machine", website: "https://lagrowthmachine.com",  externalId: "lagrowthmachine-com" },
  { companyName: "Lavender",          website: "https://lavender.ai",          externalId: "lavender-ai" },
  { companyName: "Amplemarket",       website: "https://amplemarket.com",      externalId: "amplemarket-com" },
  // CRM / sales infrastructure with known Apollo usage
  { companyName: "Aircall",           website: "https://aircall.io",           externalId: "aircall-io" },
  { companyName: "Pipedrive",         website: "https://pipedrive.com",        externalId: "pipedrive-com" },
  { companyName: "Close CRM",         website: "https://close.com",            externalId: "close-com" },
  { companyName: "Copper CRM",        website: "https://copper.com",           externalId: "copper-com" },
  { companyName: "Freshsales",        website: "https://freshsales.io",        externalId: "freshsales-io" },
  { companyName: "Gong",              website: "https://gong.io",              externalId: "gong-io" },
  { companyName: "Chorus.ai",         website: "https://chorus.ai",            externalId: "chorus-ai" },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Find the first user
  const user = await prisma.user.findFirst({ select: { id: true, email: true, firstName: true } });
  if (!user) throw new Error("No users found in DB — register first.");
  console.log(`👤 Using user: ${user.email} (${user.id})`);

  // Check if campaign already exists
  const existing = await prisma.campaign.findFirst({
    where: { name: CAMPAIGN_NAME, createdById: user.id, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    console.log(`⚠️  Campaign already exists: ${existing.id} — skipping creation.`);
    console.log(`   View: http://localhost:3000/dashboard/campaigns/${existing.id}`);
    return;
  }

  // Create campaign
  const campaign = await prisma.campaign.create({
    data: {
      name: CAMPAIGN_NAME,
      description:
        "Targets B2B sales teams currently paying for Apollo.io, Outreach, Lemlist, or similar outbound tools. Positions ScoutSend's AI research + hyper-personalised email pipeline as a superior, higher-ROI alternative.",
      icpDescription: CAMPAIGN_ICP,
      targetIndustry: "B2B SaaS / Sales Technology",
      targetRegion: "United States, UK, Canada, Australia",
      dailySendLimit: 40,
      qualificationThreshold: 0.55,
      followUpDelayDays: 4,
      followUpMaxSteps: 3,
      sendWindowStart: 8,
      sendWindowEnd: 17,
      sendWindowDays: [1, 2, 3, 4, 5],
      timezone: "America/New_York",
      status: "DRAFT",
      createdById: user.id,
    },
    select: { id: true, name: true },
  });

  console.log(`✅ Campaign created: ${campaign.id} — "${campaign.name}"`);

  // Add leads
  console.log(`\n📋 Adding ${SEED_LEADS.length} seed leads…`);
  let added = 0;
  let skipped = 0;

  for (const lead of SEED_LEADS) {
    try {
      await prisma.lead.create({
        data: {
          companyName: lead.companyName,
          website: lead.website,
          domain: lead.website.replace(/^https?:\/\/(www\.)?/, ""),
          source: "manual",
          externalId: lead.externalId,
          campaignId: campaign.id,
        },
      });
      console.log(`  ✅  ${lead.companyName}`);
      added++;
    } catch (err: any) {
      if (err?.code === "P2002") {
        console.log(`  ⚠️  Skipped (duplicate): ${lead.companyName}`);
        skipped++;
      } else {
        console.warn(`  ❌  Failed: ${lead.companyName} — ${err?.message ?? err}`);
      }
    }
  }

  console.log(`\n🎉 Done!`);
  console.log(`   Campaign ID    : ${campaign.id}`);
  console.log(`   Leads added    : ${added}`);
  console.log(`   Leads skipped  : ${skipped}`);
  console.log(`   View at        : http://localhost:3000/dashboard/campaigns/${campaign.id}`);
}

main()
  .catch((err) => {
    console.error("💥 Error:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
