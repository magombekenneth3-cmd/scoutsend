import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "@/app/api/_proxy";

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    return proxyRequest(`${API_BASE}/campaigns/${encodeURIComponent(id)}/preflight`);
}
