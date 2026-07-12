<USER_REQUEST>
please follow this guide explicitly and fix this issues  # Queue Architecture Production Fix Guide

Reviewed against the actual codebase (not just the two documents). Verdict up front: the 20-gap analysis is a reasonable generic checklist, but roughly a third of it is already solved in ways the checklist didn't anticipate (DB-state reconciliation instead of BullMQ-native mechanisms), one item (`#16`, scheduler lock) is solving a problem that doesn't exist given how you're already using BullMQ `repeat`, and there are two real gaps neither document caught (`enrich-lead-batch` name collision, unbounded/unpaced LinkedIn batches). The plan below is scoped to what's actually missing.

## 0. Reconciliation: gap analysis vs. actual code

| # | Gap | Verdict | Where it already lives | What's actually left |
|---|---|---|---|---|
| 1 | Job contracts | **Open** | none | Section 1.2 |
| 2 | Idempotency | **Partial** | `send.agent.ts` claim-token + `SKIP LOCKED`; `linkedin-outreach.agent.ts` `SCHEDULED→EXECUTING` guard; `email-enrichment.queue.ts` hash-based `jobId` | Apply the same pattern to `score-lead`/`run-generate` re-entrancy (Section 8) |
| 3 | Dead-letter queue | **Partial** | `QueueJob` table + `recover-stuck-*` cases already do DB-level reconciliation | Not a separate DLQ *queue* — extend `QueueJob` writes to cover all job types (Section 1.4) |
| 4 | Retry policy | **Partial** | uniform 3× exponential everywhere; no error-class awareness | SMTP retryable/permanent split is a real, live bug (Section 6) |
| 5 | Priority | **Partial** | `send-batch`, `followup`, `signal-accelerate-lead` already set `priority` | Never systematic — only 3 of ~50 job types (Section 1.1) |
| 6 | Concurrency | **Open** | one worker, concurrency 3, for 48 job types | Primary target of this guide (Section 2–3) |
| 7 | Rate limiting | **Partial** | `gemini.limiter.ts` is a real per-model token-bucket limiter with RPM + concurrency + backpressure; Apollo/BuiltWith have concurrency caps + interpage delay | LinkedIn/Unipi
<truncated 45215 bytes>
?? 0) + 1;

if (result.failureClass === "permanent" || newCount >= MAX_SEND_RETRIES) {
  await prisma.outreachMessage.update({
    where: { id: message.id },
    data: {
      deliveryState: DeliveryState.FAILED,
      claimToken: null,
      retryCount: newCount,
      errorMessage: result.error,
    },
  });
} else {
  await prisma.outreachMessage.update({
    where: { id: message.id },
    data: {
      deliveryState: DeliveryState.QUEUED,
      claimToken: null,
      retryCount: newCount,
      nextRetryAt: computeBackoff(newCount),
      errorMessage: result.error,
    },
  });
}
```

`computeBackoff` is whatever the existing `nextRetryAt` calculation already does — this only adds the branch, it doesn't change the backoff math. A permanent failure is worth considering for `Suppression` auto-insert too (a `550 user unknown` bounce is a strong unsubscribe signal) — that's a product decision, not a queue-architecture one, so flagged rather than prescribed here.

---

## 7. F. `linkedin-outreach.agent.ts` — pacing and batch size

The claim/recovery pattern here (`SCHEDULED → EXECUTING` via `updateMany` at line ~308, reconciled by `recover-stuck-sequence-steps`) is a correct, working equivalent of the email claim-token approach. No changes needed there.

The real gap: the candidate query has no `take`, and the processing loop has no inter-action delay. `runLinkedInOutreach` today can fire an unbounded number of sequential Unipile calls in a single job execution with zero pacing between them — the only "concurrency" boundary is the BullMQ worker's job-level concurrency, which does nothing about how many actions happen *inside* one job. This is a real, live gap that outranks several items on the original 20-gap list in actual risk, since LinkedIn/Unipile enforce rate limits and flag bursty automation at the account level, not just the API level.

`
<truncated 12477 bytes>

NOTE: The output was truncated because it was too long. Use a more targeted query or a smaller range to get the information you need.