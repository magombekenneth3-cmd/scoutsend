import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../_proxy";

export async function GET() {
    return proxyRequest(`${API_BASE}/brand-settings`);
}

export async function PUT(req: NextRequest) {
    const body = await req.json();
    return proxyRequest(`${API_BASE}/brand-settings`, {
        method: "PUT",
        body: JSON.stringify(body),
    });
}