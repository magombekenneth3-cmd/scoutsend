import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { upsertBrandSettingsSchema } from "./brandsetting.schema";
import {
    renderEmailTemplate,
    BrandConfig,
    DEFAULT_BRAND,
} from "../../lib/emailTemplate";


export async function upsertBrandSettings(
    userId: string,
    data: z.infer<typeof upsertBrandSettingsSchema>
) {
    return prisma.brandSettings.upsert({
        where: { userId },
        create: { ...data, userId },
        update: data,
    });
}

// ─── Get ──────────────────────────────────────────────────────────────────────

export async function getBrandSettings(userId: string) {
    return prisma.brandSettings.findUnique({ where: { userId } });
}

// ─── Get or default ───────────────────────────────────────────────────────────
// Used internally by the send agent — never returns null.
// Falls back to DEFAULT_BRAND so sends always work even without brand setup.

export async function getBrandSettingsOrDefault(
    userId: string
): Promise<BrandConfig> {
    const settings = await prisma.brandSettings.findUnique({ where: { userId } });

    if (!settings) return DEFAULT_BRAND;

    return {
        companyName: settings.companyName,
        website: settings.website,
        tagline: settings.tagline,
        logoUrl: settings.logoUrl,
        primaryColour: settings.primaryColour,
        secondaryColour: settings.secondaryColour,
        accentColour: settings.accentColour,
        textColour: settings.textColour,
        backgroundColour: settings.backgroundColour,
        fontFamily: settings.fontFamily,
        senderName: settings.senderName,
        senderTitle: settings.senderTitle,
        senderPhone: settings.senderPhone,
        companyAddress: settings.companyAddress,
        unsubscribeText: settings.unsubscribeText,
        facebookUrl: settings.facebookUrl,
        linkedinUrl: settings.linkedinUrl,
        twitterUrl: settings.twitterUrl,
    };
}

// ─── Preview ──────────────────────────────────────────────────────────────────
// Renders a sample email with the user's brand settings.
// Lets users see exactly what their emails will look like before sending.

export async function previewBrandEmail(userId: string): Promise<string> {
    const brand = await getBrandSettingsOrDefault(userId);

    const { html } = renderEmailTemplate(brand, {
        subject: "Quick question about your team's workflow",
        greeting: "Hi Sarah,",
        opening:
            "I noticed your team recently expanded into East Africa — congratulations on the growth.",
        body: "We help sales teams like yours automate outreach without losing the personal touch. Most of our customers see 3x more replies compared to generic cold email tools, and they're up and running in under a day.",
        ctaText: "Let's connect",
        ctaUrl: brand.website ?? "#",
        closing: "Looking forward to hearing from you,",
    });

    return html;
}