import { NextRequest, NextResponse } from "next/server";
import { API_BASE, proxyRequest } from "../../_proxy";

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Invalid event ID" }, { status: 400 });
    return proxyRequest(`${API_BASE}/learning-events/${encodeURIComponent(id)}`);
}