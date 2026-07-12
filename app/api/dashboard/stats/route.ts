import { API_BASE, proxyRequest } from "../proxy";

export async function GET() {
    return proxyRequest(`${API_BASE}/dashboard/stats`);
}
