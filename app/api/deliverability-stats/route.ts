import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../_proxy";

export async function GET(req: NextRequest) {
  const campaignId = req.nextUrl.searchParams.get("campaignId");
  if (!campaignId) {
    const { NextResponse } = await import("next/server");
    return NextResponse.json({ error: "campaignId required" }, { status: 400 });
  }
  return proxyRequest(`${API_BASE}/deliverability-stats?campaignId=${encodeURIComponent(campaignId)}`);
}
