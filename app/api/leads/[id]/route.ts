import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../../_proxy";

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    return proxyRequest(`${API_BASE}/leads/${encodeURIComponent(id)}`);
}

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const body = await req.json();
    return proxyRequest(`${API_BASE}/leads/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
    });
}

export async function DELETE(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    return proxyRequest(`${API_BASE}/leads/${encodeURIComponent(id)}`, { method: "DELETE" });
}
