import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "@/app/api/_proxy";

export async function POST(_req: NextRequest) {
    return proxyRequest(`${API_BASE}/notifications/read-all`, { method: "POST" });
}
