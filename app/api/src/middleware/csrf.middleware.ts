import { Request, Response, NextFunction } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const EXEMPT_PATHS = new Set([
  "/auth/login",
  "/auth/register",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/verify-email",
]);


export function csrfMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  if (EXEMPT_PATHS.has(req.path)) {
    next();
    return;
  }

  if (req.headers.authorization?.startsWith("Bearer ")) {
    next();
    return;
  }
  // Primary defense: require custom header on all cookie-authenticated mutations.
  // Browsers don't send custom headers on cross-origin form submissions or
  // navigation requests, so this blocks CSRF even if Sec-Fetch-Site is spoofed.
  const csrfHeader = req.headers["x-csrf-protection"];
  if (csrfHeader === "1") {
    next();
    return;
  }

  // Fallback: Sec-Fetch-Site (browser-set, cannot be spoofed by JS)
  const secFetchSite = req.headers["sec-fetch-site"];
  if (secFetchSite && secFetchSite !== "cross-site" && secFetchSite !== "none") {
    next();
    return;
  }

  res.status(403).json({ error: "CSRF check failed. Include X-CSRF-Protection: 1 header." });
}
