import { randomUUID } from "crypto";

export interface EventIdentity {
  eventId: string;
  operationId: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
}

export function buildOperationId(type: string, ...parts: string[]): string {
  return `${type}:${parts.join(":")}`;
}

export function buildEventId(): string {
  return randomUUID();
}
