import { NextRequest, NextResponse } from "next/server";
import { API_BASE, proxyRequest } from "../../proxy";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: RouteContext) {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });
    return proxyRequest(`${API_BASE}/campaigns/${encodeURIComponent(id)}/signals`);
}
