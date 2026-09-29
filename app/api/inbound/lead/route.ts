import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual, createHmac, createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/api/src/lib/prisma";
import { logger } from "@/app/api/src/lib/logger";
import { isRateLimited, getClientIp } from "@/app/api/src/lib/rateLimit";

// ─── Auth ─────────────────────────────────────────────────────────────────────

function verifyBearerOrHmac(req: NextRequest): { ok: boolean; method: "bearer" | "hmac" | "none" } {
    const secret = process.env.INBOUND_LEAD_SECRET;
    if (!secret) {
        logger.warn({}, "[inbound-lead] INBOUND_LEAD_SECRET not set");
        return { ok: false, method: "none" };
    }

    const authHeader = req.headers.get("authorization") ?? "";
    if (authHeader.startsWith("Bearer ")) {
        const incoming = authHeader.slice(7);
        try {
            const a = Buffer.from(incoming, "utf8");
            const b = Buffer.from(secret, "utf8");
            const ok = a.length === b.length && timingSafeEqual(a, b);
            return { ok, method: "bearer" };
        } catch {
            return { ok: false, method: "bearer" };
        }
    }

    if (req.headers.get("x-signature-sha256")) {
        return { ok: true, method: "hmac" };
    }

    return { ok: false, method: "none" };
}

async function verifyApiKey(req: NextRequest): Promise<{ ok: boolean; orgId?: string }> {
    const raw = req.headers.get("x-api-key");
    if (!raw || !raw.startsWith("ak_")) return { ok: false };

    const hash = createHash("sha256").update(raw).digest("hex");
    const key = await prisma.apiKey.findUnique({
        where: { keyHash: hash },
        select: { id: true, orgId: true, scopes: true, revokedAt: true },
    });
    if (!key || key.revokedAt) return { ok: false };
    if (!key.scopes.includes("inbound:lead") && !key.scopes.includes("*")) return { ok: false };

    prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
    return { ok: true, orgId: key.orgId };
}

function verifyHmac(secret: string, signature: string, rawBody: string): boolean {
    const expected = `sha256=${createHmac("sha256", secret).update(rawBody, "utf8").digest("hex")}`;
    try {
        const a = Buffer.from(signature, "utf8");
        const b = Buffer.from(expected, "utf8");
        return a.length === b.length && timingSafeEqual(a, b);
    } catch {
        return false;
    }
}

// ─── Schema ───────────────────────────────────────────────────────────────────

const inboundLeadSchema = z.object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().max(100).optional(),
    email: z.string().email(),
    companyName: z.string().min(1).max(200),
    title: z.string().max(200).optional(),
    website: z.string().url().optional(),
    linkedinUrl: z.string().url().optional(),
    phone: z.string().max(50).optional(),
    source: z.string().max(100).optional(),
    campaignId: z.string().min(1).optional(),
    customFields: z.record(z.string(), z.unknown()).optional(),
});

type InboundLeadPayload = z.infer<typeof inboundLeadSchema>;

// ─── Lead resolution ──────────────────────────────────────────────────────────

async function resolveTargetCampaign(
    campaignId?: string,
    orgId?: string
): Promise<{ id: string; createdById: string; name: string } | null> {
    if (campaignId) {
        return prisma.campaign.findUnique({
            where: { id: campaignId, deletedAt: null },
            select: { id: true, createdById: true, name: true },
        });
    }

    return prisma.campaign.findFirst({
        where: {
            status: { in: ["QUEUED", "SENDING", "GENERATING"] },
            inboundEnabled: true,
            deletedAt: null,
            ...(orgId ? { createdBy: { orgMemberships: { some: { orgId } } } } : {}),

        },
        orderBy: { updatedAt: "desc" },
        select: { id: true, createdById: true, name: true },
    });
}

async function upsertInboundLead(
    payload: InboundLeadPayload,
    campaign: { id: string; createdById: string }
): Promise<{ leadId: string; created: boolean }> {
    const existing = await prisma.lead.findUnique({
        where: { campaignId_email: { campaignId: campaign.id, email: payload.email } },
        select: { id: true },
    });
    if (existing) return { leadId: existing.id, created: false };

    const domain = payload.email.split("@")[1] ?? "";
    const suppressed = await prisma.suppression.findFirst({
        where: { userId: campaign.createdById, OR: [{ email: payload.email }, { domain }] },
        select: { id: true },
    });
    if (suppressed) {
        logger.info({ email: payload.email, campaignId: campaign.id }, "[inbound-lead] Skipped — suppressed");
        return { leadId: "", created: false };
    }

    const lead = await prisma.lead.create({
        data: {
            firstName: payload.firstName,
            lastName: payload.lastName ?? null,
            email: payload.email,
            companyName: payload.companyName,
            title: payload.title ?? null,
            website: payload.website ?? null,
            linkedinUrl: payload.linkedinUrl ?? null,
            campaignId: campaign.id,
            emailStatus: "FOUND",
            emailVerified: false,
            source: payload.source ?? "inbound-webhook",
            enrichmentData: {
                inboundSource: payload.source ?? "webhook",
                phone: payload.phone ?? null,
                customFields: payload.customFields ?? {},
                inboundReceivedAt: new Date().toISOString(),
            } as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
    });

    return { leadId: lead.id, created: true };
}

async function enqueueInstantProcessing(leadId: string, campaignId: string): Promise<void> {
    const { enqueueEnrichmentBatches } = await import("@/app/api/src/modules/gemini/email-enrichment.queue");
    await enqueueEnrichmentBatches([leadId], campaignId);
    logger.info({ leadId, campaignId }, "[inbound-lead] Full enrichment waterfall queued");
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
    const ip = getClientIp(req);
    const rateLimitKey = req.headers.get("x-api-key") || req.headers.get("authorization") || req.headers.get("x-signature-sha256") || "anon";

    const [ipLimited, keyLimited] = await Promise.all([
        isRateLimited(`rate:inbound:ip:${ip}`, 100, 60),
        isRateLimited(`rate:inbound:key:${rateLimitKey}`, 200, 60),
    ]);
    if (ipLimited || keyLimited) {
        return NextResponse.json({ error: "Too many requests" }, { status: 429 });
    }

    let orgId: string | undefined;
    let rawBody = "";

    if (req.headers.get("x-api-key")) {
        const apiKeyAuth = await verifyApiKey(req);
        if (!apiKeyAuth.ok) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        orgId = apiKeyAuth.orgId;
    } else {
        const auth = verifyBearerOrHmac(req);
        if (!auth.ok && auth.method !== "hmac") {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
        if (auth.method === "hmac") {
            try { rawBody = await req.text(); } catch {
                return NextResponse.json({ error: "Invalid body" }, { status: 400 });
            }
            if (!verifyHmac(process.env.INBOUND_LEAD_SECRET!, req.headers.get("x-signature-sha256") ?? "", rawBody)) {
                return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
            }
        }
    }

    let parsed: unknown;
    try {
        if (!rawBody) rawBody = await req.text();
        parsed = JSON.parse(rawBody);
    } catch {
        return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const validation = inboundLeadSchema.safeParse(parsed);
    if (!validation.success) {
        return NextResponse.json({ error: "Validation failed", details: validation.error.flatten() }, { status: 422 });
    }

    const payload = validation.data;
    const campaign = await resolveTargetCampaign(payload.campaignId, orgId);
    if (!campaign) {
        return NextResponse.json(
            { error: "No active inbound-enabled campaign found. Pass campaignId or set inboundEnabled=true on a campaign." },
            { status: 422 }
        );
    }

    const { leadId, created } = await upsertInboundLead(payload, campaign);

    if (!leadId) {
        return NextResponse.json({ ok: true, created: false, reason: "suppressed" });
    }

    if (created) {
        enqueueInstantProcessing(leadId, campaign.id).catch((err) => {
            logger.error({ err, leadId }, "[inbound-lead] Failed to enqueue enrichment");
        });
    }

    logger.info({ leadId, campaignId: campaign.id, created, email: payload.email }, "[inbound-lead] Lead processed");

    return NextResponse.json({ ok: true, leadId, campaignId: campaign.id, created }, { status: created ? 201 : 200 });
}
