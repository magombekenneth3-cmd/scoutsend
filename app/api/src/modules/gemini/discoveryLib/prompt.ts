import { MIN_DISCOVERY_CONFIDENCE, ATS_ROLE_TITLES_COUNT, GEMINI_FALLBACK_COMPANY_COUNT } from "./discovery.constants";
import type { DiscoverySignalType } from "./discovery.types";
import type { SerperResult } from "../../../lib/serper";

export function buildTitleInferencePrompt(icpDescription: string): {
    systemPrompt: string;
    userPrompt: string;
} {
    return {
        systemPrompt: `You are a B2B sales strategist. Given an ICP description, return 6-8 job titles representing decision-makers who evaluate and purchase this solution.\n\nReturn ONLY a JSON array of strings. No preamble.`,
        userPrompt: `ICP: ${icpDescription}`,
    };
}

export function buildAtsIngredientsPrompt(icpDescription: string, targetIndustry: string): {
    systemPrompt: string;
    userPrompt: string;
} {
    return {
        systemPrompt: `You are a B2B sales researcher specialising in talent signal intelligence. Given an ICP description and target industry, return search ingredients that will match real ATS job postings on Lever, Greenhouse, Ashby, Workday, SmartRecruiters, BambooHR, Jobvite, Teamtailor, Recruitee, and Workable.\n\nRules:\n1. roleTitles: ${ATS_ROLE_TITLES_COUNT} exact job title strings that appear verbatim in postings at companies matching this ICP. Use industry-standard role names, not paraphrases.\n2. techTerms: up to 5 product names, frameworks, or tooling terms that appear in the requirements sections of these postings.\n3. departmentTerms: up to 3 department names (e.g. "Engineering", "Risk", "Compliance") that appear in ATS breadcrumbs for this ICP.\n\nReturn ONLY valid JSON, no preamble:\n{ "roleTitles": string[], "techTerms": string[], "departmentTerms": string[] }`,
        userPrompt: `ICP: ${icpDescription}\nIndustry: ${targetIndustry || "general B2B"}`,
    };
}

export function buildGeminiFallbackPrompt(icpDescription: string, industry: string, region: string): {
    systemPrompt: string;
    userPrompt: string;
} {
    return {
        systemPrompt: `You are a B2B sales researcher. Given an ICP description, industry, and region, return exactly ${GEMINI_FALLBACK_COMPANY_COUNT} real company names that are strong fits.\nFor each company also provide the most likely decision-maker title and the company website domain if you know it.\nReturn ONLY a JSON array of objects, no preamble:\n[\n  { "companyName": string, "website": string | null, "decisionMakerTitle": string }\n]`,
        userPrompt: `ICP: ${icpDescription}\nIndustry: ${industry || "any"}\nRegion: ${region || "global"}`,
    };
}

export function buildLeadExtractorPrompt(
    icpDescription: string,
    signalType: Exclude<DiscoverySignalType, "TECH_SIGNAL">,
    results: SerperResult[],
): {
    systemPrompt: string;
    userPrompt: string;
} {
    return {
        systemPrompt: `You are a B2B lead intelligence analyst. Extract company leads from search results.\nAnalyze the search title, link, and snippet extremely carefully. You must make a dedicated effort to look for and extract the names of people associated with each company, especially decision-makers, founders, authors, executives, or individuals quoted in the snippets.\nRules:\n1. Look for author names in bylines or blogs (e.g., "By John Doe", "written by Jane Smith").\n2. Look for founders/CEOs (e.g., "founded by Bob Johnson", "CEO Alice").\n3. Look for quoted executives or team members mentioned in snippets or articles.\n4. Split full names into "firstName" and "lastName".\n5. Extract job titles/roles (e.g., "Founder", "CEO", "VP of Engineering") and LinkedIn URLs for either the company or the person if visible in the snippet or link.\n6. Never invent data not present. If no person is mentioned, set firstName, lastName, and title to null.\n7. IMPORTANT: set "sourceIndex" to the 1-based result number from the input list that this lead was extracted from.\n\nReturn ONLY a JSON array:\n[\n  {\n    "sourceIndex": number (1-based index of the result this lead came from),\n    "companyName": string,\n    "website": string | null,\n    "linkedinUrl": string | null,\n    "firstName": string | null,\n    "lastName": string | null,\n    "title": string | null,\n    "email": string | null,\n    "signalValue": string (max 100 chars),\n    "confidence": number (0.0\u20131.0),\n    "explanation": string (max 150 chars)\n  }\n]\n\nInclude only companies with confidence >= ${MIN_DISCOVERY_CONFIDENCE}. Never invent data not present. Return [] if nothing matches.`,
        userPrompt: `ICP: ${icpDescription}\nSignal: ${signalType}\n\nResults:\n${results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.link}\n   ${r.snippet}`).join("\n\n")}`,
    };
}