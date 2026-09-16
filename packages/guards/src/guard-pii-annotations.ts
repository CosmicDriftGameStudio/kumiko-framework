#!/usr/bin/env bun
/**
 * Guard: PII-typische Entity-Feldnamen ohne Annotation, mit Baseline-
 * Regression-Guard wie check-complexity.ts.
 *
 * Mirrors the boot heuristic from validatePiiAndRetention. Authors mark
 * fields with { pii: true }, { userOwned }, { tenantOwned: true },
 * { allowPlaintext: "reason" } (legacy) or { personal: ... } (0.210.0
 * successor to the four legacy subject annotations).
 *
 * `.kumiko-pii-annotations-baseline.json` im Repo-Root pinnt pro File die
 * eingefrorene Fund-Anzahl:
 *   - aktuell <= baseline pro File: PASS
 *   - aktuell >  baseline pro File: FAIL (neues unannotiertes PII-Feld)
 * Reduktionen updaten die Baseline NICHT automatisch — nach Annotations-
 * Commits `--write-baseline` aufrufen. Ohne Baseline-Datei bleibt der Guard
 * warning-only (Bootstrap: einmalig `--write-baseline`).
 *
 * Usage:
 *   bun guards/guard-pii-annotations.ts                  # Vergleich gegen Baseline
 *   bun guards/guard-pii-annotations.ts --write-baseline # Baseline neu schreiben
 *   bun guards/guard-pii-annotations.ts --no-baseline    # Vergleich überspringen
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
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  frameworkWithin: ["packages/*/src/**"],
};
const EXCLUDE = /(__tests__|\.test\.tsx?$|\.integration\.tsx?$|\.d\.ts$)/;

// Keep in sync with boot-validator/entity-handler.ts PII_*_NAME_HINTS.
const PII_DIRECT_NAME_HINTS = new Set([
  "email",
  "phone",
  "phonenumber",
  "mobile",
  "address",
  "street",
  "postalcode",
  "zipcode",
  "zip",
  "city",
  "displayname",
  "firstname",
  "lastname",
  "fullname",
  "birthday",
  "birthdate",
  "dateofbirth",
  "dob",
  "ssn",
  "taxid",
  "vatid",
  "passport",
  "iban",
  "bic",
]);

const PII_USER_OWNED_NAME_HINTS = new Set([
  "body",
  "text",
  "content",
  "message",
  "comment",
  "description",
  "note",
  "notes",
]);

function relFile(sf: SourceFile): string {
  return path.relative(ROOT, sf.getFilePath());
}

function fieldFactoryOptions(call: CallExpression): ObjectLiteralExpression | undefined {
  const first = call.getArguments()[0];
  return first?.isKind(SyntaxKind.ObjectLiteralExpression) ? first : undefined;
}

// Subject annotations answering "is this PII" (kept in sync with the
// author-facing PersonalAnnotations type, @cosmicdrift/kumiko-types
// packages/types/src/fields.ts). `personal` (0.210.0) is the successor
// to the four legacy fields below — every value counts as answered,
// including `personal: false` (the framework requires a `reason` for
// it). `find` is NOT a silencer: it resolves to lookupable/searchable/
// sensitive, which never answered the PII question either. `encrypted`
// isn't one either — the boot validator checks it only together with
// `sensitive` (ciphertext-at-rest), never as a substitute.
function isPiiSilencerAssignment(name: string, init: Node | undefined): boolean {
  if (name === "personal") {
    return (
      init !== undefined &&
      init.getKind() !== SyntaxKind.UndefinedKeyword &&
      !(init.isKind(SyntaxKind.Identifier) && init.getText() === "undefined") &&
      init.getKind() !== SyntaxKind.NullKeyword
    );
  }
  if (name === "allowPlaintext") return init?.isKind(SyntaxKind.StringLiteral) ?? false;
  if (name === "pii") return init?.getKind() === SyntaxKind.TrueKeyword;
  if (name === "tenantOwned") return init?.getKind() === SyntaxKind.TrueKeyword;
  if (name === "userOwned") return init?.isKind(SyntaxKind.ObjectLiteralExpression) ?? false;
  return false;
}

function objectHasPiiSilencer(obj: ObjectLiteralExpression): boolean {
  for (const prop of obj.getProperties()) {
    if (!prop.isKind(SyntaxKind.PropertyAssignment)) continue;
    if (isPiiSilencerAssignment(prop.getName(), prop.getInitializer())) return true;
  }
  return false;
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
  fieldName: string;
  hint: string;
}

function scanFieldFactories(sf: SourceFile): Finding[] {
  const findings: Finding[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression().getText();
    if (callee !== "createTextField" && callee !== "createLongTextField") continue;

    const fieldName = enclosingFieldName(call);
    if (!fieldName) continue;

    const options = fieldFactoryOptions(call);
    if (options && objectHasPiiSilencer(options)) continue;

    const lower = fieldName.toLowerCase();
    let hint: string | null = null;
    if (PII_DIRECT_NAME_HINTS.has(lower)) {
      hint = `{ personal: ... } or { pii: true } or { allowPlaintext: "is-business-data" }`;
    } else if (PII_USER_OWNED_NAME_HINTS.has(lower)) {
      hint = `{ personal: { of: "<authorIdField>" }, find: "exact" } or { userOwned: { ownerField: "<authorIdField>" } } or { allowPlaintext: "..." }`;
    }
    if (!hint) continue;

    const line = call.getStartLineNumber();
    findings.push({ file: relFile(sf), line, fieldName, hint });
    console.warn(
      `  [pii-annotations WARN] ${relFile(sf)}:${line}  field "${fieldName}" looks like PII — mark ${hint}`,
    );
  }
  return findings;
}

function scan(files: readonly SourceFile[]): {
  findings: Finding[];
  scanned: number;
} {
  const findings: Finding[] = [];
  let scanned = 0;
  for (const sf of files) {
    if (EXCLUDE.test(sf.getFilePath())) continue;
    scanned++;
    findings.push(...scanFieldFactories(sf));
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

const BASELINE_FILE = ".kumiko-pii-annotations-baseline.json";
const piiBaseline = baselineRatchet({
  file: path.join(ROOT, BASELINE_FILE),
  formatVersion: 1,
  unit: "PII-Fund(e)",
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
  return piiBaseline.check(
    baselineCounts(findings),
    `Feld annotieren ({ personal: ... } / { pii: true } / { userOwned: ... } / { tenantOwned: true } / { allowPlaintext: "..." }).`,
    {
      formatDriftRemediation: `Einmalig \`bun guards/guard-pii-annotations.ts --write-baseline\` aufrufen.`,
      resolveLine,
    },
  );
}

function analyse(files: readonly SourceFile[], compareBaseline: boolean): GuardOutcome {
  const { findings } = scan(files);
  if (!compareBaseline) {
    console.log("  Baseline-Vergleich uebersprungen (--no-baseline).");
    return { violations: [] };
  }
  return { violations: checkBaseline(findings) };
}

export const guard: AstGuard = {
  name: "PII-Annotations Guard",
  scan: SCAN,
  hint: "nach bewusster Annotation: `bun guards/guard-pii-annotations.ts --write-baseline`",
  run: (files) => analyse(files, true),
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
    piiBaseline.write(baselineCounts(findings));
    process.exit(0);
  }
  if (args.includes("--no-baseline")) {
    const project = buildSharedProject([guard]);
    analyse(filesForGuard(project, guard), false);
    process.exit(0);
  }
  runStandalone(guard);
}
