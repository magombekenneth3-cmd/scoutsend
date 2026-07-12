import { NextResponse } from "next/server";
import { API_BASE, getToken } from "../../_proxy";

const TIMEOUT_MS = 10_000;

export async function GET() {
    const token = await getToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
        const res = await fetch(`${API_BASE}/brand-settings/preview`, {
            signal: controller.signal,
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            cache: "no-store",
        });

        if (!res.ok) {
            return new NextResponse(`Preview failed: ${res.status}`, { status: res.status });
        }

        const html = await res.text();
        return new NextResponse(html, {
            status: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
        });
    } catch (error) {
        const isAbort = error instanceof Error && error.name === "AbortError";
        return new NextResponse(
            isAbort ? "Upstream request timed out" : "Failed to reach API server",
            { status: isAbort ? 504 : 502 }
        );
    } finally {
        clearTimeout(timer);
    }
}