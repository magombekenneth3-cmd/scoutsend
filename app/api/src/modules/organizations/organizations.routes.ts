import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import { requireOrgAdmin, requireAnyOrgRole, requireOrgMembership } from "../auth/auth.org.middleware";
import {
    getOrgHandler,
    updateOrgHandler,
    listMembersHandler,
    updateMemberRoleHandler,
    removeMemberHandler,
    inviteMemberHandler,
    listInvitationsHandler,
    revokeInvitationHandler,
    acceptInvitationHandler,
} from "./organizations.controller";

const router = Router();

router.use(authMiddleware);

router.get("/me", requireOrgMembership, getOrgHandler);
router.patch("/me", requireOrgAdmin, updateOrgHandler);

router.get("/me/members", requireAnyOrgRole, listMembersHandler);
router.patch("/me/members/:userId", requireOrgAdmin, updateMemberRoleHandler);
router.delete("/me/members/:userId", requireOrgAdmin, removeMemberHandler);

router.post("/me/invitations", requireOrgAdmin, inviteMemberHandler);
router.get("/me/invitations", requireOrgAdmin, listInvitationsHandler);
router.delete("/me/invitations/:id", requireOrgAdmin, revokeInvitationHandler);

router.post("/invitations/accept", acceptInvitationHandler);

export default router;
