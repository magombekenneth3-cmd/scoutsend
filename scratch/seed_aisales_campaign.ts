import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import path from "path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env"), override: false });

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL!, max: 5 });
const prisma = new PrismaClient({ adapter });

const CAMPAIGN_NAME = "AISales — Outbound Tool Buyers";

const ICP = `
B2B SaaS and services companies with active outbound sales teams currently paying for tools like Apollo.io, Instantly, Smartlead, Clay, Lemlist, Outreach, or Salesloft.
- SDR/BDR teams of 2–30 reps doing cold email and LinkedIn
- Revenue: $2M–$100M ARR or Series A/B/C funded
- Pain: low reply rates, poor personalization, manual research bottleneck, rising inbox costs
- Tech signals: using Apollo, Clay, Instantly, Smartlead, Lemlist, Outreach, HubSpot Sequences
- Hiring: SDR, BDR, Outbound Lead, VP Sales, RevOps
- Personas: VP Sales, Head of Growth, Revenue Operations, Co-Founder (sales-led)
- Exclude: pure inbound-only, enterprise 1000+, B2C
`.trim();

const LEADS = [
  {
    companyName: "Rippling",
    website: "rippling.com",
    domain: "rippling.com",
    linkedinUrl: "https://www.linkedin.com/in/matt-plank",
    firstName: "Matt",
    lastName: "Plank",
    title: "President & Head of Sales",
    seniority: "C-Level",
    department: "Sales",
    competitorTech: ["apollo.io", "outreach.io"],
  },
  {
    companyName: "Deel",
    website: "deel.com",
    domain: "deel.com",
    linkedinUrl: "https://www.linkedin.com/in/sanjay-katyal",
    firstName: "Sanjay",
    lastName: "Katyal",
    title: "VP of Sales",
    seniority: "VP",
    department: "Sales",
    competitorTech: ["apollo.io", "instantly.ai"],
  },
  {
    companyName: "Gong",
    website: "gong.io",
    domain: "gong.io",
    linkedinUrl: "https://www.linkedin.com/in/amitbendov",
    firstName: "Amit",
    lastName: "Bendov",
    title: "CEO & Co-Founder",
    seniority: "C-Level",
    department: "Executive",
    competitorTech: ["salesloft.com", "outreach.io"],
  },
  {
    companyName: "Clari",
    website: "clari.com",
    domain: "clari.com",
    linkedinUrl: "https://www.linkedin.com/in/andybyrne",
    firstName: "Andy",
    lastName: "Byrne",
    title: "CEO",
    seniority: "C-Level",
    department: "Executive",
    competitorTech: ["outreach.io", "apollo.io"],
  },
  {
    companyName: "Chili Piper",
    website: "chilipiper.com",
    domain: "chilipiper.com",
    linkedinUrl: "https://www.linkedin.com/in/nicolasvandenberghe",
    firstName: "Nicolas",
    lastName: "Vandenberghe",
    title: "CEO & Co-Founder",
    seniority: "C-Level",
    department: "Executive",
    competitorTech: ["lemlist.com", "instantly.ai"],
  },
  {
    companyName: "Dooly",
    website: "dooly.ai",
    domain: "dooly.ai",
    linkedinUrl: "https://www.linkedin.com/in/krishartvigsen",
    firstName: "Kris",
    lastName: "Hartvigsen",
    title: "CEO & Founder",
    seniority: "C-Level",
    department: "Executive",
    competitorTech: ["apollo.io", "salesloft.com"],
  },
  {
    companyName: "Sendoso",
    website: "sendoso.com",
    domain: "sendoso.com",
    linkedinUrl: "https://www.linkedin.com/in/krisrudeegraap",
    firstName: "Kris",
    lastName: "Rudeegraap",
    title: "CEO & Co-Founder",
    seniority: "C-Level",
    department: "Executive",
    competitorTech: ["outreach.io", "salesloft.com"],
  },
  {
    companyName: "People.ai",
    website: "people.ai",
    domain: "people.ai",
    linkedinUrl: "https://www.linkedin.com/in/oleg-rogynskyy",
    firstName: "Oleg",
    lastName: "Rogynskyy",
    title: "CEO & Founder",
    seniority: "C-Level",
    department: "Executive",
    competitorTech: ["outreach.io", "apollo.io"],
  },
  {
    companyName: "Qualified",
    website: "qualified.com",
    domain: "qualified.com",
    linkedinUrl: "https://www.linkedin.com/in/krystynageyer",
    firstName: "Krystyn",
    lastName: "Geyer",
    title: "VP of Sales",
    seniority: "VP",
    department: "Sales",
    competitorTech: ["apollo.io", "instantly.ai"],
  },
  {
    companyName: "Bombora",
    website: "bombora.com",
    domain: "bombora.com",
    linkedinUrl: "https://www.linkedin.com/in/erikmatlick",
    firstName: "Erik",
    lastName: "Matlick",
    title: "CEO & Co-Founder",
    seniority: "C-Level",
    department: "Executive",
    competitorTech: ["clay.com", "apollo.io"],
  },
  {
    companyName: "6sense",
    website: "6sense.com",
    domain: "6sense.com",
    linkedinUrl: "https://www.linkedin.com/in/jasonzintak",
    firstName: "Jason",
    lastName: "Zintak",
    title: "CEO",
    seniority: "C-Level",
    department: "Executive",
    competitorTech: ["outreach.io", "apollo.io"],
  },
  {
    companyName: "Mixmax",
    website: "mixmax.com",
    domain: "mixmax.com",
    linkedinUrl: "https://www.linkedin.com/in/olofmathe",
    firstName: "Olof",
    lastName: "Mathé",
    title: "CEO & Co-Founder",
    seniority: "C-Level",
    department: "Executive",
    competitorTech: ["instantly.ai", "smartlead.ai"],
  },
  {
    companyName: "Groove",
    website: "groove.co",
    domain: "groove.co",
    linkedinUrl: "https://www.linkedin.com/in/chrisrothstein",
    firstName: "Chris",
    lastName: "Rothstein",
    title: "CEO & Co-Founder",
    seniority: "C-Level",
    department: "Executive",
    competitorTech: ["salesloft.com", "outreach.io"],
  },
  {
    companyName: "Loxo",
    website: "loxo.co",
    domain: "loxo.co",
    linkedinUrl: "https://www.linkedin.com/in/mchamberlain",
    firstName: "Matt",
    lastName: "Chambers",
    title: "CEO",
    seniority: "C-Level",
    department: "Executive",
    competitorTech: ["apollo.io", "clay.com"],
  },
  {
    companyName: "Chargebee",
    website: "chargebee.com",
    domain: "chargebee.com",
    linkedinUrl: "https://www.linkedin.com/in/krish-subramanian",
    firstName: "Krish",
    lastName: "Subramanian",
    title: "CEO & Co-Founder",
    seniority: "C-Level",
    department: "Executive",
    competitorTech: ["apollo.io", "instantly.ai"],
  },
  {
    companyName: "Drift",
    website: "drift.com",
    domain: "drift.com",
    linkedinUrl: "https://www.linkedin.com/in/timask",
    firstName: "Tim",
    lastName: "Osman",
    title: "VP of Sales",
    seniority: "VP",
    department: "Sales",
    competitorTech: ["salesloft.com", "outreach.io"],
  },
  {
    companyName: "Intercom",
    website: "intercom.com",
    domain: "intercom.com",
    linkedinUrl: "https://www.linkedin.com/in/bobby-tindall",
    firstName: "Bobby",
    lastName: "Tindall",
    title: "VP of Sales",
    seniority: "VP",
    department: "Sales",
    competitorTech: ["outreach.io", "apollo.io"],
  },
  {
    companyName: "Lattice",
    website: "lattice.com",
    domain: "lattice.com",
    linkedinUrl: "https://www.linkedin.com/in/jackiesmith",
    firstName: "Jackie",
    lastName: "Smith",
    title: "VP of Sales",
    seniority: "VP",
    department: "Sales",
    competitorTech: ["apollo.io", "clay.com"],
  },
  {
    companyName: "Leapsome",
    website: "leapsome.com",
    domain: "leapsome.com",
    linkedinUrl: "https://www.linkedin.com/in/jenniferhunt",
    firstName: "Jennifer",
    lastName: "Hunt",
    title: "VP of Sales",
    seniority: "VP",
    department: "Sales",
    competitorTech: ["lemlist.com", "instantly.ai"],
  },
  {
    companyName: "Fivetran",
    website: "fivetran.com",
    domain: "fivetran.com",
    linkedinUrl: "https://www.linkedin.com/in/andrewcohen",
    firstName: "Andrew",
    lastName: "Cohen",
    title: "VP of Sales",
    seniority: "VP",
    department: "Sales",
    competitorTech: ["outreach.io", "salesloft.com"],
  },
];

async function main() {
  const owner = await prisma.user.findFirst({
    where: { role: "ADMIN" },
    select: { id: true, email: true },
    orderBy: { createdAt: "asc" },
  });

  if (!owner) throw new Error("No ADMIN user found.");
  console.log(`\nSeeding as: ${owner.email} (${owner.id})`);

  const existing = await prisma.campaign.findFirst({
    where: { name: CAMPAIGN_NAME, createdById: owner.id },
    select: { id: true },
  });

  if (existing) {
    console.log(`\nCampaign already exists: ${existing.id}`);
    console.log("Delete it first to re-seed.");
    return;
  }

  const campaign = await prisma.campaign.create({
    data: {
      name: CAMPAIGN_NAME,
      description: "Outbound to B2B sales leaders at growth-stage companies actively paying for Apollo, Clay, Instantly, Smartlead, or Outreach — our direct displacement targets.",
      icpDescription: ICP,
      status: "DRAFT",
      targetIndustry: "B2B SaaS / Sales-led Growth",
      targetRegion: "Global (EN)",
      dailySendLimit: 40,
      qualificationThreshold: 0.6,
      followUpDelayDays: 3,
      followUpMaxSteps: 3,
      createdById: owner.id,
    },
  });

  console.log(`\n✅  Campaign created: "${campaign.name}" (${campaign.id})`);

  let created = 0;
  let skipped = 0;

  for (const { competitorTech, ...rest } of LEADS) {
    try {
      await prisma.lead.create({
        data: {
          ...rest,
          campaignId: campaign.id,
          competitorSignal: true,
          competitorTech,
          source: "manual_seed",
        },
      });
      console.log(`  ✓  ${rest.companyName} — ${rest.firstName} ${rest.lastName} (${rest.title})`);
      created++;
    } catch (err: any) {
      if (err?.code === "P2002") {
        console.log(`  ⚠  ${rest.companyName} — duplicate, skipped`);
        skipped++;
      } else {
        throw err;
      }
    }
  }

  console.log(`\n✅  Done — ${created} leads created, ${skipped} skipped.`);
  console.log(`\nAll leads have competitorSignal=true and competitorTech populated.`);
  console.log(`Open Campaign → "${campaign.name}" and trigger deep research on any lead.`);
}

main()
  .catch((e) => { console.error("❌", e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
