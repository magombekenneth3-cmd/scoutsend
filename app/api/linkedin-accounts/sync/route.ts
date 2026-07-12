import { NextRequest } from "next/server";
import { API_BASE, proxyRequest } from "../../_proxy";

export async function POST(_req: NextRequest) {
    return proxyRequest(`${API_BASE}/linkedin-accounts/sync`, {
        method: "POST",
        body: JSON.stringify({}),
    });
}
