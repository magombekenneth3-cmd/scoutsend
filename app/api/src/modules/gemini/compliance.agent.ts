import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { logger } from "../../lib/logger";
import {
    auditMessage as auditMessageService,
    checkUnsubscribeFooterPresent,
    checkTextSpam as checkTextSpamService,
    type ComplianceViolation,
    type ComplianceAuditResult,
} from "../../lib/compliance/compliance.service";

export type { ComplianceViolation, ComplianceAuditResult };

export interface ComplianceSummary {
    checked: number;
    blocked: number;
    warned: number;
}

export { checkUnsubscribeFooterPresent };

export function auditMessage(
    subject: string,
    body: string,
    leadCountry?: string | null,
    consentBasis?: string | null,
    unsubscribeFooter?: string | null,
): ComplianceViolation[] {
    const result = auditMessageService(subject, body, leadCountry, consentBasis, unsubscribeFooter);
    return result.violations;
}

function violationCodes(violations: ComplianceViolation[]): string[] {
    return violations.map((v) => (v.detail !== undefined ? `${v.code}:${v.detail}` : v.code));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeEnrichmentData(value: unknown): Record<string, unknown> {
    return isPlainObject(value) ? value : {};
}

function extractLeadCountry(leadEd: Record<string, unknown>): string | null {
    const country = leadEd.country;
    if (typeof country === "string" && country.trim().length > 0) return country;
    const countryCode = leadEd.countryCode;
    if (typeof countryCode === "string" && countryCode.trim().length > 0) return countryCode;
    return null;
}

export async function runComplianceAgent(campaignId: string): Promise<ComplianceSummary> {
    const approved = await prisma.outreachMessage.findMany({
        where: {
            lead: { campaignId },
            approvalStatus: "APPROVED",
            deliveryState: "QUEUED",
        },
        select: {
            id: true,
            subject: true,
            body: true,
            enrichmentData: true,
            lead: {
                select: {
                    id: true,
                    email: true,
                    enrichmentData: true,
                },
            },
        },
    });

    const leadEmails = [...new Set(approved.map((m) => m.lead?.email).filter(Boolean))] as string[];
    const consentRecords = leadEmails.length
        ? await prisma.consentRecord.findMany({
              where: { email: { in: leadEmails }, revokedAt: null },
              select: { email: true, basis: true },
          })
        : [];
    const consentMap = new Map(consentRecords.map((r) => [r.email, r.basis as string]));

    if (approved.length === 0) {
        return { checked: 0, blocked: 0, warned: 0 };
    }

    const campaign = await prisma.campaign.findUnique({
        where: { id: campaignId },
        select: { createdById: true },
    });
    if (!campaign) {
        return { checked: 0, blocked: 0, warned: 0 };
    }

    const brandSettings = await prisma.brandSettings.findUnique({
        where: { userId: campaign.createdById },
        select: { unsubscribeText: true },
    });

    const unsubscribeFooter =
        brandSettings?.unsubscribeText ??
        "You received this email because you match our ideal customer profile. To unsubscribe, reply with 'unsubscribe'.";

    type AuditRecord = {
        id: string;
        violations: ComplianceViolation[];
        existingEd: Record<string, unknown>;
        blocked: boolean;
        policyVersion: string;
    };

    const audits: AuditRecord[] = approved.map((msg) => {
        const leadEd = safeEnrichmentData(msg.lead?.enrichmentData);
        const leadCountry = extractLeadCountry(leadEd);
        const consentBasis = (msg.lead?.email ? consentMap.get(msg.lead.email) : null)
            ?? (typeof leadEd.consentBasis === "string" ? leadEd.consentBasis : null);

        const result = auditMessageService(msg.subject, msg.body, leadCountry, consentBasis, unsubscribeFooter);
        return {
            id: msg.id,
            violations: result.violations,
            existingEd: safeEnrichmentData(msg.enrichmentData),
            blocked: result.blocked,
            policyVersion: result.policyVersion,
        };
    });

    const blockedAudits = audits.filter((a) => a.blocked);
    const warnedAudits = audits.filter((a) => !a.blocked && a.violations.length > 0);

    const blockedIds = blockedAudits.map((a) => a.id);
    const CHUNK_SIZE = 50;

    if (blockedIds.length > 0) {
        try {
            await prisma.outreachMessage.updateMany({
                where: { id: { in: blockedIds }, deliveryState: "QUEUED" },
                data: { approvalStatus: "PENDING", deliveryState: "DRAFT", complianceStatus: "BLOCKED" },
            });
        } catch (err) {
            logger.error({ campaignId, err }, "[compliance.agent] Failed to flip blocked message states");
            throw err;
        }

        for (let i = 0; i < blockedAudits.length; i += CHUNK_SIZE) {
            const chunk = blockedAudits.slice(i, i + CHUNK_SIZE);
            await Promise.all(
                chunk.map((a) =>
                    prisma.outreachMessage.update({
                        where: { id: a.id },
                        data: {
                            enrichmentData: {
                                ...a.existingEd,
                                complianceViolations: violationCodes(a.violations),
                                compliancePolicyVersion: a.policyVersion,
                                complianceBlockedAt: new Date().toISOString(),
                                complianceBlockHistory: [
                                    ...(Array.isArray(a.existingEd.complianceBlockHistory)
                                        ? (a.existingEd.complianceBlockHistory as unknown[])
                                        : []),
                                    { at: new Date().toISOString(), codes: violationCodes(a.violations), policyVersion: a.policyVersion },
                                ],
                            } as Prisma.InputJsonValue,
                        },
                    }).catch((err) =>
                        logger.warn({ id: a.id, err }, "[compliance.agent] Failed to write compliance enrichmentData for blocked message")
                    ),
                ),
            );
        }
    }

    if (warnedAudits.length > 0) {
        for (let i = 0; i < warnedAudits.length; i += CHUNK_SIZE) {
            const chunk = warnedAudits.slice(i, i + CHUNK_SIZE);
            await Promise.all(
                chunk.map((a) =>
                    prisma.outreachMessage.update({
                        where: { id: a.id },
                        data: {
                            complianceStatus: "WARNED",
                            enrichmentData: {
                                ...a.existingEd,
                                complianceWarnings: violationCodes(a.violations),
                                compliancePolicyVersion: a.policyVersion,
                            } as Prisma.InputJsonValue,
                        },
                    }).catch((err) =>
                        logger.warn({ id: a.id, err }, "[compliance.agent] Failed to write compliance enrichmentData for warned message")
                    ),
                ),
            );
        }
    }


    if (blockedAudits.length > 0) {
        logger.warn(
            {
                campaignId,
                count: blockedAudits.length,
                violations: blockedAudits.map((a) => ({ id: a.id, codes: violationCodes(a.violations) })),
            },
            "[compliance.agent] Messages blocked",
        );
    }

    logger.info(
        { campaignId, checked: approved.length, blocked: blockedAudits.length, warned: warnedAudits.length },
        "[compliance.agent] Complete",
    );

    return { checked: approved.length, blocked: blockedAudits.length, warned: warnedAudits.length };
}

export function checkTextSpam(text: string): { matchesCount: number } {
    return checkTextSpamService(text);
}