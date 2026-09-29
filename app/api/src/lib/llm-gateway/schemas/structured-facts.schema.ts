/**
 * LLM Gateway Schema — StructuredCompanyFacts
 *
 * Zod schema for the output of generate.agent.ts → extractStructuredCompanyFacts().
 * All fields are required strings (empty string = not present in scraped content).
 * The model is instructed to never infer values, so all fields are present but
 * may be empty.
 */

import { z } from "zod";

export const StructuredFactsSchema = z.object({
  /** What the company sells, in one sentence. Empty string if not stated. */
  products: z.string(),
  /** Who the company sells to, in one sentence. Empty string if not stated. */
  targetCustomers: z.string(),
  /** What makes them different, in one sentence. Empty string if not stated. */
  differentiators: z.string(),
  /** Any recent product/feature/initiative. Empty string if not stated. */
  recentLaunches: z.string(),
  /** Comma-separated named tech/platforms. Empty string if not stated. */
  techStack: z.string(),
});

export type StructuredFacts = z.infer<typeof StructuredFactsSchema>;
