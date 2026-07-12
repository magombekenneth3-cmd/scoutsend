import { proxyRequest, API_BASE } from "../../_proxy";

export async function GET() {
    return proxyRequest(`${API_BASE}/auth/me`);
}