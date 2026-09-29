import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/api/src/lib/prisma";
import { getServerSession } from "@/app/api/src/lib/session";
import { fetchCompetitorSentiments } from "@/app/api/src/modules/gemini/competitor-sentiment.agent";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const toolsParam = req.nextUrl.searchParams.get("tools") ?? "";
    const requestedTools = toolsParam
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);

    if (requestedTools.length === 0) {
        const all = await prisma.competitorInsight.findMany({
            where: { userId: session.userId },
            orderBy: [{ tool: "asc" }, { severity: "asc" }],
        });
        return NextResponse.json(all);
    }

    const forceRefresh = req.nextUrl.searchParams.get("refresh") === "1";
    const cutoff = new Date(Date.now() - CACHE_TTL_MS);
    const staleOrMissingTools: string[] = [];

    for (const tool of requestedTools) {
        if (forceRefresh) {
            staleOrMissingTools.push(tool);
        } else {
            const count = await prisma.competitorInsight.count({
                where: { userId: session.userId, tool, fetchedAt: { gte: cutoff } },
            });
            if (count === 0) staleOrMissingTools.push(tool);
        }
    }

    if (staleOrMissingTools.length > 0) {
        const sentiments = await fetchCompetitorSentiments(staleOrMissingTools);

        for (const { tool, painPoints } of sentiments) {
            for (const pp of painPoints) {
                await prisma.competitorInsight.upsert({
                    where: { userId_tool_painPoint: { userId: session.userId, tool, painPoint: pp.painPoint } },
                    create: {
                        userId: session.userId,
                        tool,
                        painPoint: pp.painPoint,
                        sentiment: pp.sentiment,
                        source: pp.source,
                        severity: pp.severity,
                        fetchedAt: new Date(),
                    },
                    update: {
                        sentiment: pp.sentiment,
                        source: pp.source,
                        severity: pp.severity,
                        fetchedAt: new Date(),
                    },
                });
            }
        }
    }

    const insights = await prisma.competitorInsight.findMany({
        where: { userId: session.userId, tool: { in: requestedTools } },
        orderBy: [{ tool: "asc" }, { severity: "asc" }],
    });

    return NextResponse.json(insights);
}

export async function POST(req: NextRequest) {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { id, userFixesIt, userNote } = body as {
        id: string;
        userFixesIt: boolean | null;
        userNote?: string;
    };

    if (!id || typeof id !== "string") {
        return NextResponse.json({ error: "id required" }, { status: 400 });
    }

    const insight = await prisma.competitorInsight.findFirst({
        where: { id, userId: session.userId },
    });
    if (!insight) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const updated = await prisma.competitorInsight.update({
        where: { id },
        data: {
            userFixesIt: typeof userFixesIt === "boolean" ? userFixesIt : null,
            userNote: typeof userNote === "string" ? userNote.trim() || null : undefined,
        },
    });

    return NextResponse.json(updated);
}
