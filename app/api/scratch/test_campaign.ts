import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
    const campaignId = "cmr13jr170000kd1zuca89pex";
    const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId },
        include: {
            _count: {
                select: {
                    leads: { where: { deletedAt: null } },
                },
            },
            leads: {
                where: { deletedAt: null },
                take: 50,
            }
        }
    });
    console.log("Campaign from DB:", JSON.stringify(campaign, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
