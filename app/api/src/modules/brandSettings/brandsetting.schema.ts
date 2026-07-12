import { z } from "zod";

const hexColour = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, {
    message: "Must be a valid hex colour e.g. #1a1a2e or #fff",
  });

const SAFE_FONT_STACKS = [
  "Arial, sans-serif",
  "Georgia, serif",
  "Verdana, sans-serif",
  "Tahoma, Geneva, sans-serif",
  "Trebuchet MS, sans-serif",
  "Times New Roman, serif",
  "Courier New, monospace",
] as const;

const fontFamilyEnum = z.enum(SAFE_FONT_STACKS);

export const upsertBrandSettingsSchema = z.object({
  companyName: z.string().min(1).max(100),
  website: z.string().url().or(z.literal("")).nullish(),
  tagline: z.string().max(120).nullish(),
  logoUrl: z.string().url().or(z.literal("")).nullish(),

  primaryColour: hexColour.default("#1a1a2e"),
  secondaryColour: hexColour.default("#e94560"),
  accentColour: hexColour.nullish(),
  textColour: hexColour.default("#333333"),
  backgroundColour: hexColour.default("#ffffff"),

  fontFamily: fontFamilyEnum.default("Arial, sans-serif"),

  senderName: z.string().min(1).max(100),
  senderTitle: z.string().max(100).nullish(),
  senderPhone: z.string().max(30).nullish(),

  companyAddress: z.string().max(300).nullish(),
  unsubscribeText: z
    .string()
    .max(500)
    .default(
      "You received this email because you match our ideal customer profile. To unsubscribe, reply with 'unsubscribe'."
    ),
  facebookUrl: z.string().url().or(z.literal("")).nullish(),
  linkedinUrl: z.string().url().or(z.literal("")).nullish(),
  twitterUrl: z.string().url().or(z.literal("")).nullish(),
});

export const SAFE_FONT_STACKS_LIST = SAFE_FONT_STACKS;