import { callGeminiWithTools, MODELS, SchemaType, ToolDefinition } from "./gemini.client";
import { logger } from "../../lib/logger";

export interface CompetitorPainPoint {
    painPoint: string;
    sentiment: "negative" | "mixed";
    source: "G2" | "Reddit" | "Capterra" | "Twitter" | "Gemini";
    severity: "high" | "medium";
}

export interface CompetitorSentimentResult {
    tool: string;
    painPoints: CompetitorPainPoint[];
}

const SENTIMENT_TOOL: ToolDefinition = {
    declaration: {
        name: "returnResult",
        description: "Return structured market sentiments and pain points for each competitor tool.",
        parameters: {
            type: SchemaType.OBJECT,
            properties: {
                results: {
                    type: SchemaType.ARRAY,
                    description: "One entry per competitor tool.",
                    items: {
                        type: SchemaType.OBJECT,
                        properties: {
                            tool: {
                                type: SchemaType.STRING,
                                description: "The competitor tool domain, e.g. 'apollo.io'.",
                            },
                            painPoints: {
                                type: SchemaType.ARRAY,
                                description: "4 to 6 distinct pain points real users complain about.",
                                items: {
                                    type: SchemaType.OBJECT,
                                    properties: {
                                        painPoint: {
                                            type: SchemaType.STRING,
                                            description: "A specific, concrete complaint in plain English, 10-20 words.",
                                        },
                                        sentiment: {
                                            type: SchemaType.STRING,
                                            description: "'negative' or 'mixed'.",
                                        },
                                        source: {
                                            type: SchemaType.STRING,
                                            description: "Where this complaint is commonly seen: 'G2', 'Reddit', 'Capterra', 'Twitter', or 'Gemini' if inferred.",
                                        },
                                        severity: {
                                            type: SchemaType.STRING,
                                            description: "'high' if it causes churn or blocks adoption, 'medium' if it's a friction point.",
                                        },
                                    },
                                    required: ["painPoint", "sentiment", "source", "severity"],
                                },
                            },
                        },
                        required: ["tool", "painPoints"],
                    },
                },
            },
            required: ["results"],
        },
    },
    handler: async (args) => args,
};

function isValidResult(raw: unknown): raw is { results: CompetitorSentimentResult[] } {
    if (typeof raw !== "object" || raw === null) return false;
    const obj = raw as Record<string, unknown>;
    if (!Array.isArray(obj.results)) return false;
    return obj.results.every(
        (r): r is CompetitorSentimentResult =>
            typeof r === "object" && r !== null &&
            typeof (r as Record<string, unknown>).tool === "string" &&
            Array.isArray((r as Record<string, unknown>).painPoints),
    );
}

export async function fetchCompetitorSentiments(
    tools: string[],
): Promise<CompetitorSentimentResult[]> {
    if (tools.length === 0) return [];

    const toolList = tools.map((t) => `- ${t}`).join("\n");

    const { result } = await callGeminiWithTools<unknown>({
        agentName: "competitor-sentiment.agent",
        model: MODELS.GENERATE,
        systemPrompt: `You are a competitive intelligence analyst specialising in B2B SaaS sales and marketing tools. Your knowledge covers public reviews on G2, Capterra, Reddit (r/sales, r/SaaS, r/marketing), and Twitter/X.

For each tool provided, return 4–6 distinct pain points that real users publicly complain about. Be specific and concrete — avoid vague statements like "could be better". Use the actual language reviewers use.

Focus on pain points in these categories (pick the most prominent):
- Data quality and freshness
- Deliverability and inbox placement
- Personalisation depth (template-blasting vs true 1:1)
- Pricing relative to value for SMB/mid-market
- Platform complexity and onboarding
- Support quality and response time
- Sequencing and automation limitations
- Compliance and GDPR tooling

Only return pain points that are genuinely representative of user sentiment — do not fabricate.`,
        userPrompt: `Return market pain points for these competitor tools:\n${toolList}`,
        tools: [SENTIMENT_TOOL],
        temperature: 0.3,
    });

    if (!isValidResult(result)) {
        logger.error({ result }, "[competitor-sentiment.agent] Invalid response shape");
        throw new Error("Competitor sentiment agent returned an unexpected shape");
    }

    logger.info(
        { tools, totalPainPoints: result.results.reduce((n, r) => n + r.painPoints.length, 0) },
        "[competitor-sentiment.agent] Sentiments fetched",
    );

    return result.results;
}
