#!/usr/bin/env bun
/**
 * Guard: `createTextField`/`createLongTextField`-Aufrufe ohne `personal`-
 * Haltung, mit Baseline-Regression-Guard wie guard-pii-annotations.ts.
 *
 * kumiko-framework#2810: `createTextField`/`createLongTextField` sollen
 * fail-closed werfen, wenn kein `personal` (Muster #2558) deklariert ist.
 * Workspace-weit fehlt `personal` an hunderten Call-Sites — ein Throw würde
 * den Build sofort brechen. Dieser Guard deckt die Vollmenge (jeder Aufruf)
 * ab, `guard-pii-annotations.ts` nur die Namens-Heuristik (PII-verdächtige
 * Feldnamen) — die beiden Baselines sind bewusst getrennt.
 *
 * `.kumiko-text-field-stance-baseline.json` im Repo-Root pinnt pro File die
 * eingefrorene Fund-Anzahl:
 *   - aktuell <= baseline pro File: PASS
 *   - aktuell >  baseline pro File: FAIL (neuer Aufruf ohne personal-Haltung)
 * Reduktionen updaten die Baseline NICHT automatisch — nach Annotations-
 * Commits `--write-baseline` aufrufen. Ohne Baseline-Datei bleibt der Guard
 * warning-only (Bootstrap: einmalig `--write-baseline`).
 *
 * Usage:
 *   bun guards/guard-text-field-stance.ts                  # Vergleich gegen Baseline
 *   bun guards/guard-text-field-stance.ts --write-baseline # Baseline neu schreiben
 *   bun guards/guard-text-field-stance.ts --no-baseline    # Vergleich überspringen
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
  frameworkWithin: ["packages/*/src/**"],
};
// Unlike guard-pii-annotations.ts, tests are IN scope: kumiko-framework#2810's
// fail-closed throw fires at call time regardless of test vs. production code —
// a test fixture calling createTextField() without `personal` breaks the same
// way prod code would once the throw lands.
const EXCLUDE = /\.d\.ts$/;

const FIELD_FACTORY_CALLEES = new Set(["createTextField", "createLongTextField"]);

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
    const file = relFile(sf, roots);
    findings.push({ file, line, place, callee });
    console.warn(
      `  [text-field-stance WARN] ${file}:${line}  ${callee}(...) at "${place}" has no personal stance — mark ${VALID_PERSONAL_HINT}`,
    );
  }
  return findings;
}

function scan(
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

// Flags werden NUR hier gelesen, nicht in run() — der Shared-Runner
// (run-guards.ts) faehrt alle Guards mit derselben argv, ein
// --write-baseline dort duerfte die Baseline nicht stillschweigend
// neu schreiben.
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
