import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../../_proxy";

export async function PATCH(req: NextRequest) {
    const body = await req.text();
    return proxyRequest(`${API_BASE}/users/profile`, {
        method: "PATCH",
        body,
    });
}
