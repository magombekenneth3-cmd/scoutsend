import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "@/app/api/_proxy";

export async function PATCH(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    return proxyRequest(`${API_BASE}/notifications/${encodeURIComponent(id)}/read`, { method: "PATCH" });
}
