#!/usr/bin/env bun
/**
 * Guard: `createTextField`/`createLongTextField` calls without a `personal`
 * stance, with a baseline regression guard like guard-pii-annotations.ts.
 *
 * kumiko-framework#2810: `createTextField`/`createLongTextField` should
 * throw fail-closed when no `personal` (pattern #2558) is declared.
 * Workspace-wide `personal` is missing at hundreds of call sites — a throw would
 * break the build immediately. This guard covers the full set (every call),
 * `guard-pii-annotations.ts` only the name heuristic (PII-suspicious
 * field names) — the two baselines are deliberately separate.
 *
 * `.kumiko-text-field-stance-baseline.json` in the repo root pins the frozen
 * finding count per file:
 *   - current <= baseline per file: PASS
 *   - current >  baseline per file: FAIL (new call without a personal stance)
 * Reductions do NOT update the baseline automatically — run `--write-baseline`
 * after annotation commits. Without a baseline file the guard stays
 * warning-only (bootstrap: run `--write-baseline` once).
 *
 * Usage:
 *   bun guards/guard-text-field-stance.ts                  # compare against baseline
 *   bun guards/guard-text-field-stance.ts --write-baseline # rewrite baseline
 *   bun guards/guard-text-field-stance.ts --no-baseline    # skip comparison
 */
import * as path from "node:path";
import {
  type CallExpression,
  type Node,
  type ObjectLiteralExpression,
  type SourceFile,
  SyntaxKind,
} from "ts-morph";
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
  extensions: ["ts"],
  frameworkWithin: ["packages/*/src/**", "samples/**", "demo/**"],
  // `demo/` isn't a declared sourceRoot (kumiko.json) — extraGlobs pulls its
  // files in on top of the scope's own hits; frameworkWithin above still
  // gates them the same as every other hit.
  extraGlobs: ["demo/**/*.ts"],
};
// Unlike guard-pii-annotations.ts, tests are IN scope: kumiko-framework#2810's
// fail-closed throw fires at call time regardless of test vs. production code —
// a test fixture calling createTextField() without `personal` breaks the same
// way prod code would once the throw lands.
const EXCLUDE = /\.d\.ts$/;

const FIELD_FACTORY_CALLEES = new Set(["createTextField", "createLongTextField"]);

// These two files deliberately call the factories without a stance to prove
// the fail-closed throw (kumiko-framework#2921) — exact repo-relative match,
// not basename, so a consumer file sharing a name stays flagged.
const STANCE_THROW_TEST_ALLOWLIST = new Set<string>([
  "packages/framework/src/engine/__tests__/factories-long-text.test.ts",
  "packages/framework/src/engine/__tests__/factories-personal.test.ts",
]);

const VALID_PERSONAL_HINT =
  '{ personal: "self" | "tenant" | "ref" | { of: "<ownerField>" } | false } ("false" additionally needs { reason: "..." })';

function relFile(sf: SourceFile, roots: readonly RepoRoot[]): string {
  return relFromRepoRoot(sf.getFilePath(), roots);
}

function fieldFactoryOptions(call: CallExpression): ObjectLiteralExpression | undefined {
  const first = call.getArguments()[0];
  return first?.isKind(SyntaxKind.ObjectLiteralExpression) ? first : undefined;
}

// A spread's source (e.g. `{ ...base, maxLength: 5 }`) may supply `personal`
// without a literal property here — statically undecidable like a non-object
// argument, so treat it the same way (not countable).
function hasSpreadProperty(obj: ObjectLiteralExpression): boolean {
  return obj.getProperties().some((prop) => prop.isKind(SyntaxKind.SpreadAssignment));
}

// Mirrors guard-pii-annotations.ts's `personal` branch: every value counts as
// answered, including `personal: false` (the framework requires a `reason`
// for it) — except `undefined`/`null`, which never answered the question.
function hasPersonalStance(obj: ObjectLiteralExpression): boolean {
  const prop = obj.getProperty("personal");
  if (!prop?.isKind(SyntaxKind.PropertyAssignment)) return false;
  const init: Node | undefined = prop.getInitializer();
  return (
    init !== undefined &&
    init.getKind() !== SyntaxKind.UndefinedKeyword &&
    !(init.isKind(SyntaxKind.Identifier) && init.getText() === "undefined") &&
    init.getKind() !== SyntaxKind.NullKeyword
  );
}

function enclosingFieldName(call: CallExpression): string | null {
  let node = call.getParent();
  while (node) {
    if (node.isKind(SyntaxKind.PropertyAssignment)) {
      return node.getName();
    }
    node = node.getParent();
  }
  return null;
}

export interface Finding {
  file: string;
  line: number;
  place: string;
  callee: string;
}

function scanFieldFactories(sf: SourceFile, roots: readonly RepoRoot[]): Finding[] {
  const findings: Finding[] = [];
  const file = relFile(sf, roots);
  if (STANCE_THROW_TEST_ALLOWLIST.has(file)) return findings;

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    if (!FIELD_FACTORY_CALLEES.has(callee)) continue;

    const args = call.getArguments();
    if (args.length > 0) {
      const options = fieldFactoryOptions(call);
      if (!options) continue; // non-literal argument (variable/spread) — not statically decidable
      if (hasSpreadProperty(options)) continue;
      if (hasPersonalStance(options)) continue;
    }

    const place = enclosingFieldName(call) ?? `${callee}(...)`;
    const line = call.getStartLineNumber();
    findings.push({ file, line, place, callee });
  }
  return findings;
}

export function scan(
  files: readonly SourceFile[],
  roots: readonly RepoRoot[] = resolveRepoRoots(),
): {
  findings: Finding[];
  scanned: number;
} {
  const findings: Finding[] = [];
  let scanned = 0;
  for (const sf of files) {
    if (EXCLUDE.test(sf.getFilePath())) continue;
    scanned++;
    findings.push(...scanFieldFactories(sf, roots));
  }
  return { findings, scanned };
}

function localFindings(findings: readonly Finding[]): readonly Finding[] {
  return findings.filter(isLocalFinding);
}

function countByFile(findings: readonly Finding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.file] = (counts[f.file] ?? 0) + 1;
  return counts;
}

const BASELINE_FILE = ".kumiko-text-field-stance-baseline.json";
const textFieldStanceBaseline = baselineRatchet({
  file: path.join(ROOT, BASELINE_FILE),
  formatVersion: 1,
  unit: "finding(s) without personal stance",
});

// One place for "what goes into the baseline", used by both the compare and
// the write path — a sibling finding leaking into the written file would turn
// a foreign checkout's code into a local, unfixable red.
export function baselineCounts(findings: readonly Finding[]): Record<string, number> {
  return countByFile(localFindings(findings));
}

function checkBaseline(findings: readonly Finding[]): GuardViolation[] {
  const local = localFindings(findings);
  const resolveLine = (file: string): number => local.find((f) => f.file === file)?.line ?? 1;
  return textFieldStanceBaseline.check(
    baselineCounts(findings),
    `Annotate the call (${VALID_PERSONAL_HINT}).`,
    {
      formatDriftRemediation: `Run \`kumiko-guards guards --write-baseline --guard="Text-Field Personal-Stance Guard"\` once.`,
      resolveLine,
    },
  );
}

function analyse(
  files: readonly SourceFile[],
  roots: readonly RepoRoot[],
  compareBaseline: boolean,
): GuardOutcome {
  const { findings } = scan(files, roots);
  if (!compareBaseline) {
    for (const f of findings)
      console.warn(
        `  [text-field-stance WARN] ${f.file}:${f.line}  ${f.callee}(...) at "${f.place}" has no personal stance — mark ${VALID_PERSONAL_HINT}`,
      );
    console.log("  Baseline comparison skipped (--no-baseline).");
    return { violations: [] };
  }
  return { violations: checkBaseline(findings) };
}

export const guard: AstGuard = {
  name: "Text-Field Personal-Stance Guard",
  scan: SCAN,
  hint: 'after a deliberate annotation: `kumiko-guards guards --write-baseline --guard="Text-Field Personal-Stance Guard"`',
  run: (files, roots = resolveRepoRoots()) => analyse(files, roots, true),
  writeBaseline: (files) => textFieldStanceBaseline.write(baselineCounts(scan(files).findings)),
};

// Flags are read ONLY here, not in run() — the shared runner
// (run-guards.ts) drives all guards with the same argv, and a
// --write-baseline there must not silently rewrite the
// baseline.
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--write-baseline")) {
    const project = buildSharedProject([guard]);
    const { findings } = scan(filesForGuard(project, guard));
    textFieldStanceBaseline.write(baselineCounts(findings));
    process.exit(0);
  }
  if (args.includes("--no-baseline")) {
    const project = buildSharedProject([guard]);
    analyse(filesForGuard(project, guard), resolveRepoRoots(), false);
    process.exit(0);
  }
  runStandalone(guard);
}
