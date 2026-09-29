import { NextResponse } from "next/server";
import { EmailStatus } from "@prisma/client";
import { prisma } from "../../src/lib/prisma";
import { getServerSession } from "../../src/lib/session";

export async function POST(req: Request) {
  try {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { prospects = [], campaignId: requestedCampaignId } = body;

    if (!Array.isArray(prospects) || prospects.length === 0) {
      return NextResponse.json(
        { success: false, error: "No prospects provided" },
        { status: 400 }
      );
    }

    let targetCampaignId = requestedCampaignId;

    if (targetCampaignId) {
      const owned = await prisma.campaign.findFirst({
        where: { id: targetCampaignId, createdById: session.userId, deletedAt: null },
        select: { id: true },
      });
      if (!owned) {
        return NextResponse.json({ success: false, error: "Campaign not found or unauthorized" }, { status: 403 });
      }
    } else {
      let defaultCampaign = await prisma.campaign.findFirst({
        where: { name: "Apollo Discovered Leads", createdById: session.userId, deletedAt: null },
        select: { id: true },
      });

      if (!defaultCampaign) {
        const user = await prisma.user.findUnique({
          where: { id: session.userId },
          select: {
            id: true,
            orgMemberships: { select: { orgId: true }, take: 1 },
          },
        });
        if (!user || user.orgMemberships.length === 0) {
          return NextResponse.json(
            { success: false, error: "User has no organization" },
            { status: 500 }
          );
        }

        const orgId = user.orgMemberships[0].orgId;
        defaultCampaign = await prisma.campaign.create({
          data: {
            name: "Apollo Discovered Leads",
            description: "Default repository for prospects discovered via Apollo search",
            status: "DRAFT",
            createdById: user.id,
            orgId,
            icpDescription: "General B2B Decision Makers discovered via Apollo prospecting",
          },
          select: { id: true },
        });
      }

      targetCampaignId = defaultCampaign.id;
    }

    let inserted = 0;

    for (const p of prospects) {
      try {
        const existing = await prisma.lead.findFirst({
          where: {
            campaignId: targetCampaignId,
            OR: [
              ...(p.email ? [{ email: p.email.toLowerCase() }] : []),
              {
                firstName: p.firstName,
                lastName: p.lastName,
                companyName: p.companyName,
              },
            ],
          },
          select: { id: true },
        });

        if (existing) continue;

        const emailStatus: EmailStatus = p.email ? EmailStatus.FOUND : EmailStatus.NOT_ATTEMPTED;

        await prisma.lead.create({
          data: {
            campaignId: targetCampaignId,
            firstName: p.firstName || null,
            lastName: p.lastName || null,
            email: p.email ? p.email.toLowerCase() : null,
            emailStatus,
            emailVerified: p.emailStatus === "VERIFIED",
            title: p.title || null,
            companyName: p.companyName,
            website: p.website || null,
            linkedinUrl: p.linkedinUrl || null,
            qualificationScore: p.qualificationScore || 0.75,
            qualificationReason: "Discovered via Apollo B2B Lead Search",
            source: "APOLLO_DISCOVERY",
            pipelineStage: "PROSPECT",
            seniority: p.seniority || null,
            signals: {
              create: [
                {
                  signalType: "INTENT_SIGNAL",
                  value: `${p.title || "Decision Maker"} at ${p.companyName}`,
                  confidence: 0.85,
                  explanation: "Matched via Apollo Search criteria",
                },
              ],
            },
          },
        });

        inserted++;
      } catch { }
    }

    return NextResponse.json({
      success: true,
      message: `Successfully saved ${inserted} leads to database`,
      inserted,
      campaignId: targetCampaignId,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to save prospects to database" },
      { status: 500 }
    );
  }
}
