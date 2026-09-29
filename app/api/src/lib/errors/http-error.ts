/**
 * HttpError — typed HTTP error class compatible with the global Express errorHandler.
 *
 * Usage:
 *   // 4xx — message is passed through to the client automatically
 *   throw new HttpError(404, "Lead not found");
 *   throw new HttpError(403, "You don't have permission to access this resource.");
 *
 *   // 5xx with user-visible guidance (use userMessage to avoid leaking internals)
 *   throw new HttpError(503, "stripe-lib error: invalid key", "SERVICE_UNAVAILABLE",
 *     "Payment processing is temporarily unavailable. Please try again in a moment.");
 *
 *   // Config-missing (operationally expected, admin-actionable)
 *   throw new HttpError(503, "STRIPE_WEBHOOK_SECRET not set", "PAYMENT_NOT_CONFIGURED",
 *     "Payment processing is not configured. Please contact your administrator.");
 *
 * The global errorHandler:
 *   - Always shows `userMessage` when present (even on 5xx), because it was explicitly
 *     written to be safe for end users.
 *   - Falls back to `message` for 4xx (always safe).
 *   - Falls back to a generic classified message for unknown 5xx.
 */

function httpCodeName(status: number): string {
  const map: Record<number, string> = {
    400: "BAD_REQUEST",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    422: "UNPROCESSABLE_ENTITY",
    429: "RATE_LIMITED",
    500: "INTERNAL_SERVER_ERROR",
    502: "BAD_GATEWAY",
    503: "SERVICE_UNAVAILABLE",
    504: "GATEWAY_TIMEOUT",
  };
  return map[status] ?? "UNKNOWN";
}

export class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;
  /** Safe user-facing message. Present means: always show this, even on 5xx. */
  readonly userMessage?: string;

  constructor(statusCode: number, message: string, code?: string, userMessage?: string) {
    super(message);
    this.name = "HttpError";
    this.statusCode = statusCode;
    this.code = code ?? httpCodeName(statusCode);
    this.userMessage = userMessage;

    // Maintains proper prototype chain in transpiled TS
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
