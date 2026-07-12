import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "./proxy";

const ALLOWED = ["page", "limit", "search", "action", "entityType", "userId", "startDate", "endDate"];

export async function GET(req: NextRequest) {
  const upstream = new URLSearchParams();
  req.nextUrl.searchParams.forEach((val, key) => {
    if (ALLOWED.includes(key)) upstream.set(key, val);
  });
  return proxyRequest(`${API_BASE}/audit-logs?${upstream}`);
}