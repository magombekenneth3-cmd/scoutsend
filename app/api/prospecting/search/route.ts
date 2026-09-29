import { NextResponse } from "next/server";
import { prisma } from "../../src/lib/prisma";
import { apolloPeopleSearchMultiPage } from "../../src/modules/gemini/discoveryLib/Apollo.provider";
import { getServerSession } from "../../src/lib/session";

export async function POST(req: Request) {
  try {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const {
      q,
      titles = [],
      seniorities = [],
      locations = [],
      industries = [],
      employeeRanges = [],
      fundingStages = [],
      signals = [],
      technologies = [],
      page = 1,
      limit = 100,
    } = body;

    let apolloResults: any[] = [];
    try {
      const searchTitles = titles.length > 0 ? titles : q ? [q] : ["Founder", "CEO", "VP Sales"];
      const rawPeople = await apolloPeopleSearchMultiPage({
        titles: searchTitles,
        industry: industries[0],
        region: locations[0],
        seniority: seniorities,
        employeeRanges,
        fundingStages,
        technologies,
        maxPages: 4,
      });

      apolloResults = rawPeople.map((person: any, idx: number) => {
        const company = person.organization_name || person.organization?.name || "Company";
        const hasEmail = Boolean(person.email);

        const detectedSignals = [];
        if (fundingStages.length > 0 || person.organization?.latest_funding_stage) {
          detectedSignals.push({ signalType: "FUNDING_SIGNAL", confidence: 0.92, explanation: `Funding stage: ${person.organization?.latest_funding_stage || fundingStages[0] || "Active"}` });
        }
        if (signals.includes("HIRING") || person.organization?.hiring_job_count > 0) {
          detectedSignals.push({ signalType: "HIRING_SIGNAL", confidence: 0.88, explanation: "Active engineering & sales hiring surge" });
        }
        if (signals.includes("GROWTH")) {
          detectedSignals.push({ signalType: "GROWTH_SIGNAL", confidence: 0.85, explanation: "Quarterly headcount growth > 15%" });
        }
        if (technologies.length > 0) {
          detectedSignals.push({ signalType: "TECH_SIGNAL", confidence: 0.90, explanation: `Tech stack match: ${technologies.join(", ")}` });
        }
        if (detectedSignals.length === 0) {
          detectedSignals.push({ signalType: "INTENT_SIGNAL", confidence: 0.85, explanation: `${person.title || "Executive"} at ${company}` });
        }

        return {
          id: `lead-${person.id || idx}`,
          externalId: person.id,
          firstName: person.first_name || person.name?.split(" ")[0] || "Prospect",
          lastName: person.last_name || person.name?.split(" ").slice(1).join(" ") || "",
          companyName: company,
          website: person.organization?.website_url || person.website_url || null,
          title: person.title || "Decision Maker",
          email: person.email || null,
          emailStatus: hasEmail ? "VERIFIED" : "UNVERIFIED",
          seniority: person.seniority || seniorities[0] || "Executive",
          location: person.city ? `${person.city}, ${person.state || person.country || ""}` : locations[0] || person.country || "United States",
          linkedinUrl: person.linkedin_url || person.organization?.linkedin_url || null,
          qualificationScore: hasEmail ? 0.92 : 0.80,
          source: "SCOUT_ENGINE",
          signals: detectedSignals,
        };
      });
    } catch { }

    const where: any = { deletedAt: null, campaign: { createdById: session.userId } };
    if (q) {
      where.OR = [
        { companyName: { contains: q, mode: "insensitive" } },
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { title: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ];
    }
    if (titles.length > 0) {
      where.title = { in: titles, mode: "insensitive" };
    }
    if (signals.length > 0) {
      where.signals = {
        some: {
          signalType: { in: signals.map((s: string) => `${s}_SIGNAL`) },
        },
      };
    }

    const dbLeads = await prisma.lead.findMany({
      where,
      take: limit,
      skip: (page - 1) * limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        companyName: true,
        website: true,
        title: true,
        email: true,
        emailStatus: true,
        seniority: true,
        department: true,
        qualificationScore: true,
        source: true,
        signals: {
          select: { signalType: true, confidence: true, explanation: true },
          take: 3,
        },
      },
    });

    const formattedDbLeads = dbLeads.map((l: any) => ({
      id: l.id,
      externalId: l.id,
      firstName: l.firstName || "",
      lastName: l.lastName || "",
      companyName: l.companyName,
      website: l.website,
      title: l.title || "Professional",
      email: l.email,
      emailStatus: l.emailStatus || (l.email ? "VERIFIED" : "UNVERIFIED"),
      seniority: l.seniority || "Mid-Senior",
      location: "United States",
      qualificationScore: l.qualificationScore || 0.75,
      source: l.source || "DATABASE",
      signals: l.signals.length > 0 ? l.signals : [{ signalType: "INTENT_SIGNAL", confidence: 0.75, explanation: "Target ICP match" }],
    }));

    const combined = [...apolloResults, ...formattedDbLeads];
    const uniqueMap = new Map();
    for (const item of combined) {
      const key = `${item.firstName}-${item.lastName}-${item.companyName}`.toLowerCase();
      if (!uniqueMap.has(key)) uniqueMap.set(key, item);
    }
    const finalResults = Array.from(uniqueMap.values());

    return NextResponse.json({
      success: true,
      data: finalResults,
      meta: {
        page,
        limit,
        total: finalResults.length,
        sources: {
          scoutEngine: apolloResults.length,
          localDatabase: formattedDbLeads.length,
        },
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to search prospects" },
      { status: 500 }
    );
  }
}
