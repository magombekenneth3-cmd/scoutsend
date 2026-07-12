import "dotenv/config";
import { prisma } from "../app/api/src/lib/prisma";

async function main() {
  const campaign = await prisma.campaign.findUnique({
    where: { id: "cmr13jr170000kd1zuca89pex" },
  });
  console.log("Campaign cmr13jr170000kd1zuca89pex:", campaign);

  const leads = await prisma.lead.findMany({
    where: { campaignId: "cmr13jr170000kd1zuca89pex" },
  });
  console.log("Leads in campaign cmr13jr170000kd1zuca89pex:", leads);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
