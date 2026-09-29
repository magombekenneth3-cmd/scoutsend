import { API_BASE, proxyRequest } from "@/app/api/_proxy";
import { NextRequest } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  return proxyRequest(`${API_BASE}/leads/bulk/sequence/enroll`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}
