import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../../_proxy";

export async function GET(req: NextRequest) {
    const campaignId = req.nextUrl.searchParams.get("campaignId");
    if (!campaignId) {
        return new Response(JSON.stringify({ error: "campaignId is required" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }
    return proxyRequest(
        `${API_BASE}/outreach-messages/counts?campaignId=${encodeURIComponent(campaignId)}`
    );
}
