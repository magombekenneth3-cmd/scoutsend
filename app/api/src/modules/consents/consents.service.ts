import { prisma } from "../../lib/prisma";
import { ConsentBasis } from "@prisma/client";

export async function recordConsent(params: {
    orgId: string;
    email: string;
    domain?: string | null;
    basis: ConsentBasis;
    source: string;
    ipAddress?: string | null;
    userAgent?: string | null;
}) {
    return prisma.consentRecord.create({
        data: {
            orgId: params.orgId,
            email: params.email.toLowerCase(),
            domain: params.domain ?? null,
            basis: params.basis,
            source: params.source,
            ipAddress: params.ipAddress ?? null,
            userAgent: params.userAgent ?? null,
        },
    });
}

export async function revokeConsent(orgId: string, email: string) {
    return prisma.consentRecord.updateMany({
        where: { orgId, email: email.toLowerCase(), revokedAt: null },
        data: { revokedAt: new Date() },
    });
}

export async function getActiveConsent(orgId: string, email: string) {
    return prisma.consentRecord.findFirst({
        where: { orgId, email: email.toLowerCase(), revokedAt: null },
        orderBy: { createdAt: "desc" },
    });
}

export async function listConsents(orgId: string, page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [data, total] = await prisma.$transaction([
        prisma.consentRecord.findMany({
            where: { orgId },
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
        }),
        prisma.consentRecord.count({ where: { orgId } }),
    ]);
    return { data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
}
