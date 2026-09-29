import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { decrypt } from "../../lib/mail/crypto";
import { crmSyncQueue, CrmSyncJobData } from "./crm.queue";

interface SyncCrmLeadParams {
  orgId: string;
  leadId: string;
  replyId?: string;
  intent?: string;
  eventType: "POSITIVE_REPLY" | "MEETING_REQUEST" | "ENRICHED_LEAD";
}

async function performHubspotSync(
  accessToken: string,
  lead: LeadFields,
  payload: SyncPayload
): Promise<{ success: boolean; statusCode: number | null }> {
  const res = await fetch("https://api.hubapi.com/crm/v3/objects/contacts", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      properties: {
        email: lead.email,
        firstname: lead.firstName,
        lastname: lead.lastName,
        company: lead.companyName,
        jobtitle: lead.title,
        hs_lead_status: payload.eventType === "MEETING_REQUEST" ? "IN_PROGRESS" : "OPEN",
      },
    }),
  }).catch(() => null);

  return { success: res ? res.ok || res.status === 409 : false, statusCode: res?.status ?? null };
}

async function performSalesforceSync(
  accessToken: string,
  lead: LeadFields,
  payload: SyncPayload
): Promise<{ success: boolean; statusCode: number | null }> {
  const instanceUrl = process.env.SALESFORCE_INSTANCE_URL ?? "https://login.salesforce.com";
  const res = await fetch(`${instanceUrl}/services/data/v58.0/sobjects/Lead`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      Email: lead.email,
      FirstName: lead.firstName,
      LastName: lead.lastName || lead.companyName,
      Company: lead.companyName,
      Title: lead.title,
      Status: payload.eventType === "MEETING_REQUEST" ? "Working - Contacted" : "Open - Not Contacted",
    }),
  }).catch(() => null);

  return { success: res ? res.ok || res.status === 409 : false, statusCode: res?.status ?? null };
}

interface LeadFields {
  id: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  companyName: string | null;
  title: string | null;
  qualificationScore: number | null;
  pipelineStage: string | null;
  domain: string | null;
}

interface SyncPayload {
  eventType: string;
  intent?: string;
  replyId?: string;
}

export async function syncSingleIntegration(data: CrmSyncJobData): Promise<void> {
  const { integrationId, leadId, eventType, intent, replyId } = data;

  const integration = await prisma.crmIntegration.findUnique({ where: { id: integrationId } });
  if (!integration) return;

  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      companyName: true,
      title: true,
      qualificationScore: true,
      pipelineStage: true,
      domain: true,
    },
  });
  if (!lead || !lead.email) return;

  let accessToken: string;
  try {
    accessToken = decrypt(integration.accessToken);
  } catch (decryptErr) {
    logger.error({ decryptErr, integrationId }, "[crm.sync] Failed to decrypt access token");
    return;
  }

  const payload: SyncPayload = { eventType, intent, replyId };
  let result: { success: boolean; statusCode: number | null };

  if (integration.provider === "HUBSPOT") {
    result = await performHubspotSync(accessToken, lead, payload);
  } else if (integration.provider === "SALESFORCE") {
    result = await performSalesforceSync(accessToken, lead, payload);
  } else {
    return;
  }

  const errorMsg = result.success ? null : `HTTP ${result.statusCode ?? 500}`;

  await prisma.crmSyncLog.create({
    data: {
      integrationId,
      action: `${integration.provider}_${eventType}`,
      success: result.success,
      errorMsg,
      metadata: { email: lead.email, eventType, intent, replyId },
    },
  });

  if (result.success) {
    await prisma.crmIntegration.update({
      where: { id: integrationId },
      data: { lastSyncAt: new Date(), syncErrorCount: 0, lastSyncError: null },
    });
  } else {
    await prisma.crmIntegration.update({
      where: { id: integrationId },
      data: {
        syncErrorCount: { increment: 1 },
        lastSyncError: `${integration.provider} sync failed — ${errorMsg} at ${new Date().toISOString()}`,
      },
    });
    throw new Error(`CRM sync failed: ${errorMsg}`);
  }
}

export async function syncLeadToCrm(params: SyncCrmLeadParams): Promise<void> {
  const { orgId, leadId, replyId, intent, eventType } = params;

  try {
    const integrations = await prisma.crmIntegration.findMany({ where: { orgId } });
    if (integrations.length === 0) return;

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { id: true },
    });
    if (!lead) return;

    for (const integration of integrations) {
      const jobData: CrmSyncJobData = {
        orgId,
        leadId,
        integrationId: integration.id,
        replyId,
        intent,
        eventType,
      };

      try {
        await syncSingleIntegration(jobData);
      } catch (syncErr) {
        logger.warn(
          { syncErr, integrationId: integration.id, leadId },
          "[crm.sync] Initial sync failed — enqueuing retry"
        );
        await crmSyncQueue.add(
          `retry-${integration.id}-${leadId}`,
          jobData,
          { jobId: `crm-${integration.id}-${leadId}-${eventType}` }
        );
      }
    }
  } catch (err) {
    logger.error({ err, leadId }, "[crm.sync] syncLeadToCrm failed");
  }
}
