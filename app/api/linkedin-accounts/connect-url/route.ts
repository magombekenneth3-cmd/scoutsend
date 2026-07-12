import { API_BASE, proxyRequest } from "../../_proxy";

export async function POST() {
    return proxyRequest(`${API_BASE}/linkedin-accounts/connect-url`, {
        method: "POST",
        body: JSON.stringify({}),
    });
}
