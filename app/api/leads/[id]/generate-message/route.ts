import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../../../_proxy";

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const body = await req.text();
    return proxyRequest(`${API_BASE}/leads/${encodeURIComponent(id)}/generate-message`, {
        method: "POST",
        body: body || undefined,
    });
}
