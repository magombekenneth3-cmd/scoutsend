import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../_proxy";

const ALLOWED_QUERY = ["campaignId", "queueName", "jobType", "status", "page", "limit"];

export async function GET(req: NextRequest) {
    const upstream = new URLSearchParams();
    req.nextUrl.searchParams.forEach((val, key) => {
        if (ALLOWED_QUERY.includes(key)) upstream.set(key, val);
    });
    return proxyRequest(`${API_BASE}/queue?${upstream}`);
}