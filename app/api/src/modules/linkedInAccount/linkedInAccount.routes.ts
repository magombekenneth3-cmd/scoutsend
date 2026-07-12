import { Router } from "express";
import { authMiddleware } from "../auth/auth.middleware";
import {
    connectLinkedInAccount,
    getLinkedInAccounts,
    getLinkedInAccountById,
    deleteLinkedInAccount,
    getConnectUrl,
    syncAccounts,
} from "./linkedInAccount.controller";

const router = Router();

router.use(authMiddleware);

router.post("/connect-url", getConnectUrl);
router.post("/sync", syncAccounts);
router.post("/", connectLinkedInAccount);
router.get("/", getLinkedInAccounts);
router.get("/:id", getLinkedInAccountById);
router.delete("/:id", deleteLinkedInAccount);

export default router;
