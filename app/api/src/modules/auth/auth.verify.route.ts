import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { isTokenBlacklisted } from "./auth.service";

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET!;

router.post("/verify-token", async (req: Request, res: Response) => {
    const { jti } = req.body as { jti?: string };
    if (!jti) {
        res.json({ valid: false });
        return;
    }
    try {
        const blacklisted = await isTokenBlacklisted(jti);
        res.json({ valid: !blacklisted });
    } catch {
        res.json({ valid: false });
    }
});

export default router;
