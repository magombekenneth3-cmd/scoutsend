import dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.resolve(process.cwd(), ".env") });

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function generateSlug(name: string): string {
    return name
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 48) || "workspace";
}

async function ensureUniqueSlug(base: string): Promise<string> {
    let slug = base;
    let suffix = 0;
    while (true) {
        const candidate = suffix === 0 ? slug : `${slug}-${suffix}`;
        const exists = await prisma.organization.findUnique({ where: { slug: candidate }, select: { id: true } });
        if (!exists) return candidate;
        suffix++;
    }
}

async function main() {
    console.log("[migrate-orgs] Starting idempotent org backfill...");

    const users = await prisma.user.findMany({
        select: { id: true, firstName: true, lastName: true, email: true },
    });

    let created = 0;
    let skipped = 0;

    for (const user of users) {
        const existingMembership = await prisma.organizationMember.findFirst({
            where: { userId: user.id },
            select: { orgId: true },
        });

        if (existingMembership) {
            await backfillOrgId(existingMembership.orgId, user.id);
            skipped++;
            continue;
        }

        const name = `${user.firstName}'s Workspace`;
        const slug = await ensureUniqueSlug(generateSlug(`${user.firstName} ${user.lastName}`));

        const { org } = await prisma.$transaction(async (tx) => {
            const org = await tx.organization.create({
                data: { name, slug },
                select: { id: true },
            });

            await tx.organizationMember.create({
                data: {
                    orgId: org.id,
                    userId: user.id,
                    role: "OWNER",
                    joinedAt: new Date(),
                },
            });

            return { org };
        });

        await backfillOrgId(org.id, user.id);

        console.log(`[migrate-orgs] Created org ${org.id} for user ${user.email}`);
        created++;
    }

    console.log(`[migrate-orgs] Done. Created: ${created}, Already had org: ${skipped}`);
}

async function backfillOrgId(orgId: string, userId: string) {
    await prisma.$transaction([
        prisma.campaign.updateMany({
            where: { createdById: userId },
            data: { orgId },
        }),
        prisma.senderMailbox.updateMany({
            where: { createdById: userId, orgId: null },
            data: { orgId },
        }),
        prisma.senderDomain.updateMany({
            where: { createdById: userId, orgId: null },
            data: { orgId },
        }),
        prisma.suppression.updateMany({
            where: { userId },
            data: { orgId },
        }),
        prisma.linkedInAccount.updateMany({
            where: { createdById: userId, orgId: null },
            data: { orgId },
        }),
        prisma.competitorInsight.updateMany({
            where: { userId, orgId: null },
            data: { orgId },
        }),
        prisma.leadAgentColumn.updateMany({
            where: { createdById: userId, orgId: null },
            data: { orgId },
        }),
    ]);

    const brandSettings = await prisma.brandSettings.findUnique({
        where: { userId },
        select: { orgId: true },
    });
    if (brandSettings && !brandSettings.orgId) {
        await prisma.brandSettings.update({
            where: { userId },
            data: { orgId },
        });
    }
}

main()
    .catch((err) => {
        console.error("[migrate-orgs] Fatal error:", err);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
