import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";
import { processReplyAI } from "../app/api/src/modules/replies/replies.services";

async function main() {
    const reply = await prisma.reply.findFirst({
        orderBy: { createdAt: "desc" },
        select: { id: true, intent: true, body: true },
    });
    if (!reply) { console.log("No replies found"); return; }
    console.log("Processing reply:", reply.id, "current intent:", reply.intent);
    await processReplyAI(reply.id);
    const updated = await prisma.reply.findUnique({
        where: { id: reply.id },
        select: { intent: true, sentimentScore: true, confidence: true },
    });
    console.log("Updated:", updated);
}

main()
    .catch((e) => { console.error(e); process.exit(1); })
    .finally(() => prisma.$disconnect());