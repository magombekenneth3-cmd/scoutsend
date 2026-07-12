import { API_BASE } from "../src/lib/constants";

export const SAFE_FONT_STACKS = [
    "Arial, sans-serif",
    "Georgia, serif",
    "Verdana, sans-serif",
    "Tahoma, Geneva, sans-serif",
    "Trebuchet MS, sans-serif",
    "Times New Roman, serif",
    "Courier New, monospace",
] as const;

export type FontStack = (typeof SAFE_FONT_STACKS)[number];

export interface BrandSettings {
    id: string;
    companyName: string;
    website: string | null;
    tagline: string | null;
    logoUrl: string | null;
    primaryColour: string;
    secondaryColour: string;
    accentColour: string | null;
    textColour: string;
    backgroundColour: string;
    fontFamily: string;
    senderName: string;
    senderTitle: string | null;
    senderPhone: string | null;
    companyAddress: string | null;
    unsubscribeText: string;
    facebookUrl: string | null;
    linkedinUrl: string | null;
    twitterUrl: string | null;
    userId: string;
    createdAt: string;
    updatedAt: string;
}

export type BrandSettingsInput = Omit<
    BrandSettings,
    "id" | "userId" | "createdAt" | "updatedAt"
>;

export interface GetBrandSettingsResponse {
    data: BrandSettings | null;
    configured: boolean;
}

// All requests go through Next.js /api/brand-settings proxy routes which
// forward the httpOnly session cookie — no localStorage token needed.
async function request<T>(path: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`/api/brand-settings${path}`, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options?.headers ?? {}),
        },
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error ?? `Request failed: ${res.status}`);
    }
    return res.json() as Promise<T>;
}

export const brandApi = {
    getSettings(): Promise<GetBrandSettingsResponse> {
        return request("");
    },

    upsert(data: BrandSettingsInput): Promise<BrandSettings> {
        return request("", {
            method: "PUT",
            body: JSON.stringify(data),
        });
    },

    async getPreviewHtml(): Promise<string> {
        const res = await fetch("/api/brand-settings/preview");
        if (!res.ok) throw new Error(`Preview failed: ${res.status}`);
        return res.text();
    },

    getFonts(): Promise<{ fonts: readonly string[] }> {
        return request("/fonts");
    },
};