import { NextRequest, NextResponse } from "next/server";
import { API_BASE, getToken, proxyRequest } from "../../_proxy";

export async function GET(_req: NextRequest) {
    const token = await getToken();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return proxyRequest(`${API_BASE}/replies/counts`);
}
