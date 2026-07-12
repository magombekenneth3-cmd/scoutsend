import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/api/src/lib/prisma";
import { getServerSession } from "@/app/api/src/lib/session";
import { z } from "zod";

const WeightsSchema = z.object({
    icpMatch:       z.number().min(0).max(1),
    intentStrength: z.number().min(0).max(1),
    fundingSignals: z.number().min(0).max(1),
    hiringVelocity: z.number().min(0).max(1),
    techFit:        z.number().min(0).max(1),
    recency:        z.number().min(0).max(1),
}).refine(w => Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1.0) < 0.001, {
    message: "Weights must sum to 100%",
});

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const weights = await prisma.campaignScoringWeights.findUnique({
        where: { campaignId: id },
    });

    return NextResponse.json(weights ?? {
        icpMatch: 0.25,
        intentStrength: 0.30,
        fundingSignals: 0.15,
        hiringVelocity: 0.15,
        techFit: 0.10,
        recency: 0.05,
    });
}

export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await req.json();
    const parsed = WeightsSchema.safeParse(body);
    if (!parsed.success) {
        return NextResponse.json({ error: parsed.error.flatten().formErrors[0] }, { status: 400 });
    }

    const campaign = await prisma.campaign.findFirst({
        where: { id, createdById: session.userId },
        select: { id: true },
    });
    if (!campaign) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const weights = await prisma.campaignScoringWeights.upsert({
        where: { campaignId: id },
        create: { campaignId: id, ...parsed.data },
        update: parsed.data,
    });

    return NextResponse.json(weights);
}
