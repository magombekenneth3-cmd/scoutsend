import { z } from "zod";

// ─── Credential sub-schemas ───────────────────────────────────────────────────

const smtpCredentialsSchema = z.object({
    type: z.literal("SMTP"),
    smtpHost: z.string().min(1, "SMTP host is required"),
    smtpPort: z.number().int().min(1).max(65535),
    secure: z.boolean(),
    username: z.string().min(1, "Username is required"),
    password: z.string().min(1, "Password is required"),
    imapHost: z.string().optional(),
    imapPort: z.number().int().min(1).max(65535).optional(),
});

const gmailCredentialsSchema = z.object({
    type: z.literal("GMAIL"),
    clientId: z.string().min(1, "Client ID is required"),
    clientSecret: z.string().min(1, "Client secret is required"),
    refreshToken: z.string().min(1, "Refresh token is required"),
    emailAddress: z.string().email("Must be a valid email address"),
});

const outlookCredentialsSchema = z.object({
    type: z.literal("OUTLOOK"),
    clientId: z.string().min(1, "Client ID is required"),
    clientSecret: z.string().min(1, "Client secret is required"),
    tenantId: z.string().min(1, "Tenant ID is required"),
    refreshToken: z.string().min(1, "Refresh token is required"),
    emailAddress: z.string().email("Must be a valid email address"),
});

/** Discriminated union so Zod narrows the type by `type` field */
const credentialsSchema = z.discriminatedUnion("type", [
    smtpCredentialsSchema,
    gmailCredentialsSchema,
    outlookCredentialsSchema,
]);

// ─── Public schemas ───────────────────────────────────────────────────────────

export const createSenderMailboxSchema = z.object({
    label: z.string().min(1, "Label is required").max(100),
    emailAddress: z.string().email("Must be a valid email address"),
    credentials: credentialsSchema,
    dailyLimit: z.number().int().positive().max(10_000).default(50),
    warmupEnabled: z.boolean().default(true),
});

export const updateSenderMailboxSchema = z
    .object({
        label: z.string().min(1).max(100),
        dailyLimit: z.number().int().positive().max(10_000),
        warmupEnabled: z.boolean(),
        credentials: credentialsSchema,
    })
    .partial()
    .refine((d) => Object.keys(d).length > 0, {
        message: "At least one field is required",
    });

export const getSenderMailboxesQuerySchema = z.object({
    providerType: z.enum(["GMAIL", "OUTLOOK", "SMTP"]).optional(),
    health: z.enum(["HEALTHY", "WARNING", "DEGRADED", "BLOCKED"]).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
});