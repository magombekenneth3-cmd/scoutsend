/**
 * CRO Evidence Ledger Service
 *
 * Manages verifiable, addressable evidence collection across DOM snapshots,
 * analytics events, user feedback, and historical experiment outcomes.
 */

import { CROEvidence } from "./cro-engine.service";

export class CROEvidenceLedgerService {
  private ledger: Map<string, CROEvidence> = new Map();

  /**
   * Registers a new evidence item into the in-memory or persisted ledger.
   */
  public registerEvidence(evidence: Omit<CROEvidence, "id" | "capturedAt"> & { id?: string }): CROEvidence {
    const id = evidence.id ?? `EVID-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const fullEvidence: CROEvidence = {
      ...evidence,
      id,
      capturedAt: new Date(),
    };
    this.ledger.set(id, fullEvidence);
    return fullEvidence;
  }

  /**
   * Retrieves an evidence item by its addressable ID.
   */
  public getEvidenceById(id: string): CROEvidence | undefined {
    return this.ledger.get(id);
  }

  /**
   * Retrieves all registered evidence for a given route.
   */
  public getEvidenceByRoute(route: string): CROEvidence[] {
    return Array.from(this.ledger.values()).filter((e) => e.route === route);
  }

  /**
   * Returns all active evidence in the ledger.
   */
  public getAllEvidence(): CROEvidence[] {
    return Array.from(this.ledger.values());
  }

  /**
   * Clears all evidence (primarily for unit test clean slate).
   */
  public clear(): void {
    this.ledger.clear();
  }
}

export const globalEvidenceLedger = new CROEvidenceLedgerService();
