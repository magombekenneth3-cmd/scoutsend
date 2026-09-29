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

function coerceToOutputType(
    raw: unknown,
    outputType: AgentOutputType,
): unknown {
    if (outputType === "BOOLEAN") {
        if (typeof raw === "boolean") {
            return raw;
        }

        if (typeof raw === "string") {
            const normalized = raw.trim().toLowerCase();

            if (normalized === "true") return true;
            if (normalized === "false") return false;
        }

        if (typeof raw === "number") {
            if (raw === 1) return true;
            if (raw === 0) return false;
        }

        return null;
    }

    if (outputType === "NUMBER") {
        if (
            typeof raw === "string" &&
            raw.trim() === ""
        ) {
            return null;
        }

        const number = Number(raw);

        return Number.isFinite(number) ? number : null;
    }

    if (raw == null) {
        return null;
    }

    return typeof raw === "string"
        ? raw
        : String(raw);
}

function normalizeQuery(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const query = value.trim();

    return query.length > 0 ? query : null;
}

function normalizeUrl(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const raw = value.trim();

    if (!raw) {
        return null;
    }

    try {
        const url = new URL(raw);

        if (url.protocol !== "https:") {
            return null;
        }

        return url.toString();
    } catch {
        return null;
    }
}

function safeToolError(
    message: string,
): { error: string } {
    return { error: message };
}

export function buildLeadAgentTools(
    leadId: string,
    fieldKey: string,
    runId: string,
    outputType: AgentOutputType,
): ToolDefinition[] {
    let webSearchCount = 0;
    let scrapeCount = 0;

    const incrementToolCallCount = async (): Promise<void> => {
        await prisma.leadAgentRun.update({
            where: { id: runId },
            data: {
                toolCallCount: {
                    increment: 1,
                },
            },
        });
    };

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
            const { query: rawQuery } = args as {
                query?: unknown;
            };

            const query = normalizeQuery(rawQuery);

            if (!query) {
                return safeToolError(
                    "A non-empty search query is required",
                );
            }

            if (webSearchCount >= MAX_WEB_SEARCH_CALLS) {
                return safeToolError(
                    "webSearch call limit reached for this run",
                );
            }

            webSearchCount++;

            try {
                await incrementToolCallCount();

                const results = await serperSearch(
                    query,
                    "search",
                );

                return results.map((result) => ({
                    title: result.title,
                    url: result.link,
                    snippet: result.snippet,
                }));
            } catch {
                return safeToolError(
                    "Web search failed",
                );
            }
        },
    };

    const scrape: ToolDefinition = {
        declaration: {
            name: "scrape",
            description:
                "Fetch and extract the readable text content of a public HTTPS web page.",
            parameters: {
                type: SchemaType.OBJECT,
                properties: {
                    url: {
                        type: SchemaType.STRING,
                        description:
                            "The full HTTPS URL of the page to scrape.",
                    },
                },
                required: ["url"],
            },
        },
        handler: async (args) => {
            const { url: rawUrl } = args as {
                url?: unknown;
            };

            const url = normalizeUrl(rawUrl);

            if (!url) {
                return safeToolError(
                    "A valid HTTPS URL is required",
                );
            }

            if (scrapeCount >= MAX_SCRAPE_CALLS) {
                return safeToolError(
                    "scrape call limit reached for this run",
                );
            }

            scrapeCount++;

            try {
                await incrementToolCallCount();

                const text = await scrapeCompanyText(url);

                if (!text) {
                    return safeToolError(
                        "Page could not be fetched or contained no extractable text",
                    );
                }

                return {
                    content: text,
                };
            } catch {
                return safeToolError(
                    "Page scraping failed",
                );
            }
        },
    };

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
                        description:
                            "The extracted value to record.",
                    } as any,
                },
                required: ["value"],
            },
        },
        handler: async (args) => {
            const { value } = args as {
                value?: unknown;
            };

            const coerced = coerceToOutputType(
                value,
                outputType,
            );

            const payload = JSON.stringify({
                [fieldKey]: coerced,
            });

            try {
                await prisma.$executeRaw`
                    UPDATE "Lead"
                    SET "enrichmentData" =
                        COALESCE("enrichmentData", '{}'::jsonb)
                        || ${payload}::jsonb
                    WHERE id = ${leadId}
                `;

                return {
                    recorded: true,
                };
            } catch {
                return safeToolError(
                    "Failed to record extracted field",
                );
            }
        },
    };

    return [
        webSearch,
        scrape,
        extractField,
    ];
}