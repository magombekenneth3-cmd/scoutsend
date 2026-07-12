import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../../_proxy";

export async function GET(req: NextRequest) {
    const upstream = new URLSearchParams();
    const campaignId = req.nextUrl.searchParams.get("campaignId");
    const days = req.nextUrl.searchParams.get("days");
    if (campaignId) upstream.set("campaignId", campaignId);
    if (days) upstream.set("days", days);
    return proxyRequest(`${API_BASE}/outreach-messages/chart-stats?${upstream}`);
}
