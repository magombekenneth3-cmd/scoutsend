import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { logger } from "../../lib/logger";
import { HttpError } from "../../lib/errors/http-error";

// ─── Prisma error → user message ──────────────────────────────────────────────
// Maps Prisma client error codes to safe, actionable user messages.
// Prisma Known Request Errors: https://www.prisma.io/docs/orm/reference/error-reference
const PRISMA_CODE_STATUS: Record<string, { status: number; message: string }> = {
  P2000: { status: 400, message: "A value you provided is too long for this field." },
  P2001: { status: 404, message: "The requested record does not exist." },
  P2002: { status: 409, message: "This record already exists. Please check for duplicates." },
  P2003: { status: 409, message: "This action is blocked by a related record. Remove the dependency first." },
  P2004: { status: 409, message: "A database constraint was violated." },
  P2005: { status: 400, message: "A value you provided is invalid for its field type." },
  P2006: { status: 400, message: "A provided value is not valid." },
  P2011: { status: 400, message: "A required field is missing a value." },
  P2012: { status: 400, message: "A required field is missing." },
  P2014: { status: 409, message: "This change would break a required relationship between records." },
  P2015: { status: 404, message: "A related record could not be found." },
  P2025: { status: 404, message: "The requested record was not found or you don't have access." },
};

// ─── Connection/network error detection ───────────────────────────────────────
const CONNECTION_ERROR_CODES = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EHOSTUNREACH",
  "ECONNABORTED", "ENETUNREACH",
]);

function isNetworkError(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return typeof code === "string" && CONNECTION_ERROR_CODES.has(code);
}

function isPrismaConnectionError(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError ||
    (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === "P1001" || err.code === "P1002"))
  );
}

// ─── Generic 5xx guidance by HTTP status ──────────────────────────────────────
function genericMessageForStatus(status: number): string {
  switch (status) {
    case 501:
      return "This feature is not yet available.";
    case 502:
      return "An upstream service returned an unexpected response. Please try again in a moment.";
    case 503:
      return "This service is temporarily unavailable. Please try again in a few minutes.";
    case 504:
      return "The request timed out. Please try again — if the problem persists, contact support.";
    default:
      return "Something went wrong on our end. Please try again — if the issue persists, contact support.";
  }
}

// ─── Main error handler ───────────────────────────────────────────────────────
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {

  // ── Zod validation errors (always 400, always safe to show) ──
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Validation error", details: err.issues });
    return;
  }

  // ── Prisma connection errors (DB is down / misconfigured) ──
  if (isPrismaConnectionError(err)) {
    logger.error({ err }, "[errorHandler] Database connection error");
    const correlationId = res.getHeader("X-Correlation-ID") as string | undefined;
    res.status(503).json({
      error: "The database is temporarily unavailable. Please try again in a moment.",
      ...(correlationId ? { correlationId } : {}),
    });
    return;
  }

  // ── Prisma known request errors (constraint violations, not found, etc.) ──
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const mapped = PRISMA_CODE_STATUS[err.code];
    if (mapped) {
      // Sub-500: no need to log as error (these are expected application states)
      if (mapped.status >= 500) logger.error({ err }, "[errorHandler] Prisma error");
      const correlationId = res.getHeader("X-Correlation-ID") as string | undefined;
      res.status(mapped.status).json({
        error: mapped.message,
        code: err.code,
        ...(correlationId ? { correlationId } : {}),
      });
      return;
    }
    // Unknown Prisma code — log and fall through to generic 500
    logger.error({ err, prismaCode: err.code }, "[errorHandler] Unknown Prisma error code");
  }

  // ── Network / connectivity errors ──
  if (isNetworkError(err)) {
    logger.error({ err }, "[errorHandler] Network error");
    const correlationId = res.getHeader("X-Correlation-ID") as string | undefined;
    res.status(503).json({
      error: "A required service is temporarily unreachable. Please check your connection or try again in a moment.",
      ...(correlationId ? { correlationId } : {}),
    });
    return;
  }

  // ── Our own HttpError (typed, thrown intentionally by route/service code) ──
  if (err instanceof HttpError) {
    const status = err.statusCode;
    // userMessage is always safe to show (explicitly crafted for users).
    // For 4xx without userMessage, the regular message is also safe.
    // For 5xx without userMessage, use the generic status-based guidance.
    const userFacingMessage =
      err.userMessage ??
      (status < 500 ? err.message : genericMessageForStatus(status));

    if (status >= 500) {
      logger.error({ err }, "[errorHandler]");
    }

    const correlationId = res.getHeader("X-Correlation-ID") as string | undefined;
    res.status(status).json({
      error: userFacingMessage,
      code: err.code,
      ...(correlationId ? { correlationId } : {}),
    });
    return;
  }

  // ── Plain Error or unknown throw ──
  const status = (err as { statusCode?: number; status?: number }).statusCode
    ?? (err as { statusCode?: number; status?: number }).status
    ?? 500;

  if (status >= 500) {
    logger.error({ err }, "[errorHandler]");
  }

  const userFacingMessage =
    status < 500
      ? (err as Error).message
      : genericMessageForStatus(status);

  const correlationId = res.getHeader("X-Correlation-ID") as string | undefined;
  res.status(status).json({
    error: userFacingMessage,
    ...(correlationId ? { correlationId } : {}),
  });
}