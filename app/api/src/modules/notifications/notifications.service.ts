import { prisma } from "../../lib/prisma";
import { NotFoundError } from "../../lib/errors";

export async function listNotifications(orgId: string) {
    return prisma.notification.findMany({
        where: { orgId },
        orderBy: { createdAt: "desc" },
        take: 100,
    });
}

export async function markAsRead(id: string, orgId: string) {
    const notification = await prisma.notification.findFirst({
        where: { id, orgId },
    });
    if (!notification) throw new NotFoundError("Notification");

    return prisma.notification.update({
        where: { id },
        data: { read: true },
    });
}

export async function markAllAsRead(orgId: string) {
    return prisma.notification.updateMany({
        where: { orgId, read: false },
        data: { read: true },
    });
}

export async function createNotification(orgId: string, title: string, message: string, type: "INFO" | "WARNING" | "CRITICAL") {
    return prisma.notification.create({
        data: { orgId, title, message, type },
    });
}
