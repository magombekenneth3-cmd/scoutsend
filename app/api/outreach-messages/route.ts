import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../_proxy";

const ALLOWED_QUERY = ["leadId", "campaignId", "approvalStatus", "deliveryState", "page", "limit"];

export async function GET(req: NextRequest) {
    const upstream = new URLSearchParams();
    req.nextUrl.searchParams.forEach((val, key) => {
        if (ALLOWED_QUERY.includes(key)) upstream.set(key, val);
    });
    return proxyRequest(`${API_BASE}/outreach-messages?${upstream}`);
}

export async function POST(req: NextRequest) {
    const body = await req.json();
    return proxyRequest(`${API_BASE}/outreach-messages`, {
        method: "POST",
        body: JSON.stringify(body),
    });
}