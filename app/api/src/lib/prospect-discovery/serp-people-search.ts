import { serperSearch, type SerperResult } from "../serper";
import { callGemini, MODELS, parseSafeJson } from "../../modules/gemini/gemini.client";
import { logger } from "../logger";
import { isRealPerson } from "./shared";

export interface SerpPersonLead {
    id: string;
    externalId: string;
    firstName: string;
    lastName: string;
    companyName: string;
    website: string | null;
    title: string;
    email: null;
    emailStatus: "UNVERIFIED";
    seniority: string;
    location: string;
    linkedinUrl: string | null;
    qualificationScore: number;
    source: "SERP_XRAY";
    signals: Array<{ signalType: string; confidence: number; explanation: string }>;
}

interface GeminiExtractedPerson {
    firstName?: string;
    lastName?: string;
    title?: string;
    companyName?: string;
    website?: string;
    location?: string;
    linkedinUrl?: string;
}

async function extractRealPeopleWithGemini(
    items: Array<{ title?: string; snippet?: string; link?: string }>,
    defaultLocation = "United States",
): Promise<SerpPersonLead[]> {
    if (!items || items.length === 0) return [];

    const textPayload = items
        .map((item, idx) => `Item ${idx + 1}:\nTitle: ${item.title || ""}\nSnippet: ${item.snippet || ""}\nLink: ${item.link || ""}`)
        .join("\n\n");

    try {
        const { text } = await callGemini({
            agentName: "prospecting.serp-people-extractor",
            model: MODELS.RESEARCH,
            systemPrompt: [
                "You are a B2B Lead Extraction Expert.",
                "Extract real human decision-maker profiles from Google SERP search results.",
                "Return ONLY a JSON array of objects: [",
                "  {",
                "    \"firstName\": \"John\",",
                "    \"lastName\": \"Doe\",",
                "    \"title\": \"VP of Sales\",",
                "    \"companyName\": \"Acme Corp\",",
                "    \"website\": \"acme.com\",",
                "    \"location\": \"San Francisco, CA\",",
                "    \"linkedinUrl\": \"https://www.linkedin.com/in/johndoe\"",
                "  }",
                "]",
                "Never invent fake names like 'Prospect', 'Unknown', or 'Company'. Only extract real people mentioned in the search results.",
            ].join(" "),
            userPrompt: `Extract real people from these search results:\n\n${textPayload}`,
            metadata: { source: "gemini-people-extractor" },
            temperature: 0.05,
            responseMimeType: "application/json",
        });

        const parsed = parseSafeJson<any>(text);
        const list: GeminiExtractedPerson[] = Array.isArray(parsed)
            ? parsed
            : Array.isArray(parsed?.people)
                ? parsed.people
                : [];

        const validResults: SerpPersonLead[] = [];
        list.forEach((p, idx) => {
            const fn = p.firstName || "";
            const ln = p.lastName || "";
            const cn = p.companyName || "";
            const tt = p.title || "Decision Maker";

            if (isRealPerson(fn, ln, cn, tt)) {
                validResults.push({
                    id: `serp-lead-${idx}`,
                    externalId: `serp-${idx}`,
                    firstName: fn,
                    lastName: ln,
                    companyName: cn,
                    website: p.website || null,
                    title: tt,
                    email: null,
                    emailStatus: "UNVERIFIED",
                    seniority: "Executive",
                    location: p.location || defaultLocation,
                    linkedinUrl: p.linkedinUrl || items[idx]?.link || null,
                    qualificationScore: 0.9,
                    source: "SERP_XRAY",
                    signals: [
                        { signalType: "INTENT_SIGNAL", confidence: 0.9, explanation: `Verified LinkedIn profile: ${tt} at ${cn}` },
                    ],
                });
            }
        });

        return validResults;
    } catch (err) {
        logger.warn({ err }, "[prospecting] Gemini SERP people-extraction failed");
        return [];
    }
}

function extractPeopleByTitleParsing(items: SerperResult[], defaultLocation: string): SerpPersonLead[] {
    const results: SerpPersonLead[] = [];

    items.forEach((item, idx) => {
        if (!item.title || !item.link) return;

        const cleanTitle = item.title.replace(/\s*\|\s*LinkedIn$/i, "").replace(/\s*-\s*LinkedIn$/i, "").trim();
        const parts = cleanTitle.split(/\s*-\s*|\s*–\s*/);

        const fullName = parts[0]?.trim() || "";
        const nameParts = fullName.split(" ");
        const firstName = nameParts[0] || "";
        const lastName = nameParts.slice(1).join(" ") || "";
        const jobTitle = parts[1]?.trim() || "";
        const companyName = parts[2]?.trim() || "";

        if (isRealPerson(firstName, lastName, companyName, jobTitle)) {
            results.push({
                id: `serp-lead-${idx}`,
                externalId: `serp-${idx}`,
                firstName,
                lastName,
                companyName,
                website: null,
                title: jobTitle,
                email: null,
                emailStatus: "UNVERIFIED",
                seniority: "Executive",
                location: defaultLocation,
                linkedinUrl: item.link,
                qualificationScore: 0.88,
                source: "SERP_XRAY",
                signals: [
                    { signalType: "INTENT_SIGNAL", confidence: 0.88, explanation: `Verified LinkedIn profile: ${jobTitle} at ${companyName}` },
                ],
            });
        }
    });

    return results;
}

export async function searchSerpPeople(params: {
    q?: string;
    titles?: string[];
    locations?: string[];
    industries?: string[];
}): Promise<SerpPersonLead[]> {
    const titleQuery = params.titles?.length
        ? `"${params.titles.join('" OR "')}"`
        : params.q
            ? `"${params.q}"`
            : '"CEO" OR "Founder" OR "VP Sales"';
    const locationQuery = params.locations?.length ? `"${params.locations[0]}"` : "";
    const industryQuery = params.industries?.length ? `"${params.industries[0]}"` : "";

    const query = `site:linkedin.com/in/ ${titleQuery} ${locationQuery} ${industryQuery}`.trim();
    const defaultLocation = params.locations?.[0] || "United States";

    let items: SerperResult[];
    try {
        items = await serperSearch(query, "search", 15);
    } catch (err) {
        logger.warn({ err, query }, "[prospecting] SERP people search failed");
        return [];
    }

    if (items.length === 0) return [];

    const extractedLeads = await extractRealPeopleWithGemini(items, defaultLocation);
    if (extractedLeads.length > 0) return extractedLeads;

    return extractPeopleByTitleParsing(items, defaultLocation);
}