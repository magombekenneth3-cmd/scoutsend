import { NextRequest, NextResponse } from "next/server";
import { API_BASE, proxyRequest } from "../../../proxy";

type RouteContext = { params: Promise<{ id: string; stepId: string }> };

export async function PATCH(req: NextRequest, { params }: RouteContext) {
    const { id, stepId } = await params;
    if (!id || !stepId) return NextResponse.json({ error: "Invalid params" }, { status: 400 });
    const body = await req.json();
    return proxyRequest(
        `${API_BASE}/campaigns/${encodeURIComponent(id)}/sequence-steps/${encodeURIComponent(stepId)}`,
        { method: "PATCH", body: JSON.stringify(body) }
    );
}

export async function DELETE(_req: NextRequest, { params }: RouteContext) {
    const { id, stepId } = await params;
    if (!id || !stepId) return NextResponse.json({ error: "Invalid params" }, { status: 400 });
    return proxyRequest(
        `${API_BASE}/campaigns/${encodeURIComponent(id)}/sequence-steps/${encodeURIComponent(stepId)}`,
        { method: "DELETE" }
    );
}
