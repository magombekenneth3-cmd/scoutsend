import "dotenv/config";
import { prisma } from "./app/api/src/lib/prisma";
import { runLeadScoringAgent } from "./app/api/src/modules/gemini/lead-scoring.agent";

// Helper from research.agent to upsert signals if they aren't populated
async function upsertNewSignals(leadId: string, snapshot: any): Promise<string[]> {
  const signalCandidates = [
    ...(snapshot.hiringSignals || []).map((h: any) => ({
      signalType: "HIRING_SIGNAL" as const,
      value: h.signalValue || h.role || "Hiring",
      confidence: h.confidence || 0.75,
      explanation: h.explanation,
      source: "research_agent",
    })),
    ...(snapshot.fundingEvents || []).map((f: any) => ({
      signalType: "FUNDING_SIGNAL" as const,
      value: f.description,
      confidence: 0.8,
      explanation: f.amount ? `${f.description} — ${f.amount}` : f.description,
      source: "research_agent",
    })),
    ...(snapshot.recentNews || [])
      .filter((n: any) => n.relevance === "HIGH")
      .map((n: any) => ({
        signalType: "GROWTH_SIGNAL" as const,
        value: n.headline.slice(0, 120),
        confidence: 0.7,
        explanation: n.relevanceReason,
        source: "research_agent",
      })),
  ];

  const results = await Promise.allSettled(
    signalCandidates.map(async (s) => {
      await prisma.leadSignal.upsert({
        where: { leadId_signalType_value: { leadId, signalType: s.signalType, value: s.value } },
        create: { leadId, signalType: s.signalType, value: s.value, confidence: s.confidence, source: s.source, explanation: s.explanation },
        update: { lastSeenAt: new Date(), confidence: s.confidence },
      });
      return `${s.signalType}: ${s.value}`;
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
    .map((r) => r.value);
}

async function main() {
  // Find Andrew Cohen lead
  const lead = await prisma.lead.findFirst({
    where: {
      firstName: "Andrew",
      lastName: "Cohen",
      companyName: "Fivetran",
    },
    include: {
      campaign: true,
    },
  });

  if (!lead) {
    console.error("Could not find lead Andrew Cohen at Fivetran");
    return;
  }

  console.log(`Found Lead: ${lead.firstName} ${lead.lastName} (ID: ${lead.id})`);
  console.log(`Campaign: ${lead.campaign.name} (ID: ${lead.campaign.id})`);

  // Find completed research report to fetch snapshot signals
  const report = await prisma.leadResearchReport.findFirst({
    where: { leadId: lead.id, status: "COMPLETE" },
  });

  if (report && report.companySnapshot) {
    console.log("Found completed research report. Extracting and upserting signals...");
    const snapshot = report.companySnapshot as any;
    const upserted = await upsertNewSignals(lead.id, snapshot);
    console.log(`Upserted ${upserted.length} signals:`, upserted);
  } else {
    console.log("No completed research report found or snapshot is empty.");
  }

  const icpDescription = lead.campaign.icpDescription;
  if (!icpDescription) {
    console.error("Campaign has no ICP description. Cannot run scoring.");
    return;
  }

  console.log("Running lead scoring agent...");
  const qualifies = await runLeadScoringAgent(lead.id, icpDescription, true);
  console.log(`Scoring finished! Qualifies: ${qualifies}`);

  // Fetch updated lead details
  const updatedLead = await prisma.lead.findUnique({
    where: { id: lead.id },
    select: {
      id: true,
      qualificationScore: true,
      qualificationReason: true,
      breakdownScores: true,
      recommendedAction: true,
    },
  });

  console.log("=== Updated Lead DB Fields ===");
  console.log(JSON.stringify(updatedLead, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
