import { Response } from "express";
import { AuthenticatedRequest } from "../auth/auth.types";
import { prisma } from "../../lib/prisma";
import { Prisma } from "@prisma/client";

const PAGE_SIZE = 25;

export async function getAuditLogs(
    req: AuthenticatedRequest,
    res: Response
): Promise<void> {
    const {
        page = "1",
        limit = String(PAGE_SIZE),
        search = "",
        action = "",
        entityType = "",
        userId = "",
        startDate = "",
        endDate = "",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || PAGE_SIZE));
    const skip = (pageNum - 1) * limitNum;

    const where: Prisma.AuditLogWhereInput = {};

    if (action) where.action = action;
    if (entityType) where.entityType = entityType;
    if (userId) where.userId = userId;

    if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt.gte = new Date(startDate);
        if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999);
            where.createdAt.lte = end;
        }
    }

    if (search.trim()) {
        where.OR = [
            { action: { contains: search.trim(), mode: "insensitive" } },
            { entityType: { contains: search.trim(), mode: "insensitive" } },
            { entityId: { contains: search.trim(), mode: "insensitive" } },
            {
                user: {
                    OR: [
                        { firstName: { contains: search.trim(), mode: "insensitive" } },
                        { lastName: { contains: search.trim(), mode: "insensitive" } },
                        { email: { contains: search.trim(), mode: "insensitive" } },
                    ],
                },
            },
        ];
    }

    const [total, logs] = await Promise.all([
        prisma.auditLog.count({ where }),
        prisma.auditLog.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            take: limitNum,
            include: {
                user: {
                    select: { id: true, firstName: true, lastName: true, email: true },
                },
            },
        }),
    ]);

    res.json({
        data: logs,
        meta: {
            total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.ceil(total / limitNum),
        },
    });
}