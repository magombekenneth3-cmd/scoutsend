import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../../../_proxy";

export async function POST(req: NextRequest) {
  const body = await req.json();
  return proxyRequest(`${API_BASE}/leads/bulk/enrich`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
