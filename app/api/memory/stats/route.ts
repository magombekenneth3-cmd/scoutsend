import { API_BASE, proxyRequest } from "../../_proxy";

export async function GET() {
    return proxyRequest(`${API_BASE}/memory/stats`);
}