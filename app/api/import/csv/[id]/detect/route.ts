import { API_BASE, getToken } from "@/app/api/_proxy";
import { NextRequest, NextResponse } from "next/server";

const MAX_CSV_BYTES = 5 * 1024 * 1024;

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
    const { id: campaignId } = await params;
    const token = await getToken();

    let csvBody: ArrayBuffer;
    const contentType = req.headers.get("content-type") ?? "";

    if (contentType.includes("multipart/form-data")) {
        let formData: FormData;
        try {
            formData = await req.formData();
        } catch {
            return NextResponse.json({ error: "Invalid multipart body" }, { status: 400 });
        }
        const file = formData.get("file");
        if (!file || typeof file === "string") {
            return NextResponse.json(
                { error: "Multipart request must include a 'file' field" },
                { status: 400 }
            );
        }
        csvBody = await (file as File).arrayBuffer();
    } else {
        csvBody = await req.arrayBuffer();
    }

    if (csvBody.byteLength === 0) {
        return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }
    if (csvBody.byteLength > MAX_CSV_BYTES) {
        return NextResponse.json(
            { error: `CSV exceeds ${MAX_CSV_BYTES / 1024 / 1024}MB limit` },
            { status: 413 }
        );
    }

    try {
        const res = await fetch(
            `${API_BASE}/leads/import/csv/detect?campaignId=${encodeURIComponent(campaignId)}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "text/csv",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: csvBody,
                cache: "no-store",
                signal: AbortSignal.timeout(30_000),
            }
        );

        const data = await res.json();
        return NextResponse.json(data, { status: res.status });
    } catch {
        return NextResponse.json({ error: "Failed to reach API server" }, { status: 502 });
    }
}
