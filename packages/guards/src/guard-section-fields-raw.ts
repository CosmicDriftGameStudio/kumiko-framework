#!/usr/bin/env bun
/**
 * Guard: raw iteration over a section's `fields` instead of `sectionFieldSpecs`.
 *
 * The boot-validator enforces `fields` XOR `groups` on edit sections
 * (packages/framework/src/engine/boot-validator/screens.ts), so a section that
 * carries `groups` has `fields: []`. A reader that iterates `section.fields`
 * walks an empty list there and silently sees no field at all — no crash, no
 * empty screen, just a check that checks nothing. The same cause hit three
 * independent readers (kumiko-framework#2986, then the boot-guard and the E2E
 * generator in #3042). `sectionFieldSpecs` (engine/screen-helpers.ts) is the
 * one reader that unions both sources.
 *
 * Flagged: for-of, spread and array reads over `<…section…>.fields`.
 * Known gap: `section.fields.length` is not flagged — the fields-XOR-groups
 * validator itself needs it, and an emptiness check is not the silent-
 * iteration bug.
 *
 * Scoped to the framework repo (`kinds`) and to the layer where a section is
 * a *spec*: renderer components iterate the already-flattened view model,
 * where the same expression is correct. Widening to the consumer repos needs
 * all nine measured against one pinned version first.
 *
 * Deliberate raw readers carry `// kumiko-lint-ignore section-fields-raw
 * <reason>` on the line itself or the line above — the reason is required, a
 * bare tag stays a finding.
 *
 * `.kumiko-section-fields-raw-baseline.json` in the repo root pins the frozen
 * count per file; over baseline fails, at or under passes. Without the file
 * the guard is warning-only (bootstrap: `--write-baseline` once).
 *
 * Usage:
 *   bun guards/guard-section-fields-raw.ts                  # compare to baseline
 *   bun guards/guard-section-fields-raw.ts --write-baseline # freeze current
 *   bun guards/guard-section-fields-raw.ts --no-baseline    # skip comparison
 */
import * as path from "node:path";
import { type Node, type PropertyAccessExpression, type SourceFile, SyntaxKind } from "ts-morph";
import {
  type AstGuard,
  baselineRatchet,
  buildSharedProject,
  filesForGuard,
  type GuardOutcome,
  type GuardViolation,
  isLocalFinding,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { type RepoRoot, resolveRepoRoots } from "./_lib/roots";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts", "tsx"],
  kinds: ["framework"],
  frameworkWithin: [
    "packages/framework/src/engine/**",
    "packages/framework/src/i18n/**",
    "packages/framework/src/testing/**",
    "packages/headless/src/**",
    "packages/renderer/src/app/**",
  ],
};

const EXCLUDE = /(__tests__|\.test\.tsx?$|\.integration\.tsx?$|\.d\.ts$)/;

const IGNORE_TAG = "kumiko-lint-ignore section-fields-raw";
// hasIgnoreTag() from _lib accepts a bare tag; the issue's premise 2 wants a
// visible reason, so the trailing `\S` is the whole point of not reusing it.
const REASONED_TAG = new RegExp(`${IGNORE_TAG}\\s+\\S`);

const SECTION_RECEIVER = /section/i;

const ARRAY_READS = new Set([
  "at",
  "concat",
  "entries",
  "every",
  "filter",
  "find",
  "findIndex",
  "findLast",
  "flat",
  "flatMap",
  "forEach",
  "includes",
  "indexOf",
  "join",
  "keys",
  "map",
  "reduce",
  "reduceRight",
  "reverse",
  "slice",
  "some",
  "sort",
  "toReversed",
  "toSorted",
  "values",
]);

function relFile(sf: SourceFile, roots: readonly RepoRoot[]): string {
  return relFromRepoRoot(sf.getFilePath(), roots);
}

function hasReasonedIgnoreTag(node: Node): boolean {
  const lines = node.getSourceFile().getFullText().split("\n");
  const line = node.getStartLineNumber();
  return REASONED_TAG.test(lines[line - 1] ?? "") || REASONED_TAG.test(lines[line - 2] ?? "");
}

function isSequenceRead(access: PropertyAccessExpression): boolean {
  const parent = access.getParent();
  if (parent === undefined) return false;
  if (parent.isKind(SyntaxKind.ForOfStatement)) return parent.getExpression() === access;
  if (parent.isKind(SyntaxKind.SpreadElement) || parent.isKind(SyntaxKind.SpreadAssignment)) {
    return true;
  }
  if (parent.isKind(SyntaxKind.PropertyAccessExpression) && ARRAY_READS.has(parent.getName())) {
    return parent.getParent()?.isKind(SyntaxKind.CallExpression) === true;
  }
  return false;
}

export interface Finding {
  file: string;
  line: number;
  snippet: string;
}

export function scanRawSectionFieldReads(
  sf: SourceFile,
  roots: readonly RepoRoot[] = resolveRepoRoots(),
): Finding[] {
  const findings: Finding[] = [];
  for (const access of sf.getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)) {
    if (access.getName() !== "fields") continue;
    if (!SECTION_RECEIVER.test(access.getExpression().getText())) continue;
    if (!isSequenceRead(access)) continue;
    if (hasReasonedIgnoreTag(access)) continue;
    const line = access.getStartLineNumber();
    const file = relFile(sf, roots);
    findings.push({ file, line, snippet: access.getText().slice(0, 80) });
    console.warn(
      `  [section-fields-raw WARN] ${file}:${line}  raw read of ${access.getText().slice(0, 80)} — use sectionFieldSpecs(section)`,
    );
  }
  return findings;
}

function scan(
  files: readonly SourceFile[],
  roots: readonly RepoRoot[] = resolveRepoRoots(),
): Finding[] {
  const findings: Finding[] = [];
  for (const sf of files) {
    if (EXCLUDE.test(sf.getFilePath())) continue;
    findings.push(...scanRawSectionFieldReads(sf, roots));
  }
  return findings;
}

const BASELINE_FILE = ".kumiko-section-fields-raw-baseline.json";
const sectionFieldsRawBaseline = baselineRatchet({
  file: path.join(ROOT, BASELINE_FILE),
  formatVersion: 1,
  unit: "raw section.fields read(s)",
});

const REMEDIATION = `Use sectionFieldSpecs(section) from @cosmicdrift/kumiko-framework/ui-types, or mark the line with \`// ${IGNORE_TAG} <reason>\`.`;

export function baselineCounts(findings: readonly Finding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings.filter(isLocalFinding)) counts[f.file] = (counts[f.file] ?? 0) + 1;
  return counts;
}

function analyse(
  files: readonly SourceFile[],
  roots: readonly RepoRoot[],
  compareBaseline: boolean,
): GuardOutcome {
  const findings = scan(files, roots);
  if (!compareBaseline) {
    console.log("  Baseline comparison skipped (--no-baseline).");
    return { violations: [] };
  }
  const local = findings.filter(isLocalFinding);
  const violations: GuardViolation[] = sectionFieldsRawBaseline.check(
    baselineCounts(findings),
    REMEDIATION,
    {
      formatDriftRemediation:
        'Run `kumiko-guards guards --write-baseline --guard="Raw section.fields Guard"` once.',
      resolveLine: (file) => local.find((f) => f.file === file)?.line ?? 1,
    },
  );
  return { violations };
}

export const guard: AstGuard = {
  name: "Raw section.fields Guard",
  scan: SCAN,
  hint: `${REMEDIATION} Known gap: \`section.fields.length\` is not flagged. After a deliberate change: \`kumiko-guards guards --write-baseline --guard="Raw section.fields Guard"\`.`,
  run: (files, roots = resolveRepoRoots()) => analyse(files, roots, true),
  writeBaseline: (files) => sectionFieldsRawBaseline.write(baselineCounts(scan(files))),
};

// Flags are read only here, never in run() — the shared runner drives every
// guard with the same argv, and a --write-baseline meant for another guard
// must not silently refreeze this one.
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--write-baseline")) {
    const project = buildSharedProject([guard]);
    sectionFieldsRawBaseline.write(baselineCounts(scan(filesForGuard(project, guard))));
    process.exit(0);
  }
  if (args.includes("--no-baseline")) {
    const project = buildSharedProject([guard]);
    analyse(filesForGuard(project, guard), resolveRepoRoots(), false);
    process.exit(0);
  }
  runStandalone(guard);
}
