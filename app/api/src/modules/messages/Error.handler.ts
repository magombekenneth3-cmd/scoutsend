import { Request, Response, NextFunction } from "express";
import { logger } from "../../lib/logger";

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof Error && err.name === "ZodError") {
    res.status(400).json({ error: "Validation error", details: (err as any).errors });
    return;
  }

  const status = (err as { statusCode?: number }).statusCode ?? 500;
  const message =
    status < 500 ? (err as Error).message : "Internal server error";

  if (status >= 500) {
    logger.error({ err }, "[errorHandler]");
  }

  res.status(status).json({ error: message });
}