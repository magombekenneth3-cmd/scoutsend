import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../proxy";

export async function DELETE(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    return proxyRequest(`${API_BASE}/suppression/${encodeURIComponent(id)}`, { method: "DELETE" });
}