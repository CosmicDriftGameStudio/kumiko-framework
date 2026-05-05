/**
 * Guard: findet "silent skip" Stellen im Produktions-Code.
 *
 * Ein "silent skip" ist ein nacktes `return;` (ohne Wert) in Code, das
 * unbemerkt Logik ueberspringt — typisch in Hooks, Handlern, Middleware.
 *
 * Usage:
 *   yarn tsx scripts/guard-silent-skip.ts
 *
 * Exit 1 wenn Verstoesse gefunden, 0 wenn sauber.
 */

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Project, type Node, type ReturnStatement, type SourceFile, SyntaxKind } from "ts-morph";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const SCAN_GLOBS = [
  "packages/framework/src/**/*.ts",
  "packages/bundled-features/src/**/*.ts",
];

const EXCLUDE = /(__tests__|\.test\.ts$|\.integration\.ts$|\.d\.ts$)/;

export interface SkipSite {
  file: string;
  line: number;
  enclosingFunction: string;
  enclosingKind: "hook" | "handler" | "middleware" | "function" | "arrow" | "method";
  precedingText: string;
  commentsAbove?: string;
  snippet: string;
}

/**
 * Baut den Kontext fuer einen nackten return zusammen. Reine Datenextraktion —
 * keine Policy. Die Entscheidung "erlaubt oder nicht" faellt in isAllowed().
 */
function describeSite(ret: ReturnStatement, sourceFile: SourceFile): SkipSite {
  const enclosing = findEnclosingFunction(ret);
  const fnName = enclosing.name;
  const kind = classifyEnclosing(ret, enclosing.node);

  const prev = ret.getPreviousSibling();
  const precedingText = prev?.getText() ?? "";

  // Collect comments from multiple possible locations:
  //   1. Leading trivia on the return itself (`// skip:` on the line above a standalone return)
  //   2. Leading trivia on the enclosing IfStatement (`// skip:` before `if (x) return;`)
  //   3. Trailing comment on the previous sibling statement
  const comments: string[] = [];
  comments.push(...ret.getLeadingCommentRanges().map((r) => r.getText()));
  const enclosingIf = ret.getFirstAncestorByKind(SyntaxKind.IfStatement);
  if (enclosingIf && enclosingIf.getStartLineNumber() >= ret.getStartLineNumber() - 2) {
    comments.push(...enclosingIf.getLeadingCommentRanges().map((r) => r.getText()));
  }
  if (prev?.getTrailingCommentRanges) {
    comments.push(...prev.getTrailingCommentRanges().map((r) => r.getText()));
  }

  return {
    file: path.relative(ROOT, sourceFile.getFilePath()),
    line: ret.getStartLineNumber(),
    enclosingFunction: fnName,
    enclosingKind: kind,
    precedingText,
    commentsAbove: comments.join("\n"),
    snippet: ret.getText(),
  };
}

function findEnclosingFunction(node: Node): { node: Node; name: string } {
  let cur: Node | undefined = node.getParent();
  while (cur) {
    if (
      cur.isKind(SyntaxKind.FunctionDeclaration) ||
      cur.isKind(SyntaxKind.FunctionExpression) ||
      cur.isKind(SyntaxKind.ArrowFunction) ||
      cur.isKind(SyntaxKind.MethodDeclaration)
    ) {
      return { node: cur, name: guessName(cur) };
    }
    cur = cur.getParent();
  }
  return { node, name: "<top-level>" };
}

function guessName(fn: Node): string {
  if (fn.isKind(SyntaxKind.FunctionDeclaration) || fn.isKind(SyntaxKind.MethodDeclaration)) {
    return fn.getName() ?? "<anonymous>";
  }
  const parent = fn.getParent();
  if (parent?.isKind(SyntaxKind.VariableDeclaration)) return parent.getName();
  if (parent?.isKind(SyntaxKind.PropertyAssignment)) return parent.getName();
  const callExpr = parent?.isKind(SyntaxKind.CallExpression) ? parent : undefined;
  if (callExpr) return `${callExpr.getExpression().getText()}(...)`;
  return "<anonymous>";
}

function classifyEnclosing(_ret: ReturnStatement, fn: Node): SkipSite["enclosingKind"] {
  const text = fn.getParent()?.getText() ?? "";
  if (/\bhook\s*\(|postSave|preSave|validation/.test(text)) return "hook";
  if (/Handler\b|writeHandler|queryHandler/.test(text)) return "handler";
  if (/middleware|Middleware/.test(text)) return "middleware";
  if (fn.isKind(SyntaxKind.MethodDeclaration)) return "method";
  if (fn.isKind(SyntaxKind.ArrowFunction)) return "arrow";
  return "function";
}

// ---------------------------------------------------------------------------
// POLICY — von dir zu schreiben (siehe Kommentar unten)
// ---------------------------------------------------------------------------

/**
 * Policy: ein nacktes `return;` braucht eine der folgenden Markierungen
 * direkt davor — sonst wird es bemaengelt.
 *
 *   (a) Log-Call:     ctx.log?.debug(...), logger.debug(...), context.log?.info(...)
 *   (b) Skip-Comment: // skip: <grund>
 *   (c) Throw-Eskape: davor steht ein throw (return ist dead-code, sollte weg)
 *
 * (a) ist fuer Pipeline-Code mit ctx im Scope — der Skip ist zur Runtime
 * sichtbar. (b) ist fuer Utils ohne Logger-Zugriff — Dokumentation im Code.
 * (c) faengt die seltenen Faelle wo ein TS-Narrowing einen toten return stehen
 * laesst.
 */
function isAllowed(site: SkipSite): boolean {
  const preceding = site.precedingText;

  // (a) log call on ctx/context/opts.context or module-level logger
  if (/\b(?:\w+\.)?(?:log|logger)\??\.(?:debug|info|warn|error|trace)\s*\(/.test(preceding)) {
    return true;
  }

  // (b) explicit // skip: marker — check trailing comment on preceding OR leading on return
  if (/\/\/\s*skip:/i.test(preceding)) return true;
  if (hasLeadingSkipComment(site)) return true;

  // (c) preceding is a throw
  if (/^\s*throw\b/.test(preceding)) return true;

  return false;
}

function hasLeadingSkipComment(site: SkipSite): boolean {
  // The ts-morph scanner captures the previous sibling as precedingText, but
  // a `// skip:` comment directly above the return is a leading trivia on the
  // return statement itself — handled by describeSite via the `commentsAbove`
  // field below.
  return /\/\/\s*skip:/i.test(site.commentsAbove ?? "");
}

// ---------------------------------------------------------------------------
// Scanner + Reporter — kein Grund hier was zu aendern
// ---------------------------------------------------------------------------

function main(): void {
  const project = new Project({
    tsConfigFilePath: path.join(ROOT, "packages/framework/tsconfig.json"),
    skipAddingFilesFromTsConfig: true,
  });

  for (const glob of SCAN_GLOBS) {
    project.addSourceFilesAtPaths(path.join(ROOT, glob));
  }

  const violations: SkipSite[] = [];
  let scannedFiles = 0;
  let totalNakedReturns = 0;

  for (const sf of project.getSourceFiles()) {
    const file = sf.getFilePath();
    if (EXCLUDE.test(file)) continue;
    scannedFiles++;

    const returns = sf.getDescendantsOfKind(SyntaxKind.ReturnStatement);
    for (const ret of returns) {
      if (ret.getExpression()) continue; // hat einen Wert, nicht "silent"
      totalNakedReturns++;
      const site = describeSite(ret, sf);
      if (!isAllowed(site)) violations.push(site);
    }
  }

  console.log(`Silent-Skip Guard: ${scannedFiles} Dateien, ${totalNakedReturns} nackte returns gefunden.`);

  if (violations.length === 0) {
    console.log("  Keine bemaengelten Stellen.");
    return;
  }

  console.error(`\n  BLOCKED: ${violations.length} verdaechtige silent-skip Stellen:\n`);
  for (const v of violations) {
    console.error(`    ${v.file}:${v.line}  [${v.enclosingKind}] in ${v.enclosingFunction}`);
  }
  console.error("");
  process.exit(1);
}

main();
