import { z } from "zod";

export const getAITracesQuerySchema = z.object({
  agentName: z.string().optional(),
  model: z.string().optional(),
  minConfidence: z.coerce.number().min(0).max(1).optional(),
  maxConfidence: z.coerce.number().min(0).max(1).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const createAITraceSchema = z.object({
  agentName: z.string().min(1),
  prompt: z.string().min(1),
  response: z.string().min(1),
  model: z.string().min(1),
  latencyMs: z.number().int().nonnegative().optional(),
  tokenUsage: z.number().int().nonnegative().optional(),
  confidence: z.number().min(0).max(1).optional(),
  costUsd: z.number().nonnegative().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});
