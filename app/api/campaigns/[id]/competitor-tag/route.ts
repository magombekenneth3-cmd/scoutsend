import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "@/app/api/src/lib/session";
import { prisma } from "@/app/api/src/lib/prisma";

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id: campaignId } = await params;
    const { tool } = await req.json() as { tool?: string };
    if (!tool || typeof tool !== "string") {
        return NextResponse.json({ error: "tool is required" }, { status: 400 });
    }

    const campaign = await prisma.campaign.findFirst({
        where: { id: campaignId, createdById: session.userId },
        select: { id: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const updated = await prisma.lead.updateMany({
        where: {
            campaignId,
            deletedAt: null,
            competitorSignal: false,
        },
        data: {
            competitorSignal: true,
        },
    });

    const leads = await prisma.lead.findMany({
        where: { campaignId, deletedAt: null, competitorSignal: true },
        select: { id: true, competitorTech: true },
    });

    await Promise.allSettled(
        leads
            .filter((l) => !(l.competitorTech as string[]).includes(tool))
            .map((l) =>
                prisma.lead.update({
                    where: { id: l.id },
                    data: { competitorTech: { push: tool } },
                })
            )
    );

    return NextResponse.json({ tagged: updated.count });
}
