import { NextRequest, NextResponse } from "next/server";
import { API_BASE, proxyRequest } from "../../proxy";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteContext) {
    const { id } = await params;
    if (!id) return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });

    let body: string;
    try {
        const text = await req.text();
        body = text.trim() || "{}";
        JSON.parse(body);
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    return proxyRequest(`${API_BASE}/campaigns/${encodeURIComponent(id)}/lookalike`, {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json" },
    });
}
