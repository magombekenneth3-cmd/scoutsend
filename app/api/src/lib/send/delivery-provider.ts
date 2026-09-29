import { logger } from "../logger";
import type { MailProvider, SendResult } from "../mail/types";

export interface DeliveryProviderCapabilities {
  nativeIdempotency: boolean;
  statusLookup: boolean;
  cancellation: boolean;
}

export type DeliveryStatus = "ACCEPTED" | "FAILED" | "UNKNOWN";

export interface DeliveryProviderResult {
  status: DeliveryStatus;
  externalMessageId?: string;
  providerError?: string;
}

export interface ReconcileInput {
  idempotencyKey: string;
  outreachMessageId: string;
  externalMessageId?: string;
}

export interface ReconcileOutput {
  status: "ACCEPTED" | "FAILED" | "UNKNOWN";
  externalMessageId?: string;
}

export interface DeliveryProvider {
  readonly type: string;
  readonly capabilities: DeliveryProviderCapabilities;
  send(params: {
    to: string;
    from: string;
    subject: string;
    html: string;
    text: string;
    inReplyTo?: string;
    references?: string;
    headers?: Record<string, string>;
  }): Promise<DeliveryProviderResult>;
  reconcile?(input: ReconcileInput): Promise<ReconcileOutput>;
}

const TIMEOUT_PATTERNS = [
  "etimedout",
  "econnreset",
  "econnrefused",
  "econnaborted",
  "socket hang up",
  "timeout",
  "network error",
  "fetch failed",
  "aborted",
];

const TRANSIENT_PATTERNS = [
  "429",
  "451",
  "4.7.",
  "rate limit",
  "quota exceeded",
  "try again later",
  "temporarily",
  "service unavailable",
  "too many connections",
];

function isTimeoutError(error: string): boolean {
  const lower = error.toLowerCase();
  return TIMEOUT_PATTERNS.some((p) => lower.includes(p));
}

function isTransientError(error: string): boolean {
  const lower = error.toLowerCase();
  return TRANSIENT_PATTERNS.some((p) => lower.includes(p));
}

function classifyProviderResult(result: SendResult): DeliveryProviderResult {
  if (result.success) {
    return {
      status: "ACCEPTED",
      externalMessageId: result.externalId,
    };
  }

  const errorMsg = result.error ?? "unknown error";

  if (isTimeoutError(errorMsg)) {
    return {
      status: "UNKNOWN",
      providerError: errorMsg,
    };
  }

  return {
    status: "FAILED",
    providerError: errorMsg,
  };
}

export function createDeliveryProvider(
  mailProvider: MailProvider,
): DeliveryProvider {
  const type = mailProvider.type;

  const capabilities: DeliveryProviderCapabilities = {
    nativeIdempotency: false,
    statusLookup: type === "GMAIL" || type === "OUTLOOK",
    cancellation: false,
  };

  return {
    type,
    capabilities,

    async send(params): Promise<DeliveryProviderResult> {
      try {
        const result = await mailProvider.sendEmail({
          to: params.to,
          from: params.from,
          subject: params.subject,
          html: params.html,
          text: params.text,
          inReplyTo: params.inReplyTo,
          references: params.references,
          headers: params.headers,
        });

        return classifyProviderResult(result);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);

        if (isTimeoutError(errorMsg)) {
          logger.warn(
            { type, error: errorMsg },
            "[delivery-provider] Timeout/network error — status UNKNOWN",
          );
          return { status: "UNKNOWN", providerError: errorMsg };
        }

        if (isTransientError(errorMsg)) {
          logger.warn(
            { type, error: errorMsg },
            "[delivery-provider] Transient error — status FAILED (retryable)",
          );
          return { status: "FAILED", providerError: errorMsg };
        }

        logger.error(
          { type, error: errorMsg },
          "[delivery-provider] Provider error — status FAILED",
        );
        return { status: "FAILED", providerError: errorMsg };
      }
    },
  };
}
