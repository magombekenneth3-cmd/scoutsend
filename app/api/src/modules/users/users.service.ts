import { UserRole } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import bcrypt from "bcryptjs";

export async function listUsers(query: {
    search?: string;
    role?: UserRole;
    page: number;
    limit: number;
}) {
    const { search, role, page, limit } = query;
    const skip = (page - 1) * limit;

    const where = {
        ...(role ? { role } : {}),
        ...(search
            ? {
                OR: [
                    { email: { contains: search, mode: "insensitive" as const } },
                    { firstName: { contains: search, mode: "insensitive" as const } },
                    { lastName: { contains: search, mode: "insensitive" as const } },
                ],
            }
            : {}),
    };

    const [users, total] = await Promise.all([
        prisma.user.findMany({
            where,
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                role: true,
                createdAt: true,
                updatedAt: true,
            },
            skip,
            take: limit,
            orderBy: { createdAt: "desc" },
        }),
        prisma.user.count({ where }),
    ]);

    return {
        data: users,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
}

export async function getUserStats() {
    const byRole = await prisma.user.groupBy({
        by: ["role"],
        _count: { id: true },
    });

    const roleMap = Object.fromEntries(byRole.map((r) => [r.role, r._count.id]));
    const total = byRole.reduce((s, r) => s + r._count.id, 0);

    return {
        total,
        admins: roleMap["ADMIN"] ?? 0,
        operators: roleMap["OPERATOR"] ?? 0,
        reviewers: roleMap["REVIEWER"] ?? 0,
    };
}

export async function updateUserRole(id: string, role: UserRole, requesterId: string) {
    if (id === requesterId) {
        throw Object.assign(new Error("Cannot change your own role"), { statusCode: 403 });
    }

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) throw Object.assign(new Error("User not found"), { statusCode: 404 });

    return prisma.user.update({
        where: { id },
        data: { role },
        select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            createdAt: true,
            updatedAt: true,
        },
    });
}

export async function forceLogoutUser(id: string, requesterId: string) {
    if (id === requesterId) {
        throw Object.assign(new Error("Cannot force-logout yourself"), { statusCode: 403 });
    }

    const target = await prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!target) throw Object.assign(new Error("User not found"), { statusCode: 404 });

    return prisma.user.update({
        where: { id },
        data: { tokenVersion: { increment: 1 } },
        select: { id: true },
    });
}

export async function updateProfile(
    userId: string,
    data: { firstName?: string; lastName?: string; currentPassword?: string; newPassword?: string }
) {
    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, passwordHash: true },
    });
    if (!user) throw Object.assign(new Error("User not found"), { statusCode: 404 });

    if (data.newPassword) {
        if (!data.currentPassword) {
            throw Object.assign(new Error("Current password is required to set a new password"), { statusCode: 400 });
        }
        const valid = await bcrypt.compare(data.currentPassword, user.passwordHash ?? "");
        if (!valid) {
            throw Object.assign(new Error("Current password is incorrect"), { statusCode: 401 });
        }
    }

    const updateData: Record<string, unknown> = {};
    if (data.firstName !== undefined) updateData.firstName = data.firstName.trim();
    if (data.lastName !== undefined) updateData.lastName = data.lastName.trim();
    if (data.newPassword) {
        updateData.passwordHash = await bcrypt.hash(data.newPassword, 12);
    }

    return prisma.user.update({
        where: { id: userId },
        data: updateData,
        select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            createdAt: true,
            updatedAt: true,
        },
    });
}