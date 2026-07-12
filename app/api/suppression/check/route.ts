import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../proxy";

export async function GET(req: NextRequest) {
    const params = new URLSearchParams();
    const email = req.nextUrl.searchParams.get("email");
    const domain = req.nextUrl.searchParams.get("domain");
    if (email) params.set("email", email);
    if (domain) params.set("domain", domain);
    return proxyRequest(`${API_BASE}/suppression/check?${params}`);
}