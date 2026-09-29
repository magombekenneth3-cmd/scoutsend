import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "@/app/api/_proxy";

export async function POST(req: NextRequest) {
  const body = await req.json();
  return proxyRequest(`${API_BASE}/leads/bulk/sequence/send-email`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
