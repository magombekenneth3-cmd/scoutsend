import { prisma } from "../app/api/src/lib/prisma";

async function testQueryWithoutSnoozed() {
  const user = await prisma.user.findFirst();
  if (!user) {
    console.log("No user found");
    return;
  }

  const userId = user.id;
  const whereWithoutSnoozed = {
    lead: { campaign: { createdById: userId } },
  };

  const orderBy = [{ createdAt: "desc" as const }, { id: "desc" as const }];

  const [total, pageIds] = await Promise.all([
    prisma.reply.count({ where: whereWithoutSnoozed }),
    prisma.reply.findMany({ where: whereWithoutSnoozed, select: { id: true }, orderBy, skip: 0, take: 20 }),
  ]);

  console.log("Total replies found:", total);
  console.log("Page IDs count:", pageIds.length);

  if (pageIds.length > 0) {
    const replies = await prisma.reply.findMany({
      where: { id: { in: pageIds.map(r => r.id) } },
      orderBy,
      include: {
        lead: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            companyName: true,
            pipelineStage: true,
          },
        },
        outreachMessage: {
          select: { id: true, subject: true, deliveryState: true },
        },
      },
    });
    console.log("Fetched replies count:", replies.length);
  }
}

testQueryWithoutSnoozed()
  .then(() => console.log("SUCCESS! Query ran cleanly without snoozedUntil"))
  .catch((err) => console.error("FAILED:", err))
  .finally(() => prisma.$disconnect());
