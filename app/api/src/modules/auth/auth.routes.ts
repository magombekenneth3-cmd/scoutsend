import { Router } from "express";
import {
    login,
    register,
    me,
    logout,
    forgotPasswordHandler,
    resetPasswordHandler,
    verifyEmailHandler,
    resendVerificationHandler,
    refresh,
} from "./auth.controller";
import { authMiddleware } from "./auth.middleware";

const router = Router();

router.post("/register", register);
router.post("/login", login);
router.post("/refresh", refresh);
router.post("/forgot-password", forgotPasswordHandler);
router.post("/reset-password", resetPasswordHandler);
router.post("/verify-email", verifyEmailHandler);
router.post("/resend-verification", authMiddleware, resendVerificationHandler);

router.get("/me", authMiddleware, me);
router.post("/logout", authMiddleware, logout);

export default router;