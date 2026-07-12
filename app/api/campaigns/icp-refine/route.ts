import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

function sanitizeAIError(err: unknown): string {
    if (!(err instanceof Error)) return "Failed to refine ICP. Try again.";
    const msg = err.message;

    const statusMatch = msg.match(/\[(\d{3})\s+([^\]]+)\]/);
    if (statusMatch) {
        const code = statusMatch[1];
        if (code === "400") return "AI service rejected the request — the API key may be invalid or malformed.";
        if (code === "401" || code === "403") return "AI service authentication failed — check your GEMINI_API_KEY environment variable.";
        if (code === "429") return "AI service rate limit reached. Wait a moment then try again.";
        if (code === "503" || code === "500") return "AI service is temporarily unavailable. Try again in a few seconds.";
        return `AI service error (${code} ${statusMatch[2].trim()}). Check your API key configuration.`;
    }

    if (msg.includes("JSON") || msg.includes("parse") || msg.includes("Unexpected token")) {
        return "AI returned an unexpected response. Try rephrasing your ICP description.";
    }

    return msg.length > 200 ? msg.slice(0, 200) + "…" : msg;
}

const PROMPT = (icpDescription: string) => `You are a B2B sales and demand-generation expert. Parse the following ICP description and extract structured targeting data suitable for an Apollo.io company search.

ICP Description:
"${icpDescription}"

Return ONLY valid JSON — no markdown fences, no explanation, just the raw JSON object:
{
  "summary": "One concise sentence describing the ideal customer",
  "industries": ["up to 5 specific industry labels as Apollo would use them, e.g. 'Computer Software', 'Financial Services', 'Retail'"],
  "companySizes": [
    { "label": "Startup (1–50)", "range": "1,50" },
    { "label": "SMB (51–500)", "range": "51,500" }
  ],
  "geographies": ["up to 5 regions, countries, or US states"],
  "signals": ["up to 6 buying signals, growth indicators, or distinguishing characteristics"],
  "titleKeywords": ["up to 8 seniority/title keywords for decision makers, e.g. 'CTO', 'VP Engineering', 'Head of Product'"],
  "queryVariants": ["3–5 natural-language search phrases that capture the ICP for Apollo keyword search"]
}`;

export async function POST(req: NextRequest) {
    const { icpDescription } = await req.json();

    if (!icpDescription?.trim()) {
        return NextResponse.json({ error: "ICP description required" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY1;
    if (!apiKey) {
        console.error("[icp-refine] GEMINI_API_KEY1 is not set");
        return NextResponse.json(
            { error: "AI service is not configured. Set the GEMINI_API_KEY1 environment variable." },
            { status: 503 }
        );
    }

    try {
        const genai = new GoogleGenerativeAI(apiKey);
        const model = genai.getGenerativeModel({
            model: "gemini-2.5-flash",
            generationConfig: { responseMimeType: "application/json" },
        });

        const result = await model.generateContent(PROMPT(icpDescription));
        const raw = result.response.text().trim();

        let refinement: unknown;
        try {
            const clean = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
            refinement = JSON.parse(clean);
        } catch {
            console.error("[icp-refine] JSON parse failed. Raw output:", raw.slice(0, 500));
            return NextResponse.json(
                { error: "AI returned an unexpected response format. Try rephrasing your ICP description." },
                { status: 422 }
            );
        }

        return NextResponse.json({ refinement });
    } catch (err) {
        console.error("[icp-refine]", err);
        return NextResponse.json(
            { error: sanitizeAIError(err) },
            { status: 500 }
        );
    }
}