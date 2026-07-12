import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../proxy";

export async function POST(req: NextRequest) {
    const body = await req.json();
    return proxyRequest(`${API_BASE}/suppression/bulk`, {
        method: "POST",
        body: JSON.stringify(body),
    });
}