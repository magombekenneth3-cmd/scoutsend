import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";

async function main() {
  const campaigns = await prisma.campaign.findMany({
    select: {
      id: true,
      name: true,
      status: true,
      icpDescription: true,
      sequenceSteps: {
        select: {
          stepIndex: true,
          channel: true,
          subjectTemplate: true,
          messageTemplate: true,
        }
      }
    }
  });

  console.log("=== Campaigns & Steps ===");
  console.log(JSON.stringify(campaigns, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
