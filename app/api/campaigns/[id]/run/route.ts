import { NextRequest, NextResponse } from "next/server";
import { API_BASE, proxyRequest } from "../../proxy";

export async function POST(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Invalid campaign ID" }, { status: 400 });
    return proxyRequest(`${API_BASE}/campaigns/${encodeURIComponent(id)}/run`, { method: "POST" });
}
