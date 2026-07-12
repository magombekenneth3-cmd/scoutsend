import { NextRequest, NextResponse } from "next/server";
import { assertLeadOwnership } from "@/app/api/src/lib/ownership";
import { ForbiddenError, NotFoundError } from "@/app/api/src/lib/errors";
import { logAudit } from "@/app/api/src/modules/audit/audit.service";
import { AUDIT_EVENTS } from "@/app/api/src/lib/constants";
import {
  runResearchAgent,
  unsubscribeResearchListener,
  findOrCreatePendingReport,
  hasActiveJob,
} from "@/app/api/src/modules/gemini/research.agent";
import { ResearchStreamEvent } from "@/app/api/src/lib/research/research.types";
import { prisma } from "@/app/api/src/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: leadId } = await params;
  const userId = req.headers.get("x-user-id");
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await assertLeadOwnership(leadId, userId);
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

  let report: Awaited<ReturnType<typeof findOrCreatePendingReport>>;
  try {
    if (!hasActiveJob(leadId)) {
      await prisma.leadResearchReport.updateMany({
        where: { leadId, status: { in: ["PENDING", "RUNNING"] } },
        data: { status: "FAILED", errorMessage: "Orphaned by server restart" },
      });
    }
    report = await findOrCreatePendingReport(leadId, userId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to initialize research";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const encoder = new TextEncoder();
  let controllerRef: ReadableStreamDefaultController | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  function emit(event: ResearchStreamEvent) {
    if (!controllerRef) return;
    try {
      controllerRef.enqueue(
        encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
      );
    } catch {
      controllerRef = null;
      unsubscribeResearchListener(leadId, emit);
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      controllerRef = controller;
      heartbeatTimer = setInterval(() => {
        if (!controllerRef) return;
        try {
          controllerRef.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          controllerRef = null;
        }
      }, 15_000);
    },
    cancel() {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      controllerRef = null;
      unsubscribeResearchListener(leadId, emit);
    },
  });

  runResearchAgent(leadId, report.id, emit, userId).then(() => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    if (controllerRef) controllerRef.close();
  }).catch((err) => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    emit({ type: "error", data: { message: err?.message ?? "Unknown error" } });
    if (controllerRef) controllerRef.close();
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
