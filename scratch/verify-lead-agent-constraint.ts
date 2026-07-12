import { prisma } from "@/app/api/src/lib/prisma";
import { Prisma } from "@prisma/client";

async function verify(): Promise<void> {
    const campaign = await prisma.campaign.findFirstOrThrow({
        where: { deletedAt: null },
        select: { id: true, leads: { select: { id: true }, take: 1 } },
    });

    const lead = campaign.leads[0];
    if (!lead) throw new Error("Need at least one lead in a campaign to run this test");

    const column = await prisma.leadAgentColumn.create({
        data: {
            campaignId: campaign.id,
            name: "_constraint_test",
            fieldKey: `_test_${Date.now()}`,
            prompt: "Test prompt for constraint verification.",
            outputType: "TEXT",
            createdById: (await prisma.user.findFirstOrThrow({ select: { id: true } })).id,
        },
    });

    console.log("Created column:", column.id, "fieldKey:", column.fieldKey);

    const run1 = await prisma.leadAgentRun.create({
        data: { leadId: lead.id, columnId: column.id, status: "PENDING" },
        select: { id: true },
    });

    console.log("Run 1 created:", run1.id, "— this should succeed");

    let constraintFired = false;
    try {
        const run2 = await prisma.leadAgentRun.create({
            data: { leadId: lead.id, columnId: column.id, status: "RUNNING" },
            select: { id: true },
        });
        console.error("FAIL — Run 2 was created when it should have been blocked:", run2.id);
    } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
            constraintFired = true;
            console.log("PASS — DB unique constraint blocked the second active run (P2002)");
        } else {
            throw err;
        }
    }

    const completeFirst = await prisma.leadAgentRun.update({
        where: { id: run1.id },
        data: { status: "COMPLETE" },
    });

    console.log("Run 1 moved to COMPLETE:", completeFirst.id);

    const run3 = await prisma.leadAgentRun.create({
        data: { leadId: lead.id, columnId: column.id, status: "PENDING" },
        select: { id: true },
    });

    console.log(
        "PASS — Run 3 created after prior run completed (partial index only blocks PENDING/RUNNING):",
        run3.id,
    );

    await prisma.leadAgentRun.deleteMany({ where: { columnId: column.id } });
    await prisma.leadAgentColumn.delete({ where: { id: column.id } });
    console.log("Cleanup done");

    if (!constraintFired) {
        process.exit(1);
    }

    console.log("\nAll assertions passed. The partial unique index is enforced at DB level.");
}

verify()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });