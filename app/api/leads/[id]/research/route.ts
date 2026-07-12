import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/api/src/lib/prisma";
import { assertLeadOwnership } from "@/app/api/src/lib/ownership";
import { ForbiddenError, NotFoundError } from "@/app/api/src/lib/errors";
import { logAudit } from "@/app/api/src/modules/audit/audit.service";
import { AUDIT_EVENTS } from "@/app/api/src/lib/constants";
import { findOrCreatePendingReport } from "@/app/api/src/modules/gemini/research.agent";

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

function getUserId(req: NextRequest): string | null {
  return req.headers.get("x-user-id");
}

async function handleOwnership(
  req: NextRequest,
  leadId: string,
): Promise<{ userId: string } | NextResponse> {
  const userId = getUserId(req);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await assertLeadOwnership(leadId, userId);
    return { userId };
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ForbiddenError) {
      await logAudit({
        userId,
        action: AUDIT_EVENTS.UNAUTHORIZED_ACCESS,
        entityType: "Lead",
        entityId: leadId,
        metadata: { attemptedAction: "research" },
      });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    throw err;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leadId } = await params;
  const result = await handleOwnership(req, leadId);
  if (result instanceof NextResponse) return result;

  const report = await prisma.leadResearchReport.findFirst({
    where: { leadId },
    orderBy: { startedAt: "desc" },
  });

  if (!report) return NextResponse.json({ report: null });

  const isStale =
    report.status === "COMPLETE" &&
    report.expiresAt &&
    new Date(report.expiresAt) < new Date();

  if (isStale) {
    await prisma.leadResearchReport.update({
      where: { id: report.id },
      data: { status: "STALE" },
    });
    return NextResponse.json({ report: { ...report, status: "STALE" } });
  }

  return NextResponse.json({ report });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id: leadId } = await params;
  const result = await handleOwnership(req, leadId);
  if (result instanceof NextResponse) return result;

  const { userId } = result;
  const report = await findOrCreatePendingReport(leadId, userId);

  await logAudit({
    userId,
    action: AUDIT_EVENTS.LEAD_RESEARCH_TRIGGERED,
    entityType: "Lead",
    entityId: leadId,
    metadata: { reportId: report.id },
  });

  return NextResponse.json({ reportId: report.id });
}
