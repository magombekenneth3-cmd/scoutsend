import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "./proxy";

const ALLOWED_QUERY = ["status", "page", "limit", "search"];

export async function GET(req: NextRequest) {
    const upstream = new URLSearchParams();
    req.nextUrl.searchParams.forEach((val, key) => {
        if (ALLOWED_QUERY.includes(key)) upstream.set(key, val);
    });
    return proxyRequest(`${API_BASE}/campaigns?${upstream}`);
}

export async function POST(req: NextRequest) {
    const body = await req.json();
    return proxyRequest(`${API_BASE}/campaigns`, {
        method: "POST",
        body: JSON.stringify(body),
    });
}