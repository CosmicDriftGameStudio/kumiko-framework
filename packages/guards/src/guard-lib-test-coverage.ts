#!/usr/bin/env bun
// lib/ ist die Heimat der extrahierten Logik (Berechnung, Parsing, Mapping) —
// der no-logic-in-views-Guard schiebt sie dorthin, dieser Guard sorgt dafür,
// dass sie an der neuen Stelle auch GETESTET ist. Für jede lib-Datei mit
// mindestens einer exportierten Funktion muss ein Test existieren, der aus dem
// Modul importiert, und jede exportierte Funktion muss dort namentlich
// vorkommen.
//
// Warum statisch (ts-morph) statt Coverage-Threshold: Coverage lügt zweifach —
// sie sieht nie-importierte Module gar nicht, und "ausgeführt" heißt nicht
// "sinnvoll geprüft" (ein Integrationstest, der die Funktion transitiv über
// HTTP streift, färbt sie grün ohne eine einzige Assertion auf ihr Verhalten).
// Der Guard ist der strukturelle Gegenpart: er koppelt Test↔Modul über den
// echten Import und zählt namentliche Referenzen, nicht Zeilen. Der
// Coverage-Threshold in bunfig.toml bleibt daneben bestehen — beide zusammen,
// nie der Threshold allein.
//
// Ausgenommen: Dateien ohne exportierte Funktion (reine Typen/Konstanten wie
// eine Farb-Map — ein Test dafür wäre ein Fake-Test). IO-Loader, die bereits
// durch einen Integrationstest über HTTP gedeckt sind, tragen den ignore-Tag
// mit wahrheitsgemäßer Begründung.
//
// Bewusst out-of-scope: Re-Exports (`export { foo } from "./bar"`) zählen
// nicht als eigene Callable — die Quelldatei "./bar" trägt ihre eigene
// Coverage-Pflicht. Kommt lib/ je re-exportierte Funktionen ohne eigene
// Quelldatei im Scope vor, ist das ein stiller Blindspot; bisher (Stand
// dieser Fix-Runde) kommt das Pattern in keinem App-Repo vor.

import { dirname, resolve } from "node:path";
import { Node, type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, type GuardViolation, runStandalone, type ScanSpec } from "./_lib/guard-kit";
import { hasIgnoreTag } from "./_lib/ignore-tag";

// isTestFile() classifies by regex on the file's own path, not by which within-glob matched it, so lib/ vs. test classification stays correct regardless of scan-scope resolution.
const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts", "tsx"],
  kinds: ["library", "app"],
  within: ["lib/**/*.ts", "features/*/lib/**/*.ts", "**/*.test.ts", "**/*.test.tsx"],
};
const IGNORE_TAG = "kumiko-lint-ignore lib-test-coverage";

type Export = { readonly name: string; readonly node: Node };

function isTestFile(path: string): boolean {
  return /\.test\.tsx?$/.test(path) || /\/__tests__\//.test(path);
}

// Exportierte Callables: `export function f` und `export const f = () => …` /
// `= function () {}`. Reine Werte (`export const X = 5`), Typen und Interfaces
// zählen nicht — sie tragen keine Logik, die ein Verhaltenstest prüfen könnte.
function exportedCallables(sf: SourceFile): Export[] {
  const out: Export[] = [];
  for (const fd of sf.getFunctions()) {
    const name = fd.getName();
    if (name !== undefined && (fd.isExported() || fd.isDefaultExport()))
      out.push({ name, node: fd });
  }
  for (const vs of sf.getVariableStatements()) {
    if (!vs.isExported()) continue;
    for (const decl of vs.getDeclarations()) {
      const init = decl.getInitializer();
      if (init !== undefined && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
        out.push({ name: decl.getName(), node: decl });
      }
    }
  }
  return out;
}

function stripExt(path: string): string {
  return path.replace(/\.tsx?$/, "");
}

// Ein Test ist mit einer lib-Datei verknüpft, wenn er relativ aus genau dieser
// Datei importiert — nicht per Pfad-Konvention. Das erlaubt Tests eine Ebene
// über lib/ (features/<x>/__tests__/foo.test.ts → "../lib/foo") und verhindert,
// dass generische Namen (fieldText, targetForRow) in fremden Tests fälschlich
// als Referenz zählen.
function testImportsLib(testSf: SourceFile, libPathNoExt: string): boolean {
  const testDir = dirname(testSf.getFilePath());
  for (const imp of testSf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    if (!spec.startsWith(".")) continue;
    if (stripExt(resolve(testDir, spec)) === libPathNoExt) return true;
  }
  return false;
}

// Import-Deklarationen ausklammern: ein benannter Import ohne jede Nutzung
// (`import { addFees, subFees } from "../calc"`, nur addFees aufgerufen)
// erfuellte den Guard fuer subFees schon durch den Import-Text allein —
// der per-Funktions-Check war fuer named imports quasi tautologisch.
function bodyTextWithoutImports(testSf: SourceFile): string {
  const importRanges = testSf
    .getDescendantsOfKind(SyntaxKind.ImportDeclaration)
    .map((d) => [d.getStart(), d.getEnd()] as const);
  const full = testSf.getFullText();
  let out = "";
  let cursor = 0;
  for (const [start, end] of importRanges) {
    out += full.slice(cursor, start);
    cursor = end;
  }
  out += full.slice(cursor);
  return out;
}

function referencesName(testSf: SourceFile, name: string): boolean {
  return new RegExp(`\\b${name}\\b`).test(bodyTextWithoutImports(testSf));
}

export const guard: AstGuard = {
  name: "Lib-Test-Coverage Guard (App-Repos)",
  scan: SCAN,
  hint:
    "Jede lib-Datei mit exportierter Funktion braucht einen Test, der aus dem " +
    "Modul importiert und jede Funktion namentlich referenziert. IO-Loader, die " +
    `ein Integrationstest deckt: // ${IGNORE_TAG} <Grund, z.B. integration-covered via …>`,
  run(files: readonly SourceFile[]) {
    const violations: GuardViolation[] = [];
    const testFiles: SourceFile[] = [];
    const libFiles: SourceFile[] = [];
    for (const sf of files) {
      if (isTestFile(sf.getFilePath())) testFiles.push(sf);
      else if (!sf.getFilePath().endsWith(".d.ts")) libFiles.push(sf);
    }
    for (const sf of libFiles) {
      const relevant = exportedCallables(sf).filter((e) => !hasIgnoreTag(e.node, IGNORE_TAG));
      if (relevant.length === 0) continue;

      const libPathNoExt = stripExt(sf.getFilePath());
      const linked = testFiles.filter((t) => testImportsLib(t, libPathNoExt));
      if (linked.length === 0) {
        violations.push({
          file: sf.getFilePath(),
          line: 1,
          message: `Kein Test importiert dieses lib-Modul (${relevant.length} exportierte Funktion(en) ungetestet)`,
        });
        continue;
      }

      for (const e of relevant) {
        if (linked.some((t) => referencesName(t, e.name))) continue;
        violations.push({
          file: sf.getFilePath(),
          line: e.node.getStartLineNumber(),
          message: `Exportierte Funktion "${e.name}" wird in keinem verknüpften Test namentlich referenziert`,
        });
      }
    }
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
