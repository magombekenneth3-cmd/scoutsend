import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../../../_proxy";

export async function POST(req: NextRequest) {
    const body = await req.text();
    return proxyRequest(`${API_BASE}/leads/bulk/rescore`, {
        method: "POST",
        body,
    });
}
