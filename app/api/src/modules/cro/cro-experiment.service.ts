/**
 * CRO Experiment Engine Runtime Service
 *
 * Manages sticky experiment assignments, runs statistical decision evaluations,
 * and writes completed experiment results back into the Evidence Ledger for closed-loop learning.
 */

import {
  ExperimentAssignment,
  ExperimentEvaluationInput,
  evaluateExperimentDecision,
  resolveDeterministicExperimentVariant,
} from "./cro-engine.service";
import { CROEvidenceLedgerService } from "./cro-evidence.service";

export class CROExperimentRuntimeService {
  private assignments: ExperimentAssignment[] = [];

  constructor(private evidenceLedger: CROEvidenceLedgerService) {}

  /**
   * Retrieves or assigns a sticky experiment variant for a subject (user/org).
   */
  public getOrAssignVariant(experimentId: string, subjectId: string, sampleRatio = 0.5): ExperimentAssignment {
    const assignment = resolveDeterministicExperimentVariant(
      experimentId,
      subjectId,
      this.assignments,
      sampleRatio
    );

    if (!this.assignments.some((a) => a.experimentId === experimentId && a.subjectId === subjectId)) {
      this.assignments.push(assignment);
    }

    return assignment;
  }

  /**
   * Evaluates an experiment's statistical decision and updates the Evidence Ledger.
   */
  public finalizeExperiment(input: ExperimentEvaluationInput) {
    const result = evaluateExperimentDecision(input);

    // Write successful experiment outcome back to Evidence Ledger for historical CRO learning
    if (result.decision === "SHIP") {
      this.evidenceLedger.registerEvidence({
        type: "EXPERIMENT",
        reference: `exp:${input.hypothesisId}`,
        observation: `Experiment '${input.hypothesisId}' produced +${(result.relativeLift * 100).toFixed(1)}% lift (p=${input.primaryMetric.pValue}). Decision: SHIP.`,
        metadata: {
          hypothesisId: input.hypothesisId,
          sampleSize: input.sampleSize,
          relativeLift: result.relativeLift,
          guardrailsPassed: result.guardrailsPassed,
        },
      });
    }

    return result;
  }
}
