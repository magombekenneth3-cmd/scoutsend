import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "./proxy";

const ALLOWED = ["email", "domain", "source", "type", "page", "limit"];

export async function GET(req: NextRequest) {
    const upstream = new URLSearchParams();
    req.nextUrl.searchParams.forEach((val, key) => {
        if (ALLOWED.includes(key)) upstream.set(key, val);
    });
    return proxyRequest(`${API_BASE}/suppression?${upstream}`);
}

export async function POST(req: NextRequest) {
    const body = await req.json();
    return proxyRequest(`${API_BASE}/suppression`, {
        method: "POST",
        body: JSON.stringify(body),
    });
}