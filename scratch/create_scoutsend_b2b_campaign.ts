/**
 * Creates the "ScoutSend – B2B Cold Email Tools" campaign directly via the internal API.
 * Targets decision-makers at companies that use Apollo.io, Lemlist, Outreach, Salesloft, etc.
 *
 * Run: cd web && npx ts-node --project tsconfig.json scratch/create_scoutsend_b2b_campaign.ts
 */

const API_BASE = "http://127.0.0.1:8080";

// ── Campaign payload ──────────────────────────────────────────────────────────

const CAMPAIGN = {
  name: "ScoutSend – B2B Cold Email Outbound (Apollo Users)",
  description:
    "Targets B2B sales teams and revenue leaders who are currently paying for Apollo.io, Lemlist, Outreach, or similar cold-outbound tools. Positions ScoutSend's AI research + hyper-personalised email pipeline as a superior, higher-ROI alternative. Focus on SDR teams ≥ 5 reps, companies 50–1 000 employees, SaaS / tech-enabled services verticals.",

  icpDescription: `
We target B2B sales-led companies and SaaS businesses that actively use cold email or outbound prospecting tools such as Apollo.io, Lemlist, Outreach.io, Salesloft, Reply.io, Instantly, or Smartlead.

Ideal prospect profile:
- Company size: 50 – 1 000 employees
- Verticals: B2B SaaS, tech-enabled services, IT consulting, sales agencies, RevOps tooling
- Geography: United States, United Kingdom, Canada, Australia
- Job titles: VP of Sales, Head of Growth, SDR Manager, Revenue Operations Lead, Founder / CEO (≤ 200 employees), Director of Demand Generation
- Pain points: low reply rates on cold email sequences, high Apollo/Outreach seat costs, poor personalisation at scale, domain reputation issues, SDR burnout from manual research
- Buying signals: recently posted SDR job openings, hiring for "outbound", published posts about "cold email deliverability", switched from one cold email tool to another in the last 6 months, raised a Series A or B (scaling go-to-market), tech stack shows Apollo.io or Lemlist via BuiltWith
- Key message angle: ScoutSend replaces an entire SDR research stack — AI agent researches each lead, writes a hyper-personalised email referencing real signals (funding, hiring, tech stack), auto-reviews for spam risk, and sends within daily domain limits to protect deliverability. 3× reply rates, 60% lower cost vs. a full SDR seat.
  `.trim(),

  targetIndustry: "B2B SaaS / Sales Technology",
  targetRegion: "United States, UK, Canada",
  dailySendLimit: 40,
  qualificationThreshold: 0.55,
  followUpDelayDays: 4,
  followUpMaxSteps: 3,

  // Business hours EST
  sendWindowStart: 8,
  sendWindowEnd: 17,
  sendWindowDays: [1, 2, 3, 4, 5], // Mon–Fri

  timezone: "America/New_York",
};

// ── Lead targets (companies known to use Apollo.io / cold outreach tools) ────

const SEED_LEADS = [
  // Sales agencies that resell/use Apollo
  { companyName: "Belkins",         website: "https://belkins.io",         source: "manual", externalId: "belkins-io" },
  { companyName: "Cleverly",        website: "https://cleverly.co",        source: "manual", externalId: "cleverly-co" },
  { companyName: "Martal Group",    website: "https://martal.ca",          source: "manual", externalId: "martal-ca" },
  { companyName: "CIENCE",          website: "https://cience.com",         source: "manual", externalId: "cience-com" },
  { companyName: "SalesPipe",       website: "https://salespipe.co",       source: "manual", externalId: "salespipe-co" },
  { companyName: "Operatix",        website: "https://operatix.net",       source: "manual", externalId: "operatix-net" },
  // B2B SaaS companies with visible SDR teams using Apollo
  { companyName: "Gong",            website: "https://gong.io",            source: "manual", externalId: "gong-io" },
  { companyName: "Outreach",        website: "https://outreach.io",        source: "manual", externalId: "outreach-io" },
  { companyName: "Salesloft",       website: "https://salesloft.com",      source: "manual", externalId: "salesloft-com" },
  { companyName: "Chorus.ai",       website: "https://chorus.ai",          source: "manual", externalId: "chorus-ai" },
  { companyName: "Lavender",        website: "https://lavender.ai",        source: "manual", externalId: "lavender-ai" },
  { companyName: "Amplemarket",     website: "https://amplemarket.com",    source: "manual", externalId: "amplemarket-com" },
  { companyName: "Lemlist",         website: "https://lemlist.com",        source: "manual", externalId: "lemlist-com" },
  { companyName: "Instantly",       website: "https://instantly.ai",       source: "manual", externalId: "instantly-ai" },
  { companyName: "Clay",            website: "https://clay.com",           source: "manual", externalId: "clay-com" },
  { companyName: "Smartlead",       website: "https://smartlead.ai",       source: "manual", externalId: "smartlead-ai" },
  { companyName: "Woodpecker",      website: "https://woodpecker.co",      source: "manual", externalId: "woodpecker-co" },
  { companyName: "Reply.io",        website: "https://reply.io",           source: "manual", externalId: "reply-io" },
  { companyName: "Klenty",          website: "https://klenty.com",         source: "manual", externalId: "klenty-com" },
  { companyName: "QuickMail",       website: "https://quickmail.com",      source: "manual", externalId: "quickmail-com" },
  { companyName: "Hunter.io",       website: "https://hunter.io",          source: "manual", externalId: "hunter-io" },
  { companyName: "Dropcontact",     website: "https://dropcontact.com",    source: "manual", externalId: "dropcontact-com" },
  { companyName: "Snov.io",         website: "https://snov.io",            source: "manual", externalId: "snov-io" },
  { companyName: "Expandi",         website: "https://expandi.io",         source: "manual", externalId: "expandi-io" },
  { companyName: "La Growth Machine", website: "https://lagrowthmachine.com", source: "manual", externalId: "lagrowthmachine-com" },
  // SaaS companies with known Apollo tech stack
  { companyName: "Aircall",         website: "https://aircall.io",         source: "manual", externalId: "aircall-io" },
  { companyName: "Pipedrive",       website: "https://pipedrive.com",      source: "manual", externalId: "pipedrive-com" },
  { companyName: "Close CRM",       website: "https://close.com",          source: "manual", externalId: "close-com" },
  { companyName: "Copper CRM",      website: "https://copper.com",         source: "manual", externalId: "copper-com" },
  { companyName: "Freshsales",      website: "https://freshsales.io",      source: "manual", externalId: "freshsales-io" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function login(): Promise<string> {
  // Try to authenticate with the first existing user in the DB
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@scoutsend.io", password: "admin123" }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Login failed (${res.status}): ${JSON.stringify(body)}`);
  }

  const data = await res.json();
  const token = data.token ?? data.accessToken ?? data.access_token;
  if (!token) throw new Error(`No token in login response: ${JSON.stringify(data)}`);
  console.log("✅ Authenticated");
  return token as string;
}

async function createCampaign(token: string): Promise<string> {
  const res = await fetch(`${API_BASE}/campaigns`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(CAMPAIGN),
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Campaign creation failed (${res.status}): ${JSON.stringify(data)}`);
  }
  console.log(`✅ Campaign created: ${data.id} — "${data.name}"`);
  return data.id as string;
}

async function addLead(token: string, campaignId: string, lead: (typeof SEED_LEADS)[0]): Promise<void> {
  const res = await fetch(`${API_BASE}/leads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ...lead, campaignId }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    // Duplicate is fine (409) — just skip
    if (res.status === 409) {
      console.log(`  ⚠️  Skipped (duplicate): ${lead.companyName}`);
      return;
    }
    console.warn(`  ❌  Failed to add lead ${lead.companyName} (${res.status}): ${JSON.stringify(body)}`);
    return;
  }

  const data = await res.json();
  console.log(`  ✅  Lead added: ${lead.companyName} (${data.id})`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🚀 Creating ScoutSend B2B Campaign…\n");

  const token = await login();
  const campaignId = await createCampaign(token);

  console.log(`\n📋 Adding ${SEED_LEADS.length} seed leads…`);
  for (const lead of SEED_LEADS) {
    await addLead(token, campaignId, lead);
  }

  console.log(`\n🎉 Done!`);
  console.log(`   Campaign ID : ${campaignId}`);
  console.log(`   View at     : http://localhost:3000/dashboard/campaigns/${campaignId}`);
}

main().catch((err) => {
  console.error("💥 Error:", err.message ?? err);
  process.exit(1);
});

export {};

