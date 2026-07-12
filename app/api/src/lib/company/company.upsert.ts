import { PrismaClient, SignalType } from "@prisma/client";
import { prisma } from "../prisma";

type PrismaTx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

const VALID_SIGNAL_TYPES = new Set<string>(Object.values(SignalType));

export function extractDomain(website?: string | null): string | null {
    if (!website) return null;
    try {
        const url = new URL(
            website.startsWith("http") ? website : `https://${website}`,
        );
        return url.hostname.replace(/^www\./, "").toLowerCase();
    } catch {
        return null;
    }
}

export async function upsertCompany(
    params: {
        name: string;
        website?: string | null;
        linkedinUrl?: string | null;
    },
    tx?: PrismaTx,
): Promise<string> {
    const db = tx ?? prisma;
    const domain = extractDomain(params.website);

    if (domain) {
        const existing = await db.company.findUnique({ where: { domain } });
        if (existing) {
            if (params.linkedinUrl && !existing.linkedinUrl) {
                await db.company.update({
                    where: { id: existing.id },
                    data: { linkedinUrl: params.linkedinUrl },
                });
            }
            return existing.id;
        }
    }

    const byName = await db.company.findFirst({
        where: { name: { equals: params.name.trim(), mode: "insensitive" } },
    });

    if (byName) {
        const domainsConflict = domain && byName.domain && byName.domain !== domain;
        if (!domainsConflict) {
            if (domain && !byName.domain) {
                await db.company.updateMany({
                    where: { id: byName.id, domain: null },
                    data: {
                        domain,
                        ...(params.linkedinUrl ? { linkedinUrl: params.linkedinUrl } : {}),
                    },
                });
            }
            return byName.id;
        }
    }

    try {
        const company = await db.company.create({
            data: {
                name: params.name.trim(),
                ...(domain ? { domain } : {}),
                ...(params.linkedinUrl ? { linkedinUrl: params.linkedinUrl } : {}),
            },
        });
        return company.id;
    } catch (err: unknown) {
        const prismaError = err as { code?: string };
        if (prismaError.code === "P2002") {
            const recovered = await db.company.findFirst({
                where: {
                    ...(domain
                        ? { domain }
                        : { name: { equals: params.name.trim(), mode: "insensitive" } }),
                },
            });
            if (recovered) return recovered.id;
        }
        throw err;
    }
}

export async function upsertCompanySignal(
    params: {
        companyId: string;
        signalType: string;
        value: string;
        confidence: number;
        source?: string;
        explanation?: string;
    },
    tx?: PrismaTx,
): Promise<{ isNew: boolean }> {
    if (!VALID_SIGNAL_TYPES.has(params.signalType)) return { isNew: false };

    const db = tx ?? prisma;
    const signalType = params.signalType as SignalType;

    try {
        await db.companySignal.create({
            data: {
                companyId: params.companyId,
                signalType,
                value: params.value,
                confidence: params.confidence,
                source: params.source,
                explanation: params.explanation,
            },
        });
        return { isNew: true };
    } catch (err: unknown) {
        const prismaError = err as { code?: string };
        if (prismaError.code === "P2002") {
            await db.companySignal.updateMany({
                where: {
                    companyId: params.companyId,
                    signalType,
                    value: params.value,
                },
                data: { confidence: params.confidence },
            });
            return { isNew: false };
        }
        throw err;
    }
}

export function normaliseCompanyName(name: string): string {
    return name
        .toLowerCase()
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, "")
        .replace(/\b(inc|llc|ltd|limited|corp|corporation|co|company|group|holdings|ventures|technologies|tech|plc|gmbh|ag|bv)\b/g, "")
        .replace(/\s+/g, " ")
        .trim();
}