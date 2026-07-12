import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../_proxy";

const ALLOWED_QUERY = ["page", "limit", "providerType", "health"];

export async function GET(req: NextRequest) {
    const upstream = new URLSearchParams();
    req.nextUrl.searchParams.forEach((val, key) => {
        if (ALLOWED_QUERY.includes(key)) upstream.set(key, val);
    });
    return proxyRequest(`${API_BASE}/sender-domains?${upstream}`);
}

export async function POST(req: NextRequest) {
    const body = await req.json();
    return proxyRequest(`${API_BASE}/sender-domains`, {
        method: "POST",
        body: JSON.stringify(body),
    });
}