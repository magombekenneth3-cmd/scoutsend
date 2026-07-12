import {z} from "zod";
import { LEARNING_EVENT_TYPES, LEARNING_OUTCOMES } from "../../lib/constants";



const eventTypeEnum = z.enum([
  LEARNING_EVENT_TYPES.REVIEW_FLAGGED,
  LEARNING_EVENT_TYPES.HUMAN_EDITED,
  LEARNING_EVENT_TYPES.HUMAN_APPROVED,
  LEARNING_EVENT_TYPES.HUMAN_REJECTED,
  LEARNING_EVENT_TYPES.AUTO_APPROVED,
]);

const outcomeEnum = z.enum([
  LEARNING_OUTCOMES.PENDING_REVIEW,
  LEARNING_OUTCOMES.APPROVED,
  LEARNING_OUTCOMES.REJECTED,
  LEARNING_OUTCOMES.EDITED_AND_APPROVED,
  LEARNING_OUTCOMES.DISMISSED,
]);

// ─── Query ────────────────────────────────────────────────────────────────────

export const getLearningEventsQuerySchema = z.object({
  eventType: eventTypeEnum.optional(),
  outcome: outcomeEnum.optional(),
  outreachMessageId: z.string().optional(),
  // Filter for unresolved events only (outcome = PENDING_REVIEW)
  pendingOnly: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// ─── Resolve: reviewer edits + approves ──────────────────────────────────────
// Called when a REVIEWER edits a held message and approves it.
// Records what changed (diffVector) and closes the learning loop.

export const resolveLearningEventSchema = z.object({
  subject: z.string().min(1).optional(),
  body: z.string().min(1).optional(),
  // Free-form note the reviewer can attach explaining the edit
  reviewerNote: z.string().max(500).optional(),
}).refine(
  (data) => data.subject !== undefined || data.body !== undefined,
  { message: "At least one of subject or body must be provided" }
);

// ─── Dismiss: reviewer rejects without editing ───────────────────────────────

export const dismissLearningEventSchema = z.object({
  reason: z.string().min(1).max(500),
});

