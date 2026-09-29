import { NextRequest, NextResponse } from "next/server";
import { API_BASE, getToken, proxyRequest } from "../../_proxy";

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const token = await getToken();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return proxyRequest(`${API_BASE}/replies/${encodeURIComponent(id)}`);
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const token = await getToken();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const body = await req.json();
        return proxyRequest(`${API_BASE}/replies/${encodeURIComponent(id)}`, {
            method: "PATCH",
            body: JSON.stringify(body),
        });
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
}