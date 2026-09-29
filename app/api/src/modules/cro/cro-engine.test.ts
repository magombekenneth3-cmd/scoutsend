import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  calculateDeterministicExistenceConfidence,
  calculateDeterministicCausalConfidence,
  evaluateCROFinding,
  computeActivationProgress,
  evaluateDnsRecoveryState,
  resolveDeterministicExperimentVariant,
  evaluateExperimentDecision,
  validateFindingEvidence,
  CROEvidence,
  ExperimentAssignment,
} from "./cro-engine.service";
import { CROEvidenceLedgerService } from "./cro-evidence.service";
import { CROUICrawlerService } from "./cro-ui-crawler.service";
import { CROAnalyticsService } from "./cro-analytics.service";
import { CROAuditRunnerService } from "./cro-audit.service";
import { CROExperimentRuntimeService } from "./cro-experiment.service";

describe("Production-Grade Machine-Readable CRO Engine Unit Test Matrix", () => {
  test("Split Confidence Calculation — Existence vs Causal confidence separated", () => {
    const inputs = {
      hasDirectDomEvidence: true,
      hasAnalyticsEventData: true,
      hasMultipleOccurrences: true,
      hasUserResearchFeedback: false,
      hasHistoricalExperimentData: false,
    };
    const existence = calculateDeterministicExistenceConfidence(inputs);
    const causal = calculateDeterministicCausalConfidence(inputs, 0.65);

    assert.strictEqual(existence, 0.75);
    assert.strictEqual(causal, 0.75);
  });

  test("Persistent Experiment Assigner — Idempotent variant sticky assignment", () => {
    const existing: ExperimentAssignment[] = [];
    const assignment1 = resolveDeterministicExperimentVariant("exp_dns_recovery", "usr_123", existing);
    existing.push(assignment1);

    const assignment2 = resolveDeterministicExperimentVariant("exp_dns_recovery", "usr_123", existing);
    assert.strictEqual(assignment1.variant, assignment2.variant);
    assert.strictEqual(assignment1.assignedAt, assignment2.assignedAt);
  });

  test("DomainStatus-Driven Activation Stepper — Integrates PROPAGATING domain status", () => {
    const progress = computeActivationProgress({
      mailboxConnected: true,
      domainStatus: "PROPAGATING",
      leadsImported: true,
      campaignConfigured: false,
      campaignLaunched: false,
    });

    assert.strictEqual(progress.completedCount, 3);
    assert.strictEqual(progress.progressPercent, 60);
    assert.strictEqual(progress.steps[1]?.done, true);
    assert.match(progress.steps[1]?.label ?? "", /propagating/i);
  });

  test("Machine-Readable Priority Scoring — Backend calculates scoring.priorityScore", () => {
    const finding = evaluateCROFinding({
      id: "CRO-001",
      stage: "signup_to_activation",
      classification: "OBSERVED",
      failureMode: "ERROR_RECOVERY",
      location: { route: "/dashboard/domains" },
      evidenceIds: ["EVID-001", "EVID-002"],
      problem: "DKIM verification fails with raw technical error string",
      psychologicalMechanism: "Technical anxiety and perceived system breakdown",
      expectedBehaviorChange: "User utilizes 1-click copy record component and resumes setup",
      exposureRate: 0.08,
      impact: 10,
      effort: 3,
      risk: 1,
      confidenceInputs: {
        hasDirectDomEvidence: true,
        hasAnalyticsEventData: true,
        hasMultipleOccurrences: true,
        hasUserResearchFeedback: true,
        hasHistoricalExperimentData: false,
      },
    });

    assert.ok(finding.confidence.existence > 0);
    assert.ok(finding.confidence.causal > 0);
    assert.strictEqual(finding.scoring.impact, 10);
    assert.ok(finding.scoring.priorityScore > 0);
  });

  test("Statistical Decision Engine — Evaluates SHIP vs ROLLBACK", () => {
    const evaluation = evaluateExperimentDecision({
      hypothesisId: "HYP-001",
      sampleSize: 5000,
      minRequiredSampleSize: 1000,
      primaryMetric: {
        controlRate: 0.10,
        treatmentRate: 0.18,
        targetRelativeLift: 0.15,
        pValue: 0.001,
      },
      guardrails: [
        { metricName: "bounceRate", currentValue: 0.02, maxAllowedThreshold: 0.03 },
      ],
    });

    assert.strictEqual(evaluation.decision, "SHIP");
    assert.strictEqual(evaluation.guardrailsPassed, true);
  });

  test("Evidence Validation Safeguard — Rejects un-grounded findings citing non-existent evidence IDs", () => {
    const ledger: CROEvidence[] = [
      { id: "EVID-001", type: "DOM", reference: "domains-page.tsx:42", observation: "Missing DKIM component", capturedAt: new Date() },
    ];

    const invalidFinding = {
      id: "CRO-999",
      stage: "signup_to_activation" as const,
      classification: "OBSERVED" as const,
      failureMode: "ERROR_RECOVERY" as const,
      location: { route: "/dashboard/domains" },
      evidenceIds: ["EVID-001", "EVID-FAKE-999"],
      problem: "Un-grounded finding",
      psychologicalMechanism: "None",
      expectedBehaviorChange: "None",
      exposureRate: 0.1,
      impact: 5,
      effort: 2,
      risk: 1,
      confidenceInputs: {
        hasDirectDomEvidence: false,
        hasAnalyticsEventData: false,
        hasMultipleOccurrences: false,
        hasUserResearchFeedback: false,
        hasHistoricalExperimentData: false,
      },
    };

    const validation = validateFindingEvidence(invalidFinding, ledger);
    assert.strictEqual(validation.valid, false);
    assert.deepEqual(validation.missingEvidenceIds, ["EVID-FAKE-999"]);
    assert.match(validation.error ?? "", /cited non-existent or un-grounded evidence ids/i);
  });

  test("End-to-End CRO Pipeline — Crawl DOM -> Track Analytics -> Execute Audit -> Finalize Experiment", () => {
    const evidenceLedger = new CROEvidenceLedgerService();
    const uiCrawler = new CROUICrawlerService(evidenceLedger);
    const analyticsService = new CROAnalyticsService(evidenceLedger);
    const auditRunner = new CROAuditRunnerService(evidenceLedger, analyticsService);
    const experimentRuntime = new CROExperimentRuntimeService(evidenceLedger);

    // 1. Ingest Crawled UI DOM Snapshot
    uiCrawler.ingestUISnapshot({
      route: "/dashboard/domains",
      stateDescription: "Domain Setup — DKIM Verification Error",
      htmlContent: "<div>DKIM Record Missing</div>",
      headings: [{ level: 1, text: "Domain Verification" }],
      buttons: [{ text: "Re-verify", selector: "#reverify-btn", visible: true, enabled: true }],
      forms: [],
      links: [],
    });

    // 2. Track Behavioral Analytics Events
    analyticsService.trackEvent({ eventName: "landing_viewed", route: "/", timestamp: new Date() });
    analyticsService.trackEvent({ eventName: "signup_completed", route: "/signup", timestamp: new Date() });
    analyticsService.trackEvent({ eventName: "domain_verification_failed", route: "/dashboard/domains", timestamp: new Date() });

    const allEvidence = evidenceLedger.getAllEvidence();
    assert.ok(allEvidence.length >= 2, "Evidence ledger must contain crawled DOM and analytics failure evidence");

    const validEvidenceId = allEvidence[0]!.id;

    // 3. Execute Audit Run
    const auditResult = auditRunner.executeAuditRun([
      {
        id: "CRO-001",
        stage: "signup_to_activation",
        classification: "OBSERVED",
        failureMode: "ERROR_RECOVERY",
        location: { route: "/dashboard/domains" },
        evidenceIds: [validEvidenceId],
        problem: "DKIM verification fails without copyable record snippets",
        psychologicalMechanism: "Technical anxiety and setup abandonment",
        expectedBehaviorChange: "User utilizes copy component and background polling",
        exposureRate: 0.34,
        impact: 9,
        effort: 3,
        risk: 1,
        confidenceInputs: {
          hasDirectDomEvidence: true,
          hasAnalyticsEventData: true,
          hasMultipleOccurrences: true,
          hasUserResearchFeedback: false,
          hasHistoricalExperimentData: false,
        },
      },
    ]);

    assert.strictEqual(auditResult.findings.length, 1);
    assert.strictEqual(auditResult.topInterventions.length, 1);
    assert.strictEqual(auditResult.experimentPlans.length, 1);

    // 4. Finalize Experiment and Verify Closed-Loop Evidence Ledger Insertion
    const finalDecision = experimentRuntime.finalizeExperiment({
      hypothesisId: auditResult.experimentPlans[0]!.hypothesisId,
      sampleSize: 2500,
      minRequiredSampleSize: 1000,
      primaryMetric: {
        controlRate: 0.12,
        treatmentRate: 0.19, // +58% lift
        targetRelativeLift: 0.15,
        pValue: 0.002,
      },
      guardrails: [
        { metricName: "bounceRate", currentValue: 0.02, maxAllowedThreshold: 0.03 },
      ],
    });

    assert.strictEqual(finalDecision.decision, "SHIP");

    const updatedEvidence = evidenceLedger.getAllEvidence();
    const experimentEvidence = updatedEvidence.find((e) => e.type === "EXPERIMENT");
    assert.ok(experimentEvidence, "Successful SHIP experiment must persist back into Evidence Ledger as EVID-EXPERIMENT");
    assert.match(experimentEvidence!.observation, /produced \+58\.3% lift/i);
  });
});
