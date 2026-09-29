import { logger } from "./logger";
import { prisma } from "./prisma";
import { encrypt, decrypt } from "./mail/crypto";

export interface HandoffPayload {
    lead: {
        id: string;
        firstName: string | null;
        lastName?: string | null;
        email: string | null;
        companyName: string;
        title?: string | null;
        website?: string | null;
        linkedinUrl?: string | null;
        qualificationScore?: number | null;
    };
    reply: {
        id: string;
        body: string;
        intent: string;
        sentimentScore?: number | null;
        buyingStage?: string | null;
        budgetSignal?: string | null;
        timelineSignal?: string | null;
    };
    campaign: {
        id: string;
        name?: string | null;
        icpDescription?: string | null;
        orgId?: string | null;
    };
    outreachSubject: string;
}

// ─── Token helpers ────────────────────────────────────────────────────────────

interface HubSpotRefreshResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
}

async function refreshHubSpotToken(integrationId: string, refreshToken: string): Promise<string | null> {
    const clientId = process.env.HUBSPOT_CLIENT_ID;
    const clientSecret = process.env.HUBSPOT_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    try {
        const res = await fetch("https://api.hubapi.com/oauth/v1/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                client_id: clientId,
                client_secret: clientSecret,
                refresh_token: refreshToken,
            }),
            signal: AbortSignal.timeout(10_000),
        });

        if (!res.ok) {
            logger.warn({ status: res.status }, "[crm-handoff] HubSpot token refresh failed");
            return null;
        }

        const data = await res.json() as HubSpotRefreshResponse;
        const expiresAt = new Date(Date.now() + data.expires_in * 1000);

        await prisma.crmIntegration.update({
            where: { id: integrationId },
            data: {
                accessToken: encrypt(data.access_token),
                refreshToken: data.refresh_token ? encrypt(data.refresh_token) : undefined,
                tokenExpiresAt: expiresAt,
                syncErrorCount: 0,
            },
        });

        return data.access_token;
    } catch (err) {
        logger.warn({ err }, "[crm-handoff] HubSpot token refresh threw");
        return null;
    }
}

async function getHubSpotToken(orgId?: string | null): Promise<string | null> {
    if (orgId) {
        const integration = await prisma.crmIntegration.findUnique({
            where: { orgId_provider: { orgId, provider: "HUBSPOT" } },
            select: { id: true, accessToken: true, refreshToken: true, tokenExpiresAt: true },
        });

        if (integration) {
            const expiresSoon =
                integration.tokenExpiresAt &&
                integration.tokenExpiresAt.getTime() < Date.now() + 5 * 60 * 1000;

            if (expiresSoon && integration.refreshToken) {
                const refreshed = await refreshHubSpotToken(
                    integration.id,
                    decrypt(integration.refreshToken)
                );
                if (refreshed) return refreshed;
            }

            try {
                return decrypt(integration.accessToken);
            } catch {
                logger.warn({ orgId }, "[crm-handoff] Failed to decrypt HubSpot access token");
            }
        }
    }

    return process.env.HUBSPOT_ACCESS_TOKEN ?? null;
}

async function logCrmSync(
    orgId: string,
    provider: "HUBSPOT" | "SALESFORCE",
    action: string,
    success: boolean,
    errorMsg?: string,
    metadata?: Record<string, unknown>
): Promise<void> {
    try {
        const integration = await prisma.crmIntegration.findUnique({
            where: { orgId_provider: { orgId, provider } },
            select: { id: true },
        });
        if (!integration) return;

        await prisma.crmSyncLog.create({
            data: {
                integrationId: integration.id,
                action,
                success,
                errorMsg: errorMsg ?? null,
                metadata: (metadata ?? null) as Parameters<typeof prisma.crmSyncLog.create>[0]["data"]["metadata"],
            },
        });

        if (!success) {
            await prisma.crmIntegration.update({
                where: { id: integration.id },
                data: { syncErrorCount: { increment: 1 } },
            });
        } else {
            await prisma.crmIntegration.update({
                where: { id: integration.id },
                data: { lastSyncAt: new Date(), syncErrorCount: 0 },
            });
        }
    } catch (err) {
        logger.warn({ err }, "[crm-handoff] Failed to write sync log");
    }
}

// ─── HubSpot ──────────────────────────────────────────────────────────────────

async function hubSpotRequest(
    token: string,
    url: string,
    options: RequestInit
): Promise<{ ok: boolean; status: number; body: unknown }> {
    const res = await fetch(url, {
        ...options,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...(options.headers as Record<string, string> ?? {}),
        },
        signal: AbortSignal.timeout(8_000),
    });
    let body: unknown;
    try { body = await res.json(); } catch { body = null; }
    return { ok: res.ok, status: res.status, body };
}

async function createHubSpotDeal(payload: HandoffPayload): Promise<void> {
    const orgId = payload.campaign.orgId ?? null;
    const token = await getHubSpotToken(orgId);
    if (!token) return;

    const portalId = process.env.HUBSPOT_PORTAL_ID;
    const stageId = process.env.HUBSPOT_MEETING_STAGE_ID ?? "appointmentscheduled";

    let contactId: string | null = null;
    try {
        const { ok, body } = await hubSpotRequest(token, "https://api.hubapi.com/crm/v3/objects/contacts/search", {
            method: "POST",
            body: JSON.stringify({
                filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: payload.lead.email ?? "" }] }],
                properties: ["hs_object_id"],
                limit: 1,
            }),
        });

        if (ok) {
            const data = body as { total: number; results: Array<{ id: string }> };
            if (data.total > 0 && data.results[0]) {
                contactId = data.results[0].id;
            } else if (payload.lead.email) {
                const { ok: cOk, body: cBody } = await hubSpotRequest(token, "https://api.hubapi.com/crm/v3/objects/contacts", {
                    method: "POST",
                    body: JSON.stringify({
                        properties: {
                            email: payload.lead.email,
                            firstname: payload.lead.firstName ?? "",
                            lastname: payload.lead.lastName ?? "",
                            company: payload.lead.companyName,
                            jobtitle: payload.lead.title ?? "",
                            website: payload.lead.website ?? "",
                        },
                    }),
                });
                if (cOk) contactId = (cBody as { id: string }).id;
            }
        }
    } catch (err) {
        logger.warn({ err }, "[crm-handoff] HubSpot contact upsert failed");
    }

    try {
        const dealProperties: Record<string, string> = {
            dealname: `${payload.lead.companyName} — ${payload.campaign.name ?? payload.campaign.id}`,
            dealstage: stageId,
            pipeline: process.env.HUBSPOT_PIPELINE_ID ?? "default",
            description: `AI SDR reply — intent: ${payload.reply.intent}\n\nReply preview:\n${payload.reply.body.slice(0, 500)}\n\nOriginal subject: ${payload.outreachSubject}`,
            lead_source: "AI SDR — Campaign",
        };
        if (portalId) dealProperties.hs_analytics_source = "OFFLINE";

        const { ok, status, body } = await hubSpotRequest(token, "https://api.hubapi.com/crm/v3/objects/deals", {
            method: "POST",
            body: JSON.stringify({
                properties: dealProperties,
                associations: contactId
                    ? [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }]
                    : [],
            }),
        });

        if (status === 401 && orgId) {
            const integration = await prisma.crmIntegration.findUnique({
                where: { orgId_provider: { orgId, provider: "HUBSPOT" } },
                select: { id: true, refreshToken: true },
            });
            if (integration?.refreshToken) {
                const newToken = await refreshHubSpotToken(integration.id, decrypt(integration.refreshToken));
                if (newToken) {
                    await createHubSpotDealWithToken(newToken, payload, portalId, stageId, contactId, orgId);
                    return;
                }
            }
        }

        if (!ok) {
            logger.warn({ status, body }, "[crm-handoff] HubSpot deal create failed");
            if (orgId) await logCrmSync(orgId, "HUBSPOT", "create_deal", false, `HTTP ${status}`);
            return;
        }

        const deal = body as { id: string };
        logger.info({ dealId: deal.id, leadId: payload.lead.id }, "[crm-handoff] HubSpot deal created");
        if (orgId) await logCrmSync(orgId, "HUBSPOT", "create_deal", true, undefined, { dealId: deal.id });
    } catch (err) {
        logger.warn({ err }, "[crm-handoff] HubSpot deal creation threw");
        if (orgId) await logCrmSync(orgId, "HUBSPOT", "create_deal", false, (err as Error).message);
    }
}

async function createHubSpotDealWithToken(
    token: string,
    payload: HandoffPayload,
    portalId: string | undefined,
    stageId: string,
    contactId: string | null,
    orgId: string
): Promise<void> {
    const dealProperties: Record<string, string> = {
        dealname: `${payload.lead.companyName} — ${payload.campaign.name ?? payload.campaign.id}`,
        dealstage: stageId,
        pipeline: process.env.HUBSPOT_PIPELINE_ID ?? "default",
        description: `AI SDR reply — intent: ${payload.reply.intent}\n\nReply preview:\n${payload.reply.body.slice(0, 500)}\n\nOriginal subject: ${payload.outreachSubject}`,
        lead_source: "AI SDR — Campaign",
    };
    if (portalId) dealProperties.hs_analytics_source = "OFFLINE";

    const { ok, status, body } = await hubSpotRequest(token, "https://api.hubapi.com/crm/v3/objects/deals", {
        method: "POST",
        body: JSON.stringify({
            properties: dealProperties,
            associations: contactId
                ? [{ to: { id: contactId }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 3 }] }]
                : [],
        }),
    });

    if (!ok) {
        logger.warn({ status, body }, "[crm-handoff] HubSpot deal create (retry) failed");
        await logCrmSync(orgId, "HUBSPOT", "create_deal_retry", false, `HTTP ${status}`);
        return;
    }

    const deal = body as { id: string };
    logger.info({ dealId: deal.id, leadId: payload.lead.id }, "[crm-handoff] HubSpot deal created (after refresh)");
    await logCrmSync(orgId, "HUBSPOT", "create_deal_retry", true, undefined, { dealId: deal.id });
}

// ─── Salesforce ───────────────────────────────────────────────────────────────

async function createSalesforceOpportunity(payload: HandoffPayload): Promise<void> {
    const token = process.env.SALESFORCE_ACCESS_TOKEN;
    const instanceUrl = process.env.SALESFORCE_INSTANCE_URL;
    if (!token || !instanceUrl) return;

    const orgId = payload.campaign.orgId ?? null;

    try {
        const res = await fetch(`${instanceUrl}/services/data/v59.0/sobjects/Opportunity/`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({
                Name: `${payload.lead.companyName} — Meeting Booked`,
                StageName: "Meeting Booked",
                CloseDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
                LeadSource: "AI SDR",
                Description: `Reply intent: ${payload.reply.intent}\n\nReply preview:\n${payload.reply.body.slice(0, 500)}\n\nSubject: ${payload.outreachSubject}`,
                ...(payload.lead.qualificationScore !== null && payload.lead.qualificationScore !== undefined
                    ? { Probability: Math.round(payload.lead.qualificationScore) }
                    : {}),
            }),
            signal: AbortSignal.timeout(8_000),
        });

        if (!res.ok) {
            const body = await res.text();
            logger.warn({ status: res.status, body }, "[crm-handoff] Salesforce opportunity create failed");
            if (orgId) await logCrmSync(orgId, "SALESFORCE", "create_opportunity", false, `HTTP ${res.status}`);
            return;
        }

        const opp = await res.json() as { id: string };
        logger.info({ opportunityId: opp.id, leadId: payload.lead.id }, "[crm-handoff] Salesforce opportunity created");
        if (orgId) await logCrmSync(orgId, "SALESFORCE", "create_opportunity", true, undefined, { opportunityId: opp.id });
    } catch (err) {
        logger.warn({ err }, "[crm-handoff] Salesforce opportunity creation threw");
        if (orgId) await logCrmSync(orgId, "SALESFORCE", "create_opportunity", false, (err as Error).message);
    }
}

// ─── Slack ────────────────────────────────────────────────────────────────────

async function notifySlack(payload: HandoffPayload): Promise<void> {
    const webhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (!webhookUrl) return;

    const intentEmoji = payload.reply.intent === "MEETING_REQUEST" ? "📅" : "🔥";
    const leadLine = [payload.lead.firstName, payload.lead.lastName].filter(Boolean).join(" ") || "Unknown";
    const dashboardUrl = process.env.APP_URL ? `${process.env.APP_URL}/dashboard/replies` : null;

    const blocks = [
        { type: "header", text: { type: "plain_text", text: `${intentEmoji} Hot reply — ${payload.lead.companyName}`, emoji: true } },
        {
            type: "section",
            fields: [
                { type: "mrkdwn", text: `*Contact:*\n${leadLine}` },
                { type: "mrkdwn", text: `*Company:*\n${payload.lead.companyName}` },
                { type: "mrkdwn", text: `*Intent:*\n${payload.reply.intent}` },
                { type: "mrkdwn", text: `*Title:*\n${payload.lead.title ?? "—"}` },
            ],
        },
        { type: "section", text: { type: "mrkdwn", text: `*Reply preview:*\n> ${payload.reply.body.slice(0, 400).replace(/\n/g, "\n> ")}` } },
        ...(payload.reply.buyingStage || payload.reply.budgetSignal || payload.reply.timelineSignal
            ? [{
                type: "context",
                elements: [{
                    type: "mrkdwn",
                    text: [
                        payload.reply.buyingStage && `Stage: *${payload.reply.buyingStage}*`,
                        payload.reply.budgetSignal && `Budget: ${payload.reply.budgetSignal}`,
                        payload.reply.timelineSignal && `Timeline: ${payload.reply.timelineSignal}`,
                    ].filter(Boolean).join("  ·  "),
                }],
            }]
            : []),
        ...(dashboardUrl
            ? [{ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "View in Dashboard", emoji: true }, url: dashboardUrl, style: "primary" }] }]
            : []),
    ];

    try {
        const res = await fetch(webhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ blocks }),
            signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) logger.warn({ status: res.status }, "[crm-handoff] Slack notification failed");
    } catch (err) {
        logger.warn({ err }, "[crm-handoff] Slack notification threw");
    }
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function triggerCrmHandoff(payload: HandoffPayload): Promise<void> {
    const provider = process.env.CRM_PROVIDER?.toLowerCase();

    const tasks: Promise<void>[] = [notifySlack(payload)];

    if (provider === "hubspot") tasks.push(createHubSpotDeal(payload));
    else if (provider === "salesforce") tasks.push(createSalesforceOpportunity(payload));

    const results = await Promise.allSettled(tasks);
    for (const r of results) {
        if (r.status === "rejected") {
            logger.error({ err: r.reason }, "[crm-handoff] A handoff sink threw unexpectedly");
        }
    }
}
