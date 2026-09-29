import z from "zod";
import { OrgRole } from "@prisma/client";

export const updateOrgSchema = z.object({
    name: z.string().min(2).max(80),
});

export const inviteMemberSchema = z.object({
    email: z.string().email(),
    role: z.nativeEnum(OrgRole).exclude(["OWNER"]),
});

export const updateMemberRoleSchema = z.object({
    role: z.nativeEnum(OrgRole).exclude(["OWNER"]),
});

export const acceptInvitationSchema = z.object({
    token: z.string().min(1),
});
