import crypto from "crypto";
import nodemailer from "nodemailer";
import { prisma } from "../../lib/prisma";
import { OrgRole } from "@prisma/client";
import { NotFoundError, ForbiddenError, ConflictError, ValidationError, ServiceUnavailableError } from "../../lib/errors";
import { logger } from "../../lib/logger";

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getSystemMailer() {
    const host = process.env.SYSTEM_SMTP_HOST;
    if (!host) {
        throw new ServiceUnavailableError("System SMTP host is not configured (SYSTEM_SMTP_HOST)");
    }
    return nodemailer.createTransport({
        host,
        port: parseInt(process.env.SYSTEM_SMTP_PORT || "587", 10),
        secure: process.env.SYSTEM_SMTP_SECURE === "true",
        auth: process.env.SYSTEM_SMTP_USER ? {
            user: process.env.SYSTEM_SMTP_USER,
            pass: process.env.SYSTEM_SMTP_PASS || "",
        } : undefined,
    });
}

export async function getOrg(orgId: string) {
    const org = await prisma.organization.findUnique({
        where: { id: orgId },
        select: { id: true, name: true, slug: true, createdAt: true, updatedAt: true },
    });
    if (!org) throw new NotFoundError("Organization");
    return org;
}

export async function updateOrg(orgId: string, requesterId: string, name: string) {
    await assertOrgAdmin(orgId, requesterId);
    return prisma.organization.update({
        where: { id: orgId },
        data: { name },
        select: { id: true, name: true, slug: true, updatedAt: true },
    });
}

export async function listMembers(orgId: string) {
    return prisma.organizationMember.findMany({
        where: { orgId },
        select: {
            id: true,
            role: true,
            joinedAt: true,
            invitedAt: true,
            user: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
        orderBy: { createdAt: "asc" },
    });
}

export async function updateMemberRole(orgId: string, requesterId: string, targetUserId: string, role: OrgRole) {
    if (role === OrgRole.OWNER) {
        throw new ValidationError("Cannot assign OWNER role via this endpoint");
    }
    await assertOrgAdmin(orgId, requesterId);

    if (targetUserId === requesterId) {
        throw new ForbiddenError();
    }

    const membership = await prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId, userId: targetUserId } },
        select: { id: true, role: true },
    });
    if (!membership) throw new NotFoundError("Member");
    if (membership.role === OrgRole.OWNER) {
        throw new ForbiddenError();
    }

    return prisma.organizationMember.update({
        where: { orgId_userId: { orgId, userId: targetUserId } },
        data: { role },
        select: { id: true, role: true },
    });
}

export async function removeMember(orgId: string, requesterId: string, targetUserId: string) {
    await assertOrgAdmin(orgId, requesterId);
    if (targetUserId === requesterId) {
        throw new ForbiddenError();
    }

    const membership = await prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId, userId: targetUserId } },
        select: { role: true },
    });
    if (!membership) throw new NotFoundError("Member");
    if (membership.role === OrgRole.OWNER) {
        throw new ForbiddenError();
    }

    await prisma.organizationMember.delete({
        where: { orgId_userId: { orgId, userId: targetUserId } },
    });
}

export async function inviteMember(orgId: string, requesterId: string, email: string, role: OrgRole) {
    await assertOrgAdmin(orgId, requesterId);

    const existingMember = await prisma.organizationMember.findFirst({
        where: { orgId, user: { email } },
        select: { id: true },
    });
    if (existingMember) {
        throw new ConflictError("User is already a member of this workspace");
    }

    const existingPending = await prisma.organizationInvitation.findFirst({
        where: { orgId, email, acceptedAt: null, expiresAt: { gt: new Date() } },
        select: { id: true },
    });
    if (existingPending) {
        throw new ConflictError("A pending invitation for this email already exists");
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);

    const [invitation, org, inviter] = await Promise.all([
        prisma.organizationInvitation.create({
            data: { orgId, email, role, token, expiresAt, invitedByUserId: requesterId },
            select: { id: true, email: true, role: true, expiresAt: true },
        }),
        prisma.organization.findUnique({ where: { id: orgId }, select: { name: true } }),
        prisma.user.findUnique({ where: { id: requesterId }, select: { firstName: true, email: true } }),
    ]);

    const inviteUrl = `${process.env.APP_URL}/auth/accept-invitation?token=${token}`;
    const from = process.env.SYSTEM_SMTP_FROM || process.env.SYSTEM_SMTP_USER!;

    try {
        const mailer = getSystemMailer();
        await mailer.sendMail({
            from,
            to: email,
            subject: `You've been invited to join ${org?.name ?? "a workspace"} on AI SDR`,
            html: `<p>Hi there,</p>
<p><strong>${inviter?.firstName ?? "A teammate"}</strong> (${inviter?.email}) has invited you to join <strong>${org?.name}</strong> as a <strong>${role}</strong>.</p>
<p><a href="${inviteUrl}" style="display:inline-block;padding:12px 24px;background:#1a1a2e;color:#fff;border-radius:6px;text-decoration:none">Accept Invitation</a></p>
<p>This invitation expires in 7 days. If you didn't expect this, you can safely ignore it.</p>`,
            text: `Hi there,\n\n${inviter?.firstName ?? "A teammate"} has invited you to join ${org?.name} as a ${role}.\n\nAccept here: ${inviteUrl}\n\nThis expires in 7 days.`,
        });
    } catch (err) {
        logger.error({ err, email, orgId }, "[organizations] Failed to send invitation email — rolling back pending invitation");
        await prisma.organizationInvitation.delete({ where: { id: invitation.id } }).catch(() => {});
        if (err instanceof ServiceUnavailableError) throw err;
        throw new ServiceUnavailableError("Failed to send invitation email. Please check your SMTP configuration and try again.");
    }

    return invitation;
}

export async function listInvitations(orgId: string) {
    return prisma.organizationInvitation.findMany({
        where: { orgId, acceptedAt: null },
        select: {
            id: true,
            email: true,
            role: true,
            expiresAt: true,
            createdAt: true,
            invitedBy: { select: { id: true, firstName: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
    });
}

export async function revokeInvitation(orgId: string, requesterId: string, invitationId: string) {
    await assertOrgAdmin(orgId, requesterId);
    const inv = await prisma.organizationInvitation.findUnique({
        where: { id: invitationId },
        select: { orgId: true },
    });
    if (!inv) throw new NotFoundError("Invitation");
    if (inv.orgId !== orgId) throw new ForbiddenError();

    await prisma.organizationInvitation.delete({ where: { id: invitationId } });
}

export async function acceptInvitation(token: string, userId: string) {
    const invitation = await prisma.organizationInvitation.findUnique({
        where: { token },
        select: { id: true, orgId: true, email: true, role: true, expiresAt: true, acceptedAt: true },
    });

    if (!invitation) throw new NotFoundError("Invitation");
    if (invitation.acceptedAt) throw new ConflictError("Invitation already accepted");
    if (invitation.expiresAt < new Date()) throw new ValidationError("Invitation has expired");

    const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true },
    });
    if (!user) throw new NotFoundError("User");
    if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
        throw new ForbiddenError();
    }

    const existingMembership = await prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId: invitation.orgId, userId } },
        select: { id: true },
    });
    if (existingMembership) {
        throw new ConflictError("You are already a member of this workspace");
    }

    const [membership] = await prisma.$transaction([
        prisma.organizationMember.create({
            data: {
                orgId: invitation.orgId,
                userId,
                role: invitation.role,
                joinedAt: new Date(),
            },
            select: { orgId: true, role: true },
        }),
        prisma.organizationInvitation.update({
            where: { id: invitation.id },
            data: { acceptedAt: new Date() },
        }),
    ]);

    return membership;
}

async function assertOrgAdmin(orgId: string, userId: string) {
    const membership = await prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId, userId } },
        select: { role: true },
    });
    if (!membership) throw new ForbiddenError();
    if (membership.role !== OrgRole.OWNER && membership.role !== OrgRole.ADMIN) {
        throw new ForbiddenError();
    }
}
