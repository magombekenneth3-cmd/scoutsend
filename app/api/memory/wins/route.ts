import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../../_proxy";

const ALLOWED = new Set(["icpVertical", "targetIndustry", "targetRegion", "limit"]);

export async function GET(req: NextRequest) {
    const upstream = new URLSearchParams();
    req.nextUrl.searchParams.forEach((v, k) => {
        if (ALLOWED.has(k)) upstream.set(k, v);
    });
    const q = upstream.toString();
    return proxyRequest(`${API_BASE}/memory/wins${q ? `?${q}` : ""}`);
}