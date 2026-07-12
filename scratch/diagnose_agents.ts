import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";

async function main() {
  console.log("=== DIAGNOSING AGENT ISSUES ===");

  // 1. Failed Lead Agent Runs
  const failedAgentRuns = await prisma.leadAgentRun.findMany({
    where: { status: "FAILED" },
    include: {
      column: { select: { name: true, prompt: true } },
      lead: { select: { companyName: true, firstName: true, lastName: true } }
    },
    orderBy: { startedAt: "desc" },
    take: 5
  });
  console.log(`\n--- Failed LeadAgentRuns (${failedAgentRuns.length} recent) ---`);
  for (const r of failedAgentRuns) {
    console.log(`Run ID: ${r.id}`);
    console.log(`Lead: ${r.lead.firstName} ${r.lead.lastName} (${r.lead.companyName})`);
    console.log(`Column / Agent: ${r.column.name}`);
    console.log(`Prompt: ${r.column.prompt}`);
    console.log(`Error: ${r.errorMessage}`);
    console.log(`Started: ${r.startedAt}`);
    console.log("------------------------");
  }

  // 2. Failed Discovery Runs
  const failedDiscovery = await prisma.discoveryRun.findMany({
    where: { status: "FAILED" },
    orderBy: { startedAt: "desc" },
    take: 5
  });
  console.log(`\n--- Failed DiscoveryRuns (${failedDiscovery.length} recent) ---`);
  for (const d of failedDiscovery) {
    console.log(`Run ID: ${d.id}`);
    console.log(`Source: ${d.sourceType}`);
    console.log(`Query: ${d.query}`);
    console.log(`Error: ${d.errorMessage}`);
    console.log(`Started: ${d.startedAt}`);
    console.log("------------------------");
  }

  // 3. Failed Lead Research Reports
  const failedResearch = await prisma.leadResearchReport.findMany({
    where: { status: "FAILED" },
    include: {
      lead: { select: { companyName: true, firstName: true, lastName: true } }
    },
    orderBy: { startedAt: "desc" },
    take: 5
  });
  console.log(`\n--- Failed LeadResearchReports (${failedResearch.length} recent) ---`);
  for (const r of failedResearch) {
    console.log(`Report ID: ${r.id}`);
    console.log(`Lead: ${r.lead.firstName} ${r.lead.lastName} (${r.lead.companyName})`);
    console.log(`Error: ${r.errorMessage}`);
    console.log(`Started: ${r.startedAt}`);
    console.log("------------------------");
  }

  // 4. Failed Queue Jobs
  const failedJobs = await prisma.queueJob.findMany({
    where: { status: "FAILED" },
    orderBy: { createdAt: "desc" },
    take: 5
  });
  console.log(`\n--- Failed QueueJobs (${failedJobs.length} recent) ---`);
  for (const j of failedJobs) {
    console.log(`Job ID: ${j.id}`);
    console.log(`Queue: ${j.queueName}`);
    console.log(`Job Type: ${j.jobType}`);
    console.log(`Error: ${j.errorMessage}`);
    console.log(`Created: ${j.createdAt}`);
    console.log("------------------------");
  }

  // 5. Recent AITraces with suspected errors
  // We can query AI traces. Some might contain error keywords in prompt/response or have unusually low/high latency
  const recentTraces = await prisma.aITrace.findMany({
    orderBy: { createdAt: "desc" },
    take: 10
  });
  console.log(`\n--- Recent AI Traces ---`);
  for (const t of recentTraces) {
    const hasError = t.response.toLowerCase().includes("error") || t.response.toLowerCase().includes("fail") || t.response.toLowerCase().includes("exception");
    if (hasError) {
      console.log(`Trace ID: ${t.id}`);
      console.log(`Agent Name: ${t.agentName}`);
      console.log(`Model: ${t.model}`);
      console.log(`Latency: ${t.latencyMs}ms`);
      console.log(`Response Snippet:\n${t.response.substring(0, 300)}...`);
      console.log("------------------------");
    }
  }

  await prisma.$disconnect();
}

main().catch(console.error);
