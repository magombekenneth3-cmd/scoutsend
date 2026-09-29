/**
 * CRO UI Crawler Service
 *
 * Captures route snapshots across key application states (Landing, Signup,
 * Onboarding, Domain DNS Error, Campaign Creation) and converts them into
 * verifiable evidence objects in the Evidence Ledger.
 */

import { UISnapshot } from "./cro-engine.service";
import { CROEvidenceLedgerService } from "./cro-evidence.service";

export interface CrawlTarget {
  route: string;
  stateDescription: string; // e.g. "Domain Setup - DKIM Verification Failed"
  htmlContent: string;
  headings: Array<{ level: number; text: string }>;
  buttons: Array<{ text: string; selector: string; visible: boolean; enabled: boolean }>;
  forms: Array<{ selector: string; fields: string[] }>;
  links: Array<{ text: string; href: string }>;
  accessibilityIssues?: string[];
}

export class CROUICrawlerService {
  constructor(private evidenceLedger: CROEvidenceLedgerService) {}

  /**
   * Process a crawled UI route snapshot and register its components into the Evidence Ledger.
   */
  public ingestUISnapshot(target: CrawlTarget): UISnapshot {
    const snapshot: UISnapshot = {
      route: target.route,
      viewport: { width: 1280, height: 800 },
      headings: target.headings,
      buttons: target.buttons,
      forms: target.forms,
      links: target.links,
      accessibilityIssues: target.accessibilityIssues ?? [],
      rawDomReference: `dom:${target.route}:${Date.now()}`,
    };

    // 1. Register Heading Structure Evidence
    if (target.headings.length > 0) {
      this.evidenceLedger.registerEvidence({
        type: "DOM",
        reference: `${target.route}#headings`,
        observation: `Page headings extracted: ${target.headings.map((h) => `H${h.level}:${h.text}`).join(", ")}`,
        route: target.route,
        metadata: { stateDescription: target.stateDescription, headings: target.headings },
      });
    }

    // 2. Register Interactive Button Evidence
    for (const btn of target.buttons) {
      this.evidenceLedger.registerEvidence({
        type: "DOM",
        reference: btn.selector,
        observation: `Interactive CTA button '${btn.text}' (visible: ${btn.visible}, enabled: ${btn.enabled})`,
        route: target.route,
        metadata: { stateDescription: target.stateDescription, button: btn },
      });
    }

    // 3. Register Accessibility Issues Evidence
    if (target.accessibilityIssues && target.accessibilityIssues.length > 0) {
      for (const issue of target.accessibilityIssues) {
        this.evidenceLedger.registerEvidence({
          type: "DOM",
          reference: `${target.route}#a11y`,
          observation: `Accessibility issue detected: ${issue}`,
          route: target.route,
          metadata: { stateDescription: target.stateDescription, issue },
        });
      }
    }

    return snapshot;
  }
}
