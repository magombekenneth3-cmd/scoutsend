import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../../../_proxy";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyRequest(`${API_BASE}/leads/${encodeURIComponent(id)}/enrich`, {
    method: "POST",
  });
}
