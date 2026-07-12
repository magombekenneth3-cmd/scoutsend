import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../../proxy";

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const body = await req.json();
    return proxyRequest(`${API_BASE}/users/${id}/role`, {
        method: "PATCH",
        body: JSON.stringify(body),
    });
}