import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../../proxy";

export async function POST(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    return proxyRequest(`${API_BASE}/users/${id}/force-logout`, { method: "POST" });
}