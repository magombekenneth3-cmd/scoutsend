import { NextResponse } from "next/server";
import { getServerSession } from "../../src/lib/session";
import { resolveEmailForProspect } from "../../src/lib/prospect-discovery/email-reveal";

export async function POST(req: Request) {
  try {
    const session = await getServerSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const {
      externalId,
      firstName = "",
      lastName = "",
      companyName = "",
      website = "",
      currentEmail = null,
      linkedinUrl = null,
    } = body;

    const result = await resolveEmailForProspect({
      externalId,
      firstName,
      lastName,
      companyName,
      website,
      currentEmail,
      linkedinUrl,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to reveal email" },
      { status: 500 },
    );
  }
}