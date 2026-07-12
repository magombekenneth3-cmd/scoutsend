import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../../_proxy";

export async function GET(req: NextRequest) {
    const upstream = new URLSearchParams();
    const days = req.nextUrl.searchParams.get("days");
    const campaignId = req.nextUrl.searchParams.get("campaignId");
    if (days) upstream.set("days", days);
    if (campaignId) upstream.set("campaignId", campaignId);
    return proxyRequest(`${API_BASE}/dashboard/pipeline-chart?${upstream}`);
}