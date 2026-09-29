import type { WarmupState } from "../warmup/warmup-types.js";

/**
 * StateTransitionRegistry
 *
 * The single authoritative definition of all legal state machine transitions
 * in this system. Every model mutation that changes `status` MUST pass through
 * this registry before touching the DB.
 *
 * Covered state machines (8):
 *   1. CampaignRun
 *   2. Campaign
 *   3. OutreachMessage
 *   4. SendIntent
 *   5. SendQuotaReservation (QuotaReservation)
 *   6. Operation
 *   7. Lead
 *   8. Company  (version-only, no status machine yet — placeholder)
 */

// ---------------------------------------------------------------------------
// 1. CampaignRun
// ---------------------------------------------------------------------------
export type CampaignRunState =
  | "CREATED"
  | "RUNNING"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED"
  | "RECOVERING";

const CAMPAIGN_RUN_TRANSITIONS: Record<CampaignRunState, CampaignRunState[]> = {
  CREATED:    ["RUNNING"],
  RUNNING:    ["PAUSED", "COMPLETED", "FAILED"],
  PAUSED:     ["RUNNING", "COMPLETED"],
  COMPLETED:  [],
  FAILED:     ["RECOVERING"],
  RECOVERING: ["RUNNING", "FAILED"],
};

// ---------------------------------------------------------------------------
// 2. Campaign (top-level lifecycle)
// ---------------------------------------------------------------------------
export type CampaignState =
  | "DRAFT"
  | "RESEARCHING"
  | "GENERATING"
  | "REVIEW"
  | "QUEUED"
  | "SENDING"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED";

const CAMPAIGN_TRANSITIONS: Record<CampaignState, CampaignState[]> = {
  DRAFT:       ["RESEARCHING", "CANCELED"],
  RESEARCHING: ["GENERATING", "FAILED", "CANCELED"],
  GENERATING:  ["REVIEW", "FAILED", "CANCELED"],
  REVIEW:      ["QUEUED", "GENERATING", "CANCELED"],
  QUEUED:      ["SENDING", "PAUSED", "CANCELED"],
  SENDING:     ["PAUSED", "COMPLETED", "FAILED", "CANCELED"],
  PAUSED:      ["SENDING", "COMPLETED", "CANCELED"],
  COMPLETED:   [],
  FAILED:      ["QUEUED", "CANCELED"],
  CANCELED:    [],
};

// ---------------------------------------------------------------------------
// 3. OutreachMessage
// ---------------------------------------------------------------------------
export type OutreachMessageState =
  | "DRAFT"
  | "VALIDATED"
  | "AUTHORIZED"
  | "DISPATCHING"
  | "QUEUED"
  | "SENT"
  | "BLOCKED"
  | "CANCELLED"
  | "SENDING"
  | "SUPPRESSED";

const OUTREACH_MESSAGE_TRANSITIONS: Record<
  OutreachMessageState,
  OutreachMessageState[]
> = {
  DRAFT:       ["VALIDATED", "BLOCKED", "CANCELLED", "SUPPRESSED"],
  VALIDATED:   ["AUTHORIZED", "CANCELLED", "SUPPRESSED"],
  AUTHORIZED:  ["DISPATCHING", "CANCELLED", "SUPPRESSED"],
  DISPATCHING: ["SENT", "BLOCKED", "CANCELLED", "SUPPRESSED"],
  QUEUED:      ["SENT", "BLOCKED", "CANCELLED", "SUPPRESSED"],
  SENT:        [],
  BLOCKED:     [],
  CANCELLED:   [],
  // SENDING is the transient worker-claim state written by send.agent.ts via FOR UPDATE SKIP LOCKED.
  // Legal exits via transitionState: QUEUED (requeue on lease expiry / circuit breaker / pause)
  //                                  SENT   (successful delivery confirmation via reconciler)
  // All other SENDING exits (SUPPRESSED, FAILED) are raw Prisma writes that bypass transitionState.
  SENDING:     ["QUEUED", "SENT"],
  SUPPRESSED:  [],
};

// ---------------------------------------------------------------------------
// 4. SendIntent
// ---------------------------------------------------------------------------
export type SendIntentState =
  | "PENDING"
  | "DISPATCHING"
  | "ACCEPTED"
  | "SENT"
  | "FAILED"
  | "UNKNOWN"
  | "RECONCILING"
  | "UNRESOLVED"
  | "HUMAN_REVIEW";

const SEND_INTENT_TRANSITIONS: Record<SendIntentState, SendIntentState[]> = {
  PENDING:       ["DISPATCHING", "FAILED"],
  //
  // DISPATCHING → DISPATCHING is the stale-lease re-claim path:
  // the sweeper increments fencingEpoch on the DB row and calls transitionState
  // to write an audit entry; the status itself stays DISPATCHING so the
  // re-dispatched worker picks it up normally.
  DISPATCHING:   ["DISPATCHING", "SENT", "ACCEPTED", "FAILED", "UNKNOWN"],
  UNKNOWN:       ["RECONCILING", "HUMAN_REVIEW"],
  RECONCILING:   ["SENT", "ACCEPTED", "FAILED", "UNKNOWN", "UNRESOLVED", "HUMAN_REVIEW"],
  UNRESOLVED:    ["RECONCILING", "HUMAN_REVIEW"],  // operator can trigger another sweep
  SENT:          [],
  ACCEPTED:      [],
  FAILED:        [],
  HUMAN_REVIEW:  ["SENT", "ACCEPTED", "FAILED"],
};

// ---------------------------------------------------------------------------
// 5. QuotaReservation (SendQuotaReservation)
// ---------------------------------------------------------------------------
export type QuotaReservationState = "RESERVED" | "CONSUMED" | "RELEASED" | "HELD";

const QUOTA_RESERVATION_TRANSITIONS: Record<
  QuotaReservationState,
  QuotaReservationState[]
> = {
  RESERVED: ["CONSUMED", "RELEASED"],
  HELD:     ["RESERVED", "RELEASED"],
  CONSUMED: [],
  RELEASED: [],
};

// ---------------------------------------------------------------------------
// 6. Operation
// ---------------------------------------------------------------------------
export type OperationState =
  | "PENDING"
  | "RUNNING"
  | "RECOVERABLE"
  | "LEASE_EXPIRED"
  | "SUCCEEDED"
  | "FAILED";

const OPERATION_TRANSITIONS: Record<OperationState, OperationState[]> = {
  PENDING:      ["RUNNING"],
  RUNNING:      ["SUCCEEDED", "FAILED", "LEASE_EXPIRED"],
  RECOVERABLE:  ["RUNNING"],
  LEASE_EXPIRED: ["RUNNING", "FAILED"],
  SUCCEEDED:    [],
  FAILED:       ["RECOVERABLE"],
};

// ---------------------------------------------------------------------------
// 7. Lead
// ---------------------------------------------------------------------------
export type LeadStateValue =
  | "DISCOVERED"
  | "RESEARCH_PENDING"
  | "ENRICHING"
  | "ENRICHED"
  | "SIGNALS_EVALUATED"
  | "SCORE_PENDING"
  | "SCORED"
  | "EMAIL_REVEAL_PENDING"
  | "EMAIL_REVEALED"
  | "EMAIL_VALIDATING"
  | "EMAIL_VERIFIED"
  | "CONTENT_PENDING"
  | "CONTENT_READY"
  | "COMPLIANCE_PENDING"
  | "SEND_ELIGIBLE"
  | "QUEUED"
  | "SENT"
  | "WAITING_FOR_REPLY"
  | "REPLIED"
  | "DISQUALIFIED"
  | "SUPPRESSED"
  | "UNSUBSCRIBED"
  | "BOUNCED"
  | "COMPLAINT"
  | "SEQUENCE_STOPPED"
  | "MEETING_BOOKED"
  | "CONVERTED"
  | "FAILED_RETRYABLE"
  | "FAILED_TERMINAL";

const LEAD_TRANSITIONS: Partial<Record<LeadStateValue, LeadStateValue[]>> = {
  DISCOVERED:            ["RESEARCH_PENDING", "DISQUALIFIED"],
  RESEARCH_PENDING:      ["ENRICHING", "FAILED_RETRYABLE", "DISQUALIFIED"],
  ENRICHING:             ["ENRICHED", "FAILED_RETRYABLE"],
  ENRICHED:              ["SIGNALS_EVALUATED"],
  SIGNALS_EVALUATED:     ["SCORE_PENDING"],
  SCORE_PENDING:         ["SCORED"],
  SCORED:                ["EMAIL_REVEAL_PENDING", "DISQUALIFIED"],
  EMAIL_REVEAL_PENDING:  ["EMAIL_REVEALED", "FAILED_RETRYABLE"],
  EMAIL_REVEALED:        ["EMAIL_VALIDATING"],
  EMAIL_VALIDATING:      ["EMAIL_VERIFIED", "DISQUALIFIED", "FAILED_RETRYABLE"],
  EMAIL_VERIFIED:        ["CONTENT_PENDING"],
  CONTENT_PENDING:       ["CONTENT_READY"],
  CONTENT_READY:         ["COMPLIANCE_PENDING"],
  COMPLIANCE_PENDING:    ["SEND_ELIGIBLE", "SUPPRESSED", "UNSUBSCRIBED"],
  SEND_ELIGIBLE:         ["QUEUED", "SUPPRESSED", "UNSUBSCRIBED"],
  QUEUED:                ["SENT", "BOUNCED", "SUPPRESSED", "UNSUBSCRIBED"],
  SENT:                  ["WAITING_FOR_REPLY", "BOUNCED", "UNSUBSCRIBED", "SUPPRESSED"],
  WAITING_FOR_REPLY:     ["REPLIED", "SEQUENCE_STOPPED", "BOUNCED", "UNSUBSCRIBED", "SUPPRESSED"],
  REPLIED:               ["WAITING_FOR_REPLY", "MEETING_BOOKED", "UNSUBSCRIBED", "DISQUALIFIED"],
  FAILED_RETRYABLE:      ["RESEARCH_PENDING", "ENRICHING", "EMAIL_REVEAL_PENDING", "EMAIL_VALIDATING"],
  // Terminal states — no successors
  DISQUALIFIED:          [],
  SUPPRESSED:            [],
  UNSUBSCRIBED:          [],
  BOUNCED:               [],
  COMPLAINT:             [],
  SEQUENCE_STOPPED:      [],
  MEETING_BOOKED:        [],
  CONVERTED:             [],
  FAILED_TERMINAL:       [],
};

// ---------------------------------------------------------------------------
// 8. Company  (CAS-versioned entity; no status state machine yet)
// ---------------------------------------------------------------------------
// Company has no status field — it is CAS-protected by version alone.
// This entry serves as a registry placeholder and will expand when
// Company lifecycle states are introduced.
const COMPANY_TRANSITIONS: Record<string, string[]> = {};

// ---------------------------------------------------------------------------
// 9. WarmupMailbox  (INV-10: WarmupState imported from warmup-types.ts)
// ---------------------------------------------------------------------------

const WARMUP_MAILBOX_TRANSITIONS: Record<WarmupState, WarmupState[]> = {
  NOT_STARTED: ["OBSERVATION"],
  OBSERVATION: ["RAMPING", "PAUSED"],
  RAMPING:     ["STABLE", "COOLDOWN", "PAUSED"],
  STABLE:      ["COOLDOWN", "PAUSED"],
  COOLDOWN:    ["RAMPING", "PAUSED"],       // automatic recovery → RAMPING, not RECOVERY
  PAUSED:      ["RECOVERY"],                // operator resume only
  RECOVERY:    ["RAMPING", "PAUSED"],
};

// ---------------------------------------------------------------------------
// 10. WarmupDomain  (same transitions as WarmupMailbox)
// ---------------------------------------------------------------------------

const WARMUP_DOMAIN_TRANSITIONS: Record<WarmupState, WarmupState[]> =
  WARMUP_MAILBOX_TRANSITIONS;

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

/** All model names that have registered state machines. */
export type StatefulModel =
  | "CampaignRun"
  | "Campaign"
  | "OutreachMessage"
  | "SendIntent"
  | "QuotaReservation"
  | "Operation"
  | "Lead"
  | "Company"
  | "WarmupMailbox"
  | "WarmupDomain";

type AnyTransitionMap = Record<string, string[]>;

const REGISTRY: Record<StatefulModel, AnyTransitionMap> = {
  CampaignRun:       CAMPAIGN_RUN_TRANSITIONS as AnyTransitionMap,
  Campaign:          CAMPAIGN_TRANSITIONS as AnyTransitionMap,
  OutreachMessage:   OUTREACH_MESSAGE_TRANSITIONS as AnyTransitionMap,
  SendIntent:        SEND_INTENT_TRANSITIONS as AnyTransitionMap,
  QuotaReservation:  QUOTA_RESERVATION_TRANSITIONS as AnyTransitionMap,
  Operation:         OPERATION_TRANSITIONS as AnyTransitionMap,
  Lead:              LEAD_TRANSITIONS as AnyTransitionMap,
  Company:           COMPANY_TRANSITIONS,
  WarmupMailbox:     WARMUP_MAILBOX_TRANSITIONS as AnyTransitionMap,
  WarmupDomain:      WARMUP_DOMAIN_TRANSITIONS as AnyTransitionMap,
};

// ---------------------------------------------------------------------------
// Exported validation function
// ---------------------------------------------------------------------------

export class IllegalStateTransitionError extends Error {
  constructor(
    public readonly model: StatefulModel,
    public readonly fromState: string,
    public readonly toState: string,
  ) {
    super(
      `ILLEGAL_STATE_TRANSITION [${model}]: '${fromState}' → '${toState}' is not a legal transition`,
    );
    this.name = "IllegalStateTransitionError";
  }
}

/**
 * Validates that `nextState` is a legal successor of `currentState` for
 * the given `model`. Throws `IllegalStateTransitionError` on violation.
 *
 * This is called by `transitionState()` before any DB operation.
 */
export function validateTransition(
  model: StatefulModel,
  currentState: string,
  nextState: string,
): void {
  const machine = REGISTRY[model];
  if (!machine) {
    throw new IllegalStateTransitionError(model, currentState, nextState);
  }

  const legalSuccessors = machine[currentState];

  // Models without a status field (e.g. Company) allow all transitions for now.
  if (legalSuccessors === undefined) {
    // Unknown predecessor — reject to be safe
    throw new IllegalStateTransitionError(model, currentState, nextState);
  }

  if (!legalSuccessors.includes(nextState)) {
    throw new IllegalStateTransitionError(model, currentState, nextState);
  }
}

/** Returns the raw transition map for a model (for introspection / tests). */
export function getTransitionMap(model: StatefulModel): AnyTransitionMap {
  return REGISTRY[model];
}
