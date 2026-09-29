import { Response } from "express";
import { AuthenticatedRequest } from "../auth/auth.types";
import {
    getOrg,
    updateOrg,
    listMembers,
    updateMemberRole,
    removeMember,
    inviteMember,
    listInvitations,
    revokeInvitation,
    acceptInvitation,
} from "./organizations.service";
import {
    updateOrgSchema,
    inviteMemberSchema,
    updateMemberRoleSchema,
    acceptInvitationSchema,
} from "./organizations.schema";
import { OrgRole } from "@prisma/client";

export async function getOrgHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
    const orgId = req.user!.orgId!;
    const org = await getOrg(orgId);
    res.json(org);
}

export async function updateOrgHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { name } = updateOrgSchema.parse(req.body);
    const org = await updateOrg(req.user!.orgId!, req.user!.userId, name);
    res.json(org);
}

export async function listMembersHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
    const members = await listMembers(req.user!.orgId!);
    res.json(members);
}

export async function updateMemberRoleHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { userId } = req.params as { userId: string };
    const { role } = updateMemberRoleSchema.parse(req.body);
    const updated = await updateMemberRole(req.user!.orgId!, req.user!.userId, userId, role);
    res.json(updated);
}

export async function removeMemberHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { userId } = req.params as { userId: string };
    await removeMember(req.user!.orgId!, req.user!.userId, userId);
    res.status(204).end();
}

export async function inviteMemberHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { email, role } = inviteMemberSchema.parse(req.body);
    const invitation = await inviteMember(req.user!.orgId!, req.user!.userId, email, role);
    res.status(201).json(invitation);
}

export async function listInvitationsHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
    const invitations = await listInvitations(req.user!.orgId!);
    res.json(invitations);
}

export async function revokeInvitationHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { id } = req.params as { id: string };
    await revokeInvitation(req.user!.orgId!, req.user!.userId, id);
    res.status(204).end();
}

export async function acceptInvitationHandler(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { token } = acceptInvitationSchema.parse(req.body);
    const membership = await acceptInvitation(token, req.user!.userId);
    res.json(membership);
}
