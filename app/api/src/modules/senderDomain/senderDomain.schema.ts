import { z } from "zod";

export const createSenderDomainSchema = z.object({
  domain: z
    .string()
    .min(1)
    .transform((v) =>
      v
        .toLowerCase()
        .trim()
        .replace(/^https?:\/\//i, "")
        .replace(/^mailto:/i, "")
        .replace(/^[^@]+@/, "")
        .replace(/\/.*$/, "")
    )
    .pipe(
      z.string().regex(
        /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/,
        "Invalid domain format (e.g. outreach.company.com)"
      )
    ),

  dailyLimit: z
    .number()
    .int()
    .positive()
    .max(10000)
    .optional(),

  warmupEnabled: z.boolean().optional(),
});

export const updateSenderDomainSchema = z
  .object({
    dailyLimit: z
      .number()
      .int()
      .positive()
      .max(10000),

    warmupEnabled: z.boolean(),
  })
  .partial()
  .refine(
    (d) => Object.keys(d).length > 0,
    { message: "At least one field required" }
  );

export const getSenderDomainsQuerySchema = z.object({
  health: z
    .enum(["HEALTHY", "WARNING", "DEGRADED", "BLOCKED"])
    .optional(),

  warmupEnabled: z.coerce.boolean().optional(),

  page: z.coerce.number().int().positive().default(1),

  limit: z.coerce.number().int().positive().max(100).default(20),
});