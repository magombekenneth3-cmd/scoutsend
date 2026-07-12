import { Prisma } from "@prisma/client";
import type { AgentOutputType } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { scrapeCompanyText } from "../../lib/scrape";
import { serperSearch } from "../../lib/serper";
import { SchemaType, ToolDefinition } from "./gemini.client";

const MAX_WEB_SEARCH_CALLS = 3;
const MAX_SCRAPE_CALLS = 3;

const OUTPUT_TYPE_SCHEMA: Record<AgentOutputType, SchemaType> = {
    TEXT: SchemaType.STRING,
    BOOLEAN: SchemaType.BOOLEAN,
    NUMBER: SchemaType.NUMBER,
};

function coerceToOutputType(raw: unknown, outputType: AgentOutputType): unknown {
    if (outputType === "BOOLEAN") {
        return raw === true || raw === "true" || raw === 1;
    }
    if (outputType === "NUMBER") {
        const n = Number(raw);
        return Number.isFinite(n) ? n : null;
    }
    return raw != null ? String(raw) : null;
}

export function buildLeadAgentTools(
    leadId: string,
    fieldKey: string,
    runId: string,
    outputType: AgentOutputType,
): ToolDefinition[] {
    let webSearchCount = 0;
    let scrapeCount = 0;

    // Fix #2: removed generic parameter — handler args cast internally instead
    const webSearch: ToolDefinition = {
        declaration: {
            name: "webSearch",
            description:
                "Search the web for factual information about the company or lead. Returns titles, URLs, and snippets.",
            parameters: {
                type: SchemaType.OBJECT,
                properties: {
                    query: {
                        type: SchemaType.STRING,
                        description: "The search query string.",
                    },
                },
                required: ["query"],
            },
        },
        handler: async (args) => {
            const { query } = args as { query: string };
            if (webSearchCount >= MAX_WEB_SEARCH_CALLS) {
                return { error: "webSearch call limit reached for this run" };
            }
            webSearchCount++;
            await prisma.leadAgentRun.update({
                where: { id: runId },
                data: { toolCallCount: { increment: 1 } },
            });
            const results = await serperSearch(query, "search");
            return results.map((r) => ({ title: r.title, url: r.link, snippet: r.snippet }));
        },
    };

    // Fix #2: removed generic parameter — handler args cast internally instead
    const scrape: ToolDefinition = {
        declaration: {
            name: "scrape",
            description: "Fetch and extract the readable text content of a public web page.",
            parameters: {
                type: SchemaType.OBJECT,
                properties: {
                    url: {
                        type: SchemaType.STRING,
                        description: "The full HTTPS URL of the page to scrape.",
                    },
                },
                required: ["url"],
            },
        },
        handler: async (args) => {
            const { url } = args as { url: string };
            if (scrapeCount >= MAX_SCRAPE_CALLS) {
                return { error: "scrape call limit reached for this run" };
            }
            scrapeCount++;
            await prisma.leadAgentRun.update({
                where: { id: runId },
                data: { toolCallCount: { increment: 1 } },
            });
            const text = await scrapeCompanyText(url);
            if (!text) {
                return { error: "Page could not be fetched or contained no extractable text" };
            }
            return { content: text };
        },
    };

    // Fix #2: removed generic parameter — handler args cast internally instead
    // Fix #1: `as any` cast to work around Gemini SDK's overly strict Schema
    //         discriminated union, which incorrectly requires `properties` on
    //         non-object schema types (STRING / BOOLEAN / NUMBER).
    const extractField: ToolDefinition = {
        declaration: {
            name: "extractField",
            description:
                "Record your final answer for the field. Call this exactly once when you have gathered enough information. This is the only way to save your answer.",
            parameters: {
                type: SchemaType.OBJECT,
                properties: {
                    value: {
                        type: OUTPUT_TYPE_SCHEMA[outputType],
                        description: "The extracted value to record.",
                    } as any,
                },
                required: ["value"],
            },
        },
        handler: async (args) => {
            const { value } = args as { value: unknown };
            const coerced = coerceToOutputType(value, outputType);
            const payload = JSON.stringify({ [fieldKey]: coerced });
            await prisma.$executeRaw`
        UPDATE "Lead"
        SET "enrichmentData" = COALESCE("enrichmentData", '{}'::jsonb) || ${payload}::jsonb
        WHERE id = ${leadId}
      `;
            return { recorded: true };
        },
    };

    return [webSearch, scrape, extractField];
}