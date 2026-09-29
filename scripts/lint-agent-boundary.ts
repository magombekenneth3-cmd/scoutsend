#!/usr/bin/env tsx
/**
 * Agent Boundary Lint — Hard-Enforced CI Gate
 *
 * Scans all TypeScript files under the LLM agent directory for direct imports
 * of Prisma or other DB modules. Violations break architectural boundaries by
 * allowing LLM agents to write to the database directly.
 *
 * BASELINE MODE (Sprint 5):
 *   Known pre-existing violations are recorded in agent-boundary-baseline.json.
 *   Files in the baseline: PASS (with a warning).
 *   Files NOT in the baseline with new violations: FAIL (CI-blocking).
 *
 *   This gives an immediate hard architectural gate:
 *     "No NEW Prisma violations may enter the gemini/ directory."
 *
 *   Sprint 6: remove baseline violations one-by-one. When baseline is empty,
 *   delete the baseline file to switch to zero-tolerance mode.
 *
 * USAGE:
 *   pnpm lint:agent-boundary          — checks with baseline
 *   pnpm lint:agent-boundary --update — regenerates baseline from current state
 *
 * EXIT CODES:
 *   0 — no new violations (baseline violations logged as warnings)
 *   1 — new violations detected (CI fail)
 *   2 — baseline file is missing or malformed
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

// ─── Configuration ────────────────────────────────────────────────────────────

const WORKSPACE_ROOT = resolve(process.cwd());

// Env-var overrides allow integration tests to inject fixture paths without
// modifying source files. CI always uses the defaults.
const SCAN_DIR = process.env["BOUNDARY_SCAN_DIR"] ??
  join(WORKSPACE_ROOT, "app/api/src/modules/gemini");
const BASELINE_PATH = process.env["BOUNDARY_BASELINE_PATH"] ??
  join(WORKSPACE_ROOT, "scripts/agent-boundary-baseline.json");

/**
 * Direct DB boundary violations.
 *
 * Patterns that constitute a hard boundary violation when found in a non-test
 * file inside the gemini/ agent directory.
 *
 * Detection rules:
 *   Direct  — exact import of prisma client or db module
 *   Indirect — known DB-wrapping modules that expose write operations
 *
 * Type-only imports are always allowed (they have no runtime effect):
 *   import type { Prisma } from "@prisma/client"  ← ALLOWED
 *   import type { PrismaClient } from "@prisma/client"  ← ALLOWED
 */
const VIOLATION_PATTERNS: ViolationPattern[] = [
  {
    pattern: /^import\s+(?!type\s).*from\s+["'].*\/lib\/prisma["']/m,
    code: "DIRECT_PRISMA_IMPORT",
    description: "Direct runtime import of the prisma singleton",
    example: 'import { prisma } from "../../lib/prisma"',
  },
  {
    pattern: /^import\s+(?!type\s).*PrismaClient.*from\s+["']@prisma\/client["']/m,
    code: "PRISMA_CLIENT_IMPORT",
    description: "Direct import of PrismaClient constructor from @prisma/client",
    example: 'import { PrismaClient } from "@prisma/client"',
  },
  {
    pattern: /^import\s+(?!type\s)\{[^}]*(?:prisma|db|database)[^}]*\}.*from\s+["'].*\/lib\/(?:prisma|db|database)["']/m,
    code: "ALIASED_DB_IMPORT",
    description: "Import of prisma/db/database singleton under any alias",
    example: 'import { db as prisma } from "../../lib/database"',
  },
  {
    pattern: /^import\s+(?!type\s).*from\s+["'].*\/lib\/prisma-tenant["']/m,
    code: "TENANT_PRISMA_IMPORT",
    description: "Direct import of the tenant-scoped prisma factory",
    example: 'import { getTenantPrisma } from "../../lib/prisma-tenant"',
  },
  {
    pattern: /^import\s+(?!type\s).*from\s+["'].*\/lib\/prisma-locks["']/m,
    code: "PRISMA_LOCKS_IMPORT",
    description: "Direct import of prisma advisory lock helpers",
    example: 'import { withAdvisoryLock } from "../../lib/prisma-locks"',
  },
  {
    pattern: /^import\s+(?!type\s).*?\b(callGemini|callGeminiWithTools)\b.*?from\s+["'].*\/gemini\.client["']/m,
    code: "DIRECT_RAW_GEMINI_CLIENT_IMPORT",
    description: "Direct import of raw callGemini / callGeminiWithTools instead of callGateway()",
    example: 'import { callGemini } from "./gemini.client"',
  },
];

interface ViolationPattern {
  pattern: RegExp;
  code: string;
  description: string;
  example: string;
}

interface ViolationEntry {
  file: string;       // relative to workspace root
  violations: string[]; // violation codes found
}

interface BaselineFile {
  version: number;
  generatedAt: string;
  description: string;
  violations: string[]; // relative paths
}

// ─── File scanning ────────────────────────────────────────────────────────────

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkDir(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts") && !entry.endsWith(".spec.ts")) {
      results.push(full);
    }
  }
  return results;
}

function scanFile(filePath: string): string[] {
  const content = readFileSync(filePath, "utf-8");
  return VIOLATION_PATTERNS
    .filter((vp) => vp.pattern.test(content))
    .map((vp) => vp.code);
}

function collectViolations(): ViolationEntry[] {
  const files = walkDir(SCAN_DIR);
  const violations: ViolationEntry[] = [];

  for (const file of files) {
    const codes = scanFile(file);
    if (codes.length > 0) {
      violations.push({
        file: relative(WORKSPACE_ROOT, file).replace(/\\/g, "/"),
        violations: codes,
      });
    }
  }

  return violations;
}

// ─── Baseline operations ──────────────────────────────────────────────────────

function loadBaseline(): BaselineFile | null {
  try {
    const raw = readFileSync(BASELINE_PATH, "utf-8");
    return JSON.parse(raw) as BaselineFile;
  } catch {
    return null;
  }
}

function updateBaseline(violations: ViolationEntry[]): void {
  const baseline: BaselineFile = {
    version: 1,
    generatedAt: new Date().toISOString(),
    description:
      "Known pre-existing agent boundary violations. " +
      "Files listed here are approved legacy violations that will be removed in Sprint 6. " +
      "Any NEW file not listed here that introduces a prisma import will fail CI. " +
      "Delete this file to switch to zero-tolerance mode.",
    violations: violations.map((v) => v.file).sort(),
  };
  writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + "\n", "utf-8");
  console.log(`\n✓ Baseline updated: ${baseline.violations.length} violations recorded`);
  console.log(`  ${BASELINE_PATH}`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
  const args = process.argv.slice(2);
  const isUpdateMode = args.includes("--update");

  console.log("\n┌─────────────────────────────────────────────┐");
  console.log("│  Agent Boundary Check (Sprint 5 Gate)       │");
  console.log("└─────────────────────────────────────────────┘\n");
  console.log(`  Scanning: ${SCAN_DIR}`);

  const violations = collectViolations();

  if (isUpdateMode) {
    updateBaseline(violations);
    process.exit(0);
  }

  // ── Load baseline ────────────────────────────────────────────────────────
  const baseline = loadBaseline();

  if (!baseline) {
    // No baseline file → zero-tolerance mode
    if (violations.length === 0) {
      console.log("\n✓ No violations detected. Agent boundary is clean.\n");
      process.exit(0);
    }

    console.error("\n✗ AGENT BOUNDARY VIOLATIONS DETECTED (zero-tolerance mode)\n");
    for (const v of violations) {
      console.error(`  ${v.file}`);
      for (const code of v.violations) {
        const pattern = VIOLATION_PATTERNS.find((p) => p.code === code)!;
        console.error(`    [${code}] ${pattern.description}`);
        console.error(`    Example: ${pattern.example}`);
      }
    }
    console.error("\n  All Prisma imports in gemini/ are prohibited.");
    console.error("  Move DB operations to an execution service outside gemini/.\n");
    process.exit(1);
  }

  // ── Baseline-aware mode ──────────────────────────────────────────────────
  const baselineSet = new Set(baseline.violations);
  const newViolations = violations.filter((v) => !baselineSet.has(v.file));
  const knownViolations = violations.filter((v) => baselineSet.has(v.file));
  const removedFromBaseline = baseline.violations.filter(
    (b) => !violations.some((v) => v.file === b),
  );

  // Report known baseline violations (informational)
  if (knownViolations.length > 0) {
    console.log(`  ⚠ ${knownViolations.length} known baseline violation(s) — approved legacy:`);
    for (const v of knownViolations) {
      console.log(`    • ${v.file} [${v.violations.join(", ")}]`);
    }
    console.log();
  }

  // Report removed violations (positive signal — Sprint 6 progress)
  if (removedFromBaseline.length > 0) {
    console.log(`  ✓ ${removedFromBaseline.length} baseline violation(s) REMOVED (Sprint 6 progress):`);
    for (const f of removedFromBaseline) {
      console.log(`    ✓ ${f}`);
    }
    console.log(`\n  Run 'pnpm lint:agent-boundary --update' to update the baseline.`);
    console.log();
  }

  // Fail on new violations
  if (newViolations.length > 0) {
    console.error("  ✗ NEW AGENT BOUNDARY VIOLATION(S) DETECTED\n");
    for (const v of newViolations) {
      console.error(`    ${v.file}`);
      for (const code of v.violations) {
        const pattern = VIOLATION_PATTERNS.find((p) => p.code === code)!;
        console.error(`      [${code}] ${pattern.description}`);
        console.error(`      Example: ${pattern.example}`);
      }
    }
    console.error();
    console.error("  This violation is NOT present in the approved baseline.");
    console.error("  Do not add new Prisma imports to gemini/ agent files.");
    console.error("  Move DB operations to an execution service outside gemini/.\n");
    console.error("  CI FAILED.\n");
    process.exit(1);
  }

  // All clear
  console.log(`  ✓ ${knownViolations.length} known baseline violation(s) (Sprint 6 target: 0)`);
  console.log("  ✓ No new violations\n");
  console.log("  Agent boundary check passed.\n");
  process.exit(0);
}

main();
