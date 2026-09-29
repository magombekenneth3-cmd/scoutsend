/**
 * Emergency Dispatch Kill Switch Service (Sprint 12)
 *
 * Implements deterministic kill switch evaluation with boolean OR precedence:
 *   effectiveKillSwitch = GLOBAL || ORGANIZATION || PROVIDER || MAILBOX || CAMPAIGN
 *
 * INVARIANT: Kill switches gate NEW dispatches at authorization AND inside outbox dispatcher
 * right before external provider calls. Rejection defers/blocks dispatch without altering history.
 */

export type KillSwitchScope = "GLOBAL" | "ORGANIZATION" | "PROVIDER" | "MAILBOX" | "CAMPAIGN";

export interface KillSwitchCheckParams {
  organizationId?: string;
  providerName?: string;
  mailboxId?: string;
  campaignId?: string;
}

const activeKillSwitches = new Set<string>();

export function setKillSwitch(scope: KillSwitchScope, targetId: string | "ALL", enabled: boolean): void {
  const key = `${scope}:${targetId}`;
  if (enabled) {
    activeKillSwitches.add(key);
  } else {
    activeKillSwitches.delete(key);
  }
}

export function isKillSwitchActive(params: KillSwitchCheckParams): { blocked: boolean; activeScope?: KillSwitchScope } {
  if (activeKillSwitches.has("GLOBAL:ALL")) {
    return { blocked: true, activeScope: "GLOBAL" };
  }

  if (params.organizationId && activeKillSwitches.has(`ORGANIZATION:${params.organizationId}`)) {
    return { blocked: true, activeScope: "ORGANIZATION" };
  }

  if (params.providerName && activeKillSwitches.has(`PROVIDER:${params.providerName}`)) {
    return { blocked: true, activeScope: "PROVIDER" };
  }

  if (params.mailboxId && activeKillSwitches.has(`MAILBOX:${params.mailboxId}`)) {
    return { blocked: true, activeScope: "MAILBOX" };
  }

  if (params.campaignId && activeKillSwitches.has(`CAMPAIGN:${params.campaignId}`)) {
    return { blocked: true, activeScope: "CAMPAIGN" };
  }

  return { blocked: false };
}
