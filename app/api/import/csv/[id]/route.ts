import { API_BASE, getToken } from "@/app/api/_proxy";
import { NextRequest, NextResponse } from "next/server";

const MAX_CSV_BYTES = 5 * 1024 * 1024;

export async function POST(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
    const { id: campaignId } = await params;
    const contentType = req.headers.get("content-type") ?? "";
    const token = await getToken();

    let csvBody: ArrayBuffer;

    if (contentType.includes("multipart/form-data")) {
        let formData: FormData;
        try {
            formData = await req.formData();
        } catch {
            return NextResponse.json(
                { error: "Invalid multipart body" },
                { status: 400 }
            );
        }

        const file = formData.get("file");
        if (!file || typeof file === "string") {
            return NextResponse.json(
                { error: "Multipart request must include a 'file' field" },
                { status: 400 }
            );
        }

        csvBody = await (file as File).arrayBuffer();
    } else if (
        contentType.includes("text/csv") ||
        contentType.includes("application/octet-stream")
    ) {
        csvBody = await req.arrayBuffer();
    } else {
        return NextResponse.json(
            { error: "Content-Type must be text/csv or multipart/form-data" },
            { status: 415 }
        );
    }

    if (csvBody.byteLength > MAX_CSV_BYTES) {
        return NextResponse.json(
            { error: `CSV exceeds ${MAX_CSV_BYTES / 1024 / 1024}MB limit` },
            { status: 413 }
        );
    }

    try {
        const res = await fetch(
            `${API_BASE}/leads/import/csv?campaignId=${encodeURIComponent(campaignId)}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "text/csv",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                body: csvBody,
                cache: "no-store",
            }
        );

        if (res.status === 204) return new NextResponse(null, { status: 204 });
        const data = await res.json();
        return NextResponse.json(data, { status: res.status });
    } catch {
        return NextResponse.json(
            { error: "Failed to reach API server" },
            { status: 502 }
        );
    }
}

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
    const { id: campaignId } = await params;
    const token = await getToken();

    try {
        const res = await fetch(
            `${API_BASE}/leads?campaignId=${encodeURIComponent(campaignId)}&limit=1`,
            {
                headers: {
                    "Content-Type": "application/json",
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
                cache: "no-store",
            }
        );

        const data = await res.json();
        return NextResponse.json(
            {
                campaignId,
                accepted: ["text/csv", "application/octet-stream", "multipart/form-data"],
                maxRows: 5000,
                maxSizeMb: 5,
                requiredColumns: ["companyName"],
                optionalColumns: [
                    "email",
                    "firstName",
                    "lastName",
                    "title",
                    "website",
                    "linkedinUrl",
                ],
                acceptedAliases: {
                    companyName: ["company", "company_name", "organization", "org"],
                    firstName: ["first_name", "firstname"],
                    lastName: ["last_name", "lastname"],
                    email: ["email_address", "mail"],
                    title: ["job_title", "position", "role"],
                    website: ["url", "web"],
                    linkedinUrl: ["linkedin", "linkedin_url", "linkedin_profile"],
                },
                campaignExists: res.ok,
                totalLeads: data?.meta?.total ?? null,
            },
            { status: res.ok ? 200 : res.status }
        );
    } catch {
        return NextResponse.json(
            { error: "Failed to reach API server" },
            { status: 502 }
        );
    }
}