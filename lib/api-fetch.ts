/**
 * apiFetch — authenticated fetch wrapper with structured error parsing.
 *
 * On non-2xx responses, throws an ApiError that contains:
 *   - `status`         — HTTP status code
 *   - `message`        — The server's `error` string (or a safe fallback)
 *   - `code`           — Optional machine-readable code from the API (e.g. "PAYMENT_NOT_CONFIGURED")
 *   - `correlationId`  — Optional ID from the API for support reference
 *
 * Usage:
 *   try {
 *     const res = await apiFetch("/api/...");
 *     const data = await res.json();
 *   } catch (err) {
 *     if (err instanceof ApiError) {
 *       showToast(err.message);                    // always safe, human-readable
 *       if (err.correlationId) console.error(err.correlationId);
 *     }
 *   }
 *
 * Or use the helper:
 *   const data = await apiFetchJson<MyType>("/api/...");
 */

const CSRF_HEADER = { "X-CSRF-Protection": "1" } as const;

/** Structured error thrown by apiFetch on any non-2xx response. */
export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly correlationId?: string;

  constructor(status: number, message: string, code?: string, correlationId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.correlationId = correlationId;

    // Maintains proper prototype chain in transpiled TS
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /** True for transient errors where a retry may succeed. */
  get isRetryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }

  /** True when the user is not authenticated — redirect to login. */
  get isAuthError(): boolean {
    return this.status === 401;
  }
}

/**
 * Low-level fetch wrapper. Returns the raw Response (may be non-2xx).
 * Throws ApiError only on network-level failure, not on HTTP error status.
 *
 * Use apiFetchJson() if you want automatic error parsing.
 */
export async function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const headers =
    method === "GET" || method === "HEAD" || method === "OPTIONS"
      ? init?.headers
      : { ...CSRF_HEADER, ...(init?.headers ?? {}) };

  let res: Response;
  try {
    res = await fetch(url, { ...init, credentials: "include", headers });
  } catch (networkErr) {
    // Pure network failure (offline, DNS error, etc.)
    throw new ApiError(
      0,
      "Network error — please check your connection and try again.",
      "NETWORK_ERROR",
    );
  }

  return res;
}

/**
 * Fetch + automatic error parsing.
 * Resolves to the parsed JSON body on 2xx.
 * Throws ApiError on any non-2xx, with the server's `error` message surfaced.
 */
export async function apiFetchJson<T = unknown>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await apiFetch(url, init);

  if (!res.ok) {
    let body: { error?: string; code?: string; correlationId?: string } = {};
    try {
      body = await res.json();
    } catch {
      // body isn't JSON — use a status-based fallback
    }

    const message =
      body.error ??
      statusFallback(res.status);

    throw new ApiError(res.status, message, body.code, body.correlationId);
  }

  return res.json() as Promise<T>;
}

/** Safe human-readable fallback for when the server returned no error body. */
function statusFallback(status: number): string {
  switch (true) {
    case status === 400: return "The request was invalid. Please check your inputs.";
    case status === 401: return "Your session has expired. Please sign in again.";
    case status === 403: return "You don't have permission to perform this action.";
    case status === 404: return "The requested resource was not found.";
    case status === 409: return "This action conflicts with an existing record.";
    case status === 429: return "Too many requests. Please wait a moment and try again.";
    case status >= 500 && status < 600:
      return "Something went wrong on our end. Please try again — if the issue persists, contact support.";
    default: return `Unexpected response (${status}). Please try again.`;
  }
}
