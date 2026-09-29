/**
 * Sprint 1 public API barrel
 *
 * The only public entry point for state transitions and lease management.
 * All other modules MUST import from this file, not from internal modules.
 */

export {
  // Registry
  validateTransition,
  getTransitionMap,
  IllegalStateTransitionError,
  type StatefulModel,
  type CampaignRunState,
  type CampaignState,
  type OutreachMessageState,
  type SendIntentState,
  type QuotaReservationState,
  type OperationState,
  type LeadStateValue,
} from "./state-transition-registry";

export {
  // Transition engine
  transitionState,
  type TransitionParams,
  type TransitionResult,
  type TransitionMetadata,
  type TransitionAuthority,
  type FencingProof,
} from "./transition-state";

export {
  // Lease engine
  claimLease,
  renewLease,
  assertLeaseOwnership,
  createLeaseMonitor,
  type ActiveLease,
  type ClaimLeaseParams,
  type ClaimLeaseResult,
  type RenewLeaseResult,
  type LeaseMonitor,
} from "./lease.service";
