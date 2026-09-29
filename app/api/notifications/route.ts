import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../_proxy";

export async function GET(_req: NextRequest) {
    return proxyRequest(`${API_BASE}/notifications`);
}
