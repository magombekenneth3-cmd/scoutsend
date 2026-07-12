import "dotenv/config";
import { prisma } from "./app/api/src/lib/prisma";

async function main() {
  const traces = await prisma.aITrace.findMany({
    where: { agentName: { startsWith: "lead-scoring" } },
    orderBy: { createdAt: "desc" },
    take: 5,
  });

  console.log(`\n=== AI Traces (${traces.length} found) ===`);
  for (const t of traces) {
    console.log(`\nID: ${t.id}`);
    console.log(`Agent: ${t.agentName}`);
    console.log(`Model: ${t.model}`);
    console.log(`Latency: ${t.latencyMs}ms`);
    console.log(`Tokens: ${t.tokenUsage}`);
    console.log(`Prompt Preview:\n${t.prompt.substring(0, 500)}...\n`);
    console.log(`Response:\n${t.response}\n`);
    console.log("-----------------------------------------");
  }

  await prisma.$disconnect();
}

main().catch(console.error);
