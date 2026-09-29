/**
 * Provider Capabilities & Evidence Registry (Sprint 12)
 *
 * Defines explicit provider capabilities, lookup consistency models,
 * and reconciliation modes to prevent false certainty during recovery.
 */

export interface ProviderCapabilities {
  supportsIdempotencyKey: boolean;
  supportsMessageLookup: boolean;
  supportsDeliveryStatus: boolean;
  supportsCancellation: boolean;

  idempotencyScope?: "REQUEST" | "MESSAGE" | "ACCOUNT";
  lookupConsistency?: "STRONG" | "EVENTUAL" | "UNKNOWN";

  maxIdempotencyKeyAgeMs?: number;

  reconciliationMode:
    | "IDEMPOTENCY_LOOKUP"
    | "MESSAGE_LOOKUP"
    | "DELIVERY_LOOKUP"
    | "MANUAL_ONLY";
}

export const PROVIDER_CAPABILITIES_REGISTRY: Record<string, ProviderCapabilities> = {
  RESEND: {
    supportsIdempotencyKey: true,
    supportsMessageLookup: true,
    supportsDeliveryStatus: true,
    supportsCancellation: false,
    idempotencyScope: "REQUEST",
    lookupConsistency: "STRONG",
    maxIdempotencyKeyAgeMs: 86400000,
    reconciliationMode: "MESSAGE_LOOKUP",
  },
  SMTP: {
    supportsIdempotencyKey: false,
    supportsMessageLookup: false,
    supportsDeliveryStatus: false,
    supportsCancellation: false,
    idempotencyScope: "REQUEST",
    lookupConsistency: "UNKNOWN",
    reconciliationMode: "MANUAL_ONLY",
  },
  GMAIL_API: {
    supportsIdempotencyKey: true,
    supportsMessageLookup: true,
    supportsDeliveryStatus: true,
    supportsCancellation: false,
    idempotencyScope: "MESSAGE",
    lookupConsistency: "EVENTUAL",
    reconciliationMode: "MESSAGE_LOOKUP",
  },
  LINKEDIN_API: {
    supportsIdempotencyKey: true,
    supportsMessageLookup: false,
    supportsDeliveryStatus: false,
    supportsCancellation: false,
    idempotencyScope: "ACCOUNT",
    lookupConsistency: "EVENTUAL",
    reconciliationMode: "MANUAL_ONLY",
  },
};

export function getProviderCapabilities(providerName: string): ProviderCapabilities {
  return (
    PROVIDER_CAPABILITIES_REGISTRY[providerName.toUpperCase()] ?? {
      supportsIdempotencyKey: false,
      supportsMessageLookup: false,
      supportsDeliveryStatus: false,
      supportsCancellation: false,
      lookupConsistency: "UNKNOWN",
      reconciliationMode: "MANUAL_ONLY",
    }
  );
}
