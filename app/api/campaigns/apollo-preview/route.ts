import { NextRequest, NextResponse } from "next/server";
import { queryApolloOrgs } from "@/agents/lookAlike/apolloCompanies";

interface CompanySize {
    label: string;
    range: string;
}

interface ICPRefinement {
    industries: string[];
    companySizes: CompanySize[];
    signals: string[];
    queryVariants: string[];
}

export async function POST(req: NextRequest) {
    const { refinement } = (await req.json()) as { refinement: ICPRefinement };

    if (!refinement) {
        return NextResponse.json({ error: "refinement object is required" }, { status: 400 });
    }

    try {
        const orgs = await queryApolloOrgs({
            keywords: (refinement.signals ?? []).slice(0, 4),
            industries: refinement.industries ?? [],
            employeeRanges: (refinement.companySizes ?? []).map((s) => s.range),
            queryVariants:
                (refinement.queryVariants ?? []).length > 0
                    ? refinement.queryVariants.slice(0, 3)
                    : ["software company", "technology startup"],
            excludeKeywords: [],
            perVariant: 10,
        });

        return NextResponse.json({ organizations: orgs.slice(0, 30) });
    } catch (err) {
        console.error("[apollo-preview]", err);
        return NextResponse.json(
            { error: err instanceof Error ? err.message : "Apollo search failed" },
            { status: 500 }
        );
    }
}