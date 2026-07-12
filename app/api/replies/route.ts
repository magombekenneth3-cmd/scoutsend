import { NextRequest, NextResponse } from "next/server";
import { API_BASE, getToken, proxyRequest } from "../_proxy";

const ALLOWED_QUERY_PARAMS = new Set([
    "leadId",
    "outreachMessageId",
    "intent",
    "requiresHumanReview",
    "page",
    "limit",
]);

export async function GET(req: NextRequest) {
    const token = await getToken();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const params = new URLSearchParams();

    req.nextUrl.searchParams.forEach((value, key) => {
        if (ALLOWED_QUERY_PARAMS.has(key)) {
            params.set(key, value);
        }
    });

    const queryString = params.toString();

    return proxyRequest(
        `${API_BASE}/replies${queryString ? `?${queryString}` : ""}`
    );
}

export async function POST(req: NextRequest) {
    const token = await getToken();
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    try {
        const body = await req.json();

        return proxyRequest(`${API_BASE}/replies`, {
            method: "POST",
            body: JSON.stringify(body),
        });
    } catch {
        return NextResponse.json(
            { error: "Invalid JSON body" },
            { status: 400 }
        );
    }
}