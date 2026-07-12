import { prisma } from "../../lib/prisma";
import { NotFoundError, ForbiddenError } from "../../lib/errors";
import { z } from "zod";
import {
    connectLinkedInAccountSchema,
    getLinkedInAccountsQuerySchema,
} from "./linkedInAccount.schema";

export async function connectLinkedInAccount(
    data: z.infer<typeof connectLinkedInAccountSchema>,
    createdById: string
) {
    const existing = await prisma.linkedInAccount.findUnique({
        where: { accountId: data.accountId },
    });

    if (existing) {
        if (existing.createdById !== createdById) {
            throw new ForbiddenError();
        }
        return prisma.linkedInAccount.update({
            where: { accountId: data.accountId },
            data: {
                name: data.name,
                avatarUrl: data.avatarUrl ?? null,
                profileUrl: data.profileUrl ?? null,
            },
        });
    }

    return prisma.linkedInAccount.create({
        data: {
            accountId: data.accountId,
            name: data.name,
            avatarUrl: data.avatarUrl ?? null,
            profileUrl: data.profileUrl ?? null,
            createdById,
        },
    });
}

export async function getLinkedInAccounts(
    query: z.infer<typeof getLinkedInAccountsQuerySchema>,
    createdById: string
) {
    const { page, limit } = query;
    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
        prisma.linkedInAccount.findMany({
            where: { createdById },
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
            select: {
                id: true,
                accountId: true,
                name: true,
                avatarUrl: true,
                profileUrl: true,
                createdAt: true,
                updatedAt: true,
            },
        }),
        prisma.linkedInAccount.count({ where: { createdById } }),
    ]);

    return { items, total, page, limit };
}

export async function getLinkedInAccountById(id: string, createdById: string) {
    return prisma.linkedInAccount.findFirst({
        where: { id, createdById },
        select: {
            id: true,
            accountId: true,
            name: true,
            avatarUrl: true,
            profileUrl: true,
            createdAt: true,
            updatedAt: true,
        },
    });
}

export async function deleteLinkedInAccount(id: string, createdById: string) {
    const account = await prisma.linkedInAccount.findFirst({
        where: { id, createdById },
        select: { id: true },
    });

    if (!account) {
        const exists = await prisma.linkedInAccount.findUnique({
            where: { id },
            select: { id: true },
        });
        if (exists) throw new ForbiddenError();
        throw new NotFoundError("LinkedIn account");
    }

    await prisma.$transaction(async (tx) => {
        await tx.campaign.updateMany({
            where: { linkedInAccountId: id, createdById },
            data: { linkedInAccountId: null },
        });
        await tx.linkedInAccount.delete({ where: { id } });
    });
}

export async function getUnipileConnectUrl(createdById: string): Promise<{ url: string }> {
    const baseUrl = process.env.UNIPILE_BASE_URL?.trim();
    const apiKey = process.env.UNIPILE_API_KEY?.trim();
    const appUrl = process.env.APP_URL?.trim();

    if (!baseUrl || !apiKey || !appUrl) {
        throw new Error("Unipile integration not configured");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    let res: Response;
    try {
        res = await fetch(`${baseUrl}/api/v1/hosted/accounts/link`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-API-KEY": apiKey,
            },
            body: JSON.stringify({
                type: "create",
                providers_filters: { categories: ["LINKEDIN"] },
                api_url: `${process.env.INTERNAL_API_URL ?? "http://localhost:8080"}`,
                success_redirect_url: `${appUrl}/settings/accounts?linkedin=connected`,
                failure_redirect_url: `${appUrl}/settings/accounts?linkedin=failed`,
                notify_url: `${process.env.INTERNAL_API_URL ?? "http://localhost:8080"}/webhooks/unipile`,
                expiresOn: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
            }),
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }

    if (!res.ok) {
        const text = await res.text().catch(() => "<unreadable>");
        throw new Error(`Unipile connect failed: ${res.status} ${text}`);
    }

    const body = await res.json() as { object?: string; url?: string };

    if (!body.url) {
        throw new Error("Unipile did not return a connect URL");
    }

    return { url: body.url };
}

export async function syncUnipileAccounts(createdById: string) {
    const baseUrl = process.env.UNIPILE_BASE_URL?.trim();
    const apiKey = process.env.UNIPILE_API_KEY?.trim();

    if (!baseUrl || !apiKey) {
        throw new Error("Unipile integration not configured");
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);

    let res: Response;
    try {
        res = await fetch(`${baseUrl}/api/v1/accounts`, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                "X-API-KEY": apiKey,
            },
            signal: controller.signal,
        });
    } finally {
        clearTimeout(timer);
    }

    if (!res.ok) {
        const text = await res.text().catch(() => "<unreadable>");
        throw new Error(`Unipile accounts sync failed: ${res.status} ${text}`);
    }

    const body = await res.json() as { items?: Array<{ id: string; name: string; type: string }> };
    const linkedInItems = (body.items ?? []).filter(
        (item) => item.type?.toUpperCase() === "LINKEDIN"
    );

    const upserted = await Promise.all(
        linkedInItems.map((item) =>
            prisma.linkedInAccount.upsert({
                where: { accountId: item.id },
                update: { name: item.name },
                create: {
                    accountId: item.id,
                    name: item.name,
                    createdById,
                },
                select: {
                    id: true,
                    accountId: true,
                    name: true,
                    avatarUrl: true,
                    profileUrl: true,
                    createdAt: true,
                    updatedAt: true,
                },
            })
        )
    );

    return { synced: upserted.length, accounts: upserted };
}
