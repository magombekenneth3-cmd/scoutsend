import { API_BASE, proxyRequest } from "@/app/api/_proxy";
import { NextRequest } from "next/server";


type RouteContext = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: RouteContext) {
    const { id } = await params;
    const body = await req.json();
    return proxyRequest(`${API_BASE}/learning-events/${encodeURIComponent(id)}/resolve`, {
        method: "POST",
        body: JSON.stringify(body),
    });
}