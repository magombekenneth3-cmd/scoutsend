import {
  GoogleGenerativeAI,
  FunctionDeclaration,
  SchemaType,
  FunctionCallingMode,
  Part,
} from "@google/generative-ai";
import { createAITrace } from "../AItrace/Aitrace.service";
import { logger } from "../../lib/logger";
import { geminiLimiter } from "./gemini.limiter";

export { SchemaType };

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const GEMINI_RETRY_ATTEMPTS = 5;
const GEMINI_RETRY_BASE_MS = 2_000;
const GEMINI_RETRY_CAP_MS = 60_000;
const GEMINI_CALL_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_TOKENS_TOOLS = 4096;
const MAX_OUTPUT_TOKENS_TEXT = 8192;

// ─── Error types ──────────────────────────────────────────────────────────────

export class GeminiBlockedError extends Error {
  constructor(public readonly reason: string) {
    super(`Gemini response blocked: ${reason}`);
    this.name = "GeminiBlockedError";
  }
}

export class GeminiPipelineError extends Error {
  public readonly blocked: boolean;
  public readonly reason: string;
  constructor(reason: string, blocked: boolean) {
    super(blocked ? `Gemini response blocked: ${reason}` : reason);
    this.name = "GeminiPipelineError";
    this.blocked = blocked;
    this.reason = reason;
  }
}

// ─── Timeout ──────────────────────────────────────────────────────────────────


function withTimeout<T>(promise: Promise<T>, ms: number, context: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`[gemini-client] ${context} timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

// ─── Retry-After parsing ──────────────────────────────────────────────────────

function parseRetryAfterMs(err: unknown): number | null {
  if (!err || typeof err !== "object") return null;
  const e = err as Record<string, unknown>;

  if (e["status"] !== 429) return null;

  const details = e["errorDetails"];
  if (!Array.isArray(details)) return null;

  for (const detail of details) {
    if (
      detail &&
      typeof detail === "object" &&
      (detail as Record<string, unknown>)["@type"] ===
      "type.googleapis.com/google.rpc.RetryInfo"
    ) {
      const raw = (detail as Record<string, unknown>)["retryDelay"];
      if (typeof raw === "string") {
        const seconds = parseFloat(raw.replace("s", ""));
        if (!isNaN(seconds) && seconds > 0) {
          // Add 2 s buffer to avoid hitting the tail of the rate-limit window.
          return Math.ceil(seconds) * 1_000 + 2_000;
        }
      }
    }
  }

  return null;
}

// ─── Model registry ───────────────────────────────────────────────────────────

export const MODELS = {
  RESEARCH: "gemini-2.5-flash",
  GENERATE: "gemini-2.5-flash",
  REVIEW: "gemini-2.5-flash",
} as const;

export type GeminiModel = (typeof MODELS)[keyof typeof MODELS];


const EMBED_MODEL = "text-embedding-004" as const;
type EmbedModel = typeof EMBED_MODEL;

export type LimiterBucketKey = GeminiModel | EmbedModel;

function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  void model;
  return (promptTokens * 0.075 + completionTokens * 0.30) / 1_000_000;
}

// ─── Core retry wrapper ───────────────────────────────────────────────────────

async function withGeminiRetry<T>(
  model: LimiterBucketKey,
  fn: () => Promise<T>,
): Promise<T> {
  let lastErr: unknown;

  for (let attempt = 0; attempt < GEMINI_RETRY_ATTEMPTS; attempt++) {
    try {
      return await geminiLimiter.schedule(model as GeminiModel, fn);
    } catch (err) {
      if (err instanceof GeminiBlockedError) throw err;

      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const status = (err as Record<string, unknown>)?.status as
        | number
        | undefined;

      const isRetryable =
        status === 408 ||
        status === 429 ||
        status === 503 ||
        msg.includes("429") ||
        msg.includes("503") ||
        msg.includes("quota") ||
        msg.includes("ECONNRESET") ||
        msg.includes("ETIMEDOUT") ||
        msg.includes("timed out");

      if (!isRetryable || attempt === GEMINI_RETRY_ATTEMPTS - 1) throw err;
      const retryAfterMs = parseRetryAfterMs(err);
      if (retryAfterMs !== null) {
        geminiLimiter.signalThrottled(model as GeminiModel, retryAfterMs);
      }
      const exponential = GEMINI_RETRY_BASE_MS * Math.pow(2, attempt);
      const capped = Math.min(exponential, GEMINI_RETRY_CAP_MS);
      const backoff = retryAfterMs ?? Math.floor(capped * (0.5 + Math.random()));

      logger.warn(
        { attempt, backoff, status, msg, model },
        "[gemini-client] Retryable error — backing off",
      );
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  throw lastErr;
}

// ─── callGemini ──────────────────────────────────────────────────────────────

export interface GeminiCallOptions {
  agentName: string;
  model: GeminiModel;
  systemPrompt: string;
  userPrompt: string;
  metadata?: Record<string, unknown>;
  temperature?: number;
  responseMimeType?: string;
  signal?: any;
  responseSchema?: any;

}

interface GeminiCallResult {
  text: string;
  tokenUsage: number;
  latencyMs: number;
  usage?: any;
}

export async function callGemini(
  opts: GeminiCallOptions,
): Promise<GeminiCallResult> {
  try {
    return await _callGemini(opts);
  } catch (err) {
    if (err instanceof GeminiBlockedError) {
      throw new GeminiPipelineError(err.reason, true);
    }
    throw err;
  }
}

async function _callGemini(
  opts: GeminiCallOptions,
): Promise<GeminiCallResult> {
  const {
    agentName,
    model,
    systemPrompt,
    userPrompt,
    metadata,
    temperature = 0.7,
    responseMimeType,
    responseSchema,
  } = opts;

  const geminiModel = genAI.getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature,
      maxOutputTokens: MAX_OUTPUT_TOKENS_TEXT,
      ...(responseMimeType && { responseMimeType }),
      ...(responseSchema && { responseSchema }),
    },
  });

  const start = Date.now();

  const result = await withGeminiRetry(model, () =>
    withTimeout(
      geminiModel.generateContent(userPrompt),
      GEMINI_CALL_TIMEOUT_MS,
      `callGemini(${agentName})`,
    ),
  );
  const response = result.response;
  const text = safeResponseText(response);
  const latencyMs = Date.now() - start;

  const promptTokens = response.usageMetadata?.promptTokenCount ?? 0;
  const completionTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
  const tokenUsage = promptTokens + completionTokens;
  const costUsd = calculateCost(model, promptTokens, completionTokens);

  createAITrace({
    agentName,
    model,
    prompt: `[SYSTEM]\n${systemPrompt}\n\n[USER]\n${userPrompt}`,
    response: text,
    latencyMs,
    tokenUsage,
    costUsd,
    metadata,
  }).catch((err) => logger.error({ err }, "[AITrace] Failed to log trace"));

  return {
    text,
    tokenUsage,
    latencyMs,
    usage: {
      promptTokens,
      completionTokens,
    },
  };
}

// ─── callGeminiWithTools ──────────────────────────────────────────────────────

export interface ToolDefinition<TArgs = Record<string, unknown>> {
  declaration: FunctionDeclaration;
  handler: (args: TArgs) => Promise<unknown>;
}

export interface GeminiToolCallOptions {
  agentName: string;
  model: GeminiModel;
  systemPrompt: string;
  userPrompt: string;
  tools: ToolDefinition[];
  metadata?: Record<string, unknown>;
  temperature?: number;
  maxTurns?: number;
}

export interface GeminiToolCallResult<T = unknown> {
  result: T;
  tokenUsage: number;
  latencyMs: number;
  turns: number;
}

export async function callGeminiWithTools<T = unknown>(
  opts: GeminiToolCallOptions,
): Promise<GeminiToolCallResult<T>> {
  try {
    return await _callGeminiWithTools<T>(opts);
  } catch (err) {
    if (err instanceof GeminiBlockedError) {
      throw new GeminiPipelineError(err.reason, true);
    }
    throw err;
  }
}

async function _callGeminiWithTools<T = unknown>(
  opts: GeminiToolCallOptions,
): Promise<GeminiToolCallResult<T>> {
  const {
    agentName,
    model,
    systemPrompt,
    userPrompt,
    tools,
    metadata,
    temperature = 0.7,
    maxTurns = 10,
  } = opts;

  const toolMap = new Map<string, ToolDefinition>(
    tools.map((t) => [t.declaration.name, t]),
  );

  const SENTINEL = "returnResult";
  const sentinelManagedInternally = !toolMap.has(SENTINEL);

  const allDeclarations: FunctionDeclaration[] = sentinelManagedInternally
    ? [
      ...tools.map((t) => t.declaration),
      {
        name: SENTINEL,
        description:
          "Call this tool with your final answer once you have gathered all the information you need.",
        parameters: {
          type: SchemaType.OBJECT,
          properties: {
            result: {
              type: SchemaType.STRING,
              description: "JSON-serialised result object or array",
            },
          },
          required: ["result"],
        },
      } satisfies FunctionDeclaration,
    ]
    : tools.map((t) => t.declaration);
  const chat = genAI
    .getGenerativeModel({
      model,
      systemInstruction: systemPrompt,
      generationConfig: { temperature, maxOutputTokens: MAX_OUTPUT_TOKENS_TOOLS },
      tools: [{ functionDeclarations: allDeclarations }],
      toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.AUTO } },
    })
    .startChat();

  let currentMessage: string | Part[] = userPrompt;
  const start = Date.now();
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let turnCount = 0;
  let captured: T | undefined;

  while (turnCount < maxTurns) {
    turnCount++;
    const res = await withGeminiRetry(model, () =>
      withTimeout(
        chat.sendMessage(currentMessage),
        GEMINI_CALL_TIMEOUT_MS,
        `callGeminiWithTools(${agentName}) turn ${turnCount}`,
      ),
    );
    const response = res.response;

    totalPromptTokens += response.usageMetadata?.promptTokenCount ?? 0;
    totalCompletionTokens += response.usageMetadata?.candidatesTokenCount ?? 0;

    const functionCalls = response.functionCalls();

    if (!functionCalls || functionCalls.length === 0) {
      const text = safeResponseText(response);
      logger.warn(
        { agentName, turnCount, text: text.slice(0, 200) },
        "[gemini-tools] Model returned text instead of tool call — attempting JSON parse",
      );
      try {
        captured = extractJSON<T>(text);
      } catch {
        captured = text as unknown as T;
      }
      break;
    }

    const toolResponseParts: Part[] = [];

    for (const call of functionCalls) {
      const { name, args } = call;

      if (name === SENTINEL) {
        if (sentinelManagedInternally) {
          const raw = (args as Record<string, unknown>).result;
          try {
            captured = (
              typeof raw === "string" ? JSON.parse(raw) : raw
            ) as T;
          } catch {
            captured = raw as unknown as T;
          }
        } else {
          const tool = toolMap.get(SENTINEL)!;
          captured = (await tool.handler(
            args as Record<string, unknown>,
          )) as T;
        }
        toolResponseParts.push({
          functionResponse: { name, response: { captured: true } },
        });
        break;
      }

      const tool = toolMap.get(name);
      if (!tool) {
        logger.warn(
          { agentName, name },
          "[gemini-tools] Unknown tool called by model",
        );
        toolResponseParts.push({
          functionResponse: {
            name,
            response: { error: `Unknown tool: ${name}` },
          },
        });
        continue;
      }

      try {
        const toolResult = await tool.handler(
          args as Record<string, unknown>,
        );
        toolResponseParts.push({
          functionResponse: {
            name,
            response: { result: JSON.stringify(toolResult) },
          },
        });
      } catch (err) {
        logger.warn({ agentName, name, err }, "[gemini-tools] Tool handler threw");
        toolResponseParts.push({
          functionResponse: {
            name,
            response: { error: (err as Error).message },
          },
        });
      }
    }

    if (captured !== undefined) break;

    currentMessage = toolResponseParts;
  }

  const latencyMs = Date.now() - start;

  if (captured === undefined) {
    throw new Error(
      `[gemini-tools] Agent ${agentName} exhausted ${maxTurns} turns without calling returnResult`,
    );
  }

  const totalTokens = totalPromptTokens + totalCompletionTokens;
  const costUsd = calculateCost(model, totalPromptTokens, totalCompletionTokens);

  createAITrace({
    agentName,
    model,
    prompt: `[SYSTEM]\n${systemPrompt}\n\n[USER]\n${userPrompt}`,
    response: JSON.stringify(captured),
    latencyMs,
    tokenUsage: totalTokens,
    costUsd,
    metadata: { ...metadata, turns: turnCount, nativeToolCalling: true },
  }).catch((err) =>
    logger.error({ err }, "[AITrace] Failed to log tool-call trace"),
  );

  return { result: captured, tokenUsage: totalTokens, latencyMs, turns: turnCount };
}

// ─── callGeminiStream ─────────────────────────────────────────────────────────

export interface GeminiStreamCallOptions extends GeminiCallOptions {
  onChunk: (text: string) => void;
}

export async function callGeminiStream(
  opts: GeminiStreamCallOptions,
): Promise<GeminiCallResult> {
  const {
    agentName,
    model,
    systemPrompt,
    userPrompt,
    metadata,
    temperature = 0.7,
    onChunk,
    responseMimeType,
  } = opts;

  const geminiModel = genAI.getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
    generationConfig: {
      temperature,
      maxOutputTokens: 4096,
      ...(responseMimeType && { responseMimeType }),
    },
  });

  const start = Date.now();
  let fullText = "";
  let promptTokens = 0;
  let completionTokens = 0;
  const result = await withGeminiRetry(model, () =>
    withTimeout(
      geminiModel.generateContentStream(userPrompt),
      GEMINI_CALL_TIMEOUT_MS,
      `callGeminiStream(${agentName}) connect`,
    ),
  );

  const STREAM_TOTAL_TIMEOUT_MS = GEMINI_CALL_TIMEOUT_MS * 4;
  const streamDeadline = new Promise<never>((_, reject) => {
    const t = setTimeout(
      () => reject(new Error(`[gemini-client] callGeminiStream(${agentName}) stream timed out after ${STREAM_TOTAL_TIMEOUT_MS}ms`)),
      STREAM_TOTAL_TIMEOUT_MS,
    );
    t.unref?.();
  });

  await Promise.race([
    (async () => {
      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        if (chunkText) {
          fullText += chunkText;
          onChunk(chunkText);
        }
        if (chunk.usageMetadata) {
          promptTokens = chunk.usageMetadata.promptTokenCount ?? 0;
          completionTokens = chunk.usageMetadata.candidatesTokenCount ?? 0;
        }
      }
    })(),
    streamDeadline,
  ]);

  const latencyMs = Date.now() - start;
  const tokenUsage = promptTokens + completionTokens;
  const costUsd = calculateCost(model, promptTokens, completionTokens);

  createAITrace({
    agentName,
    model,
    prompt: `[SYSTEM]\n${systemPrompt}\n\n[USER]\n${userPrompt}`,
    response: fullText,
    latencyMs,
    tokenUsage,
    costUsd,
    metadata,
  }).catch((err) => logger.error({ err }, "[AITrace] Failed to log trace"));

  return { text: fullText, tokenUsage, latencyMs };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function safeResponseText(response: {
  text: () => string;
  candidates?: Array<{ finishReason?: string }>;
}): string {
  const finishReason = response.candidates?.[0]?.finishReason;
  if (
    finishReason &&
    finishReason !== "STOP" &&
    finishReason !== "MAX_TOKENS"
  ) {
    throw new GeminiBlockedError(finishReason);
  }
  const text = response.text();
  if (!text) throw new GeminiBlockedError("empty response");
  return text;
}

export function extractJSON<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced ? fenced[1] : text).trim();

  const firstObj = raw.indexOf("{");
  const firstArr = raw.indexOf("[");

  let open: string;
  let close: string;
  let start: number;

  if (firstArr !== -1 && (firstObj === -1 || firstArr < firstObj)) {
    open = "[";
    close = "]";
    start = firstArr;
  } else if (firstObj !== -1) {
    open = "{";
    close = "}";
    start = firstObj;
  } else {
    throw new Error(`No JSON value found in Gemini response:\n${text}`);
  }

  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === open) {
      depth++;
      continue;
    }
    if (ch === close) {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) {
    throw new Error(`Unbalanced JSON in Gemini response:\n${text}`);
  }

  const jsonStr = raw.slice(start, end + 1);

  try {
    return JSON.parse(jsonStr) as T;
  } catch (e) {
    throw new Error(
      `Failed to parse JSON from Gemini response: ${(e as Error).message}\nRaw: ${jsonStr}`,
    );
  }
}

export async function embedText(text: string): Promise<number[]> {
  const model = genAI.getGenerativeModel({ model: EMBED_MODEL });
  const result = await withGeminiRetry(
    EMBED_MODEL,
    () =>
      withTimeout(
        model.embedContent(text.slice(0, 8_000)),
        GEMINI_CALL_TIMEOUT_MS,
        "embedText",
      ),
  );
  return result.embedding.values;
}