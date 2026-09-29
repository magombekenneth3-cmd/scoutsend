import { createHash } from "crypto";

export function buildSignalIndependenceKey(params: {
  sourceSystem: string;
  sourceEntityId?: string;
  signalType: string;
}): string {
  const parts = [
    params.sourceSystem.trim().toLowerCase(),
    params.signalType.trim().toLowerCase(),
  ];
  if (params.sourceEntityId) {
    parts.push(params.sourceEntityId.trim().toLowerCase());
  }
  return parts.join(":");
}

export function normalizeSignalValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildSignalSourceId(sourceSystem: string, entityId: string): string {
  return `${sourceSystem.trim().toLowerCase()}:${entityId.trim()}`;
}

export function hashSignalIdentity(params: {
  leadId: string;
  signalType: string;
  value: string;
  sourceSystem: string;
  sourceEntityId?: string;
}): string {
  const canonical = [
    params.leadId,
    params.signalType.trim().toLowerCase(),
    normalizeSignalValue(params.value),
    params.sourceSystem.trim().toLowerCase(),
    params.sourceEntityId?.trim() ?? "",
  ].join("|");

  return createHash("sha256").update(canonical).digest("hex").slice(0, 32);
}
