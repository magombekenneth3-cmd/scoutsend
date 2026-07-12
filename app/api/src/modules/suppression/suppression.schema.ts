import { z } from "zod";

const domainRegex = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export const createSuppressionSchema = z
  .object({
    email: z.string().email().optional(),
    domain: z.string().regex(domainRegex, "Invalid domain format").optional(),
    reason: z.string().min(1),
    source: z.string().optional(),
  })
  .refine((d) => d.email || d.domain, {
    message: "Either email or domain is required",
  });

export const checkSuppressionSchema = z
  .object({
    email: z.string().email().optional(),
    domain: z.string().regex(domainRegex, "Invalid domain format").optional(),
  })
  .refine((d) => d.email || d.domain, {
    message: "Either email or domain is required",
  });

export const getSuppressionQuerySchema = z.object({
  email: z.string().optional(),
  domain: z.string().optional(),
  source: z.string().optional(),
  type: z.enum(["all", "email", "domain"]).optional().default("all"),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(25),
});