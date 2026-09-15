#!/usr/bin/env bun
/**
 * Guard: finds "silent skip" spots in production code.
 *
 * A "silent skip" is a bare `return;` (no value) in code that skips logic
 * unnoticed — typical in hooks, handlers, middleware.
 *
 * Usage:
 *   bun guards/guard-silent-skip.ts
 *
 * Exit 1 on violations, 0 when clean.
 */

import * as path from "node:path";
import { type Node, type ReturnStatement, type SourceFile, SyntaxKind } from "ts-morph";
import { type AstGuard, runStandalone, type ScanSpec } from "./_lib/guard-kit";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts"],
  frameworkWithin: ["packages/*/src/**"],
};

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
 * Builds the context for a bare return. Pure data extraction — no policy.
 * The allow/deny decision happens in isAllowed().
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
// POLICY
// ---------------------------------------------------------------------------

/**
 * Policy: a bare `return;` needs one of the following markers right before it
 * — otherwise it is flagged.
 *
 *   (a) Log call:     ctx.log?.debug(...), logger.debug(...), context.log?.info(...)
 *   (b) Skip comment: // skip: <reason>
 *   (c) Throw escape: preceded by a throw (the return is dead code, should go)
 *
 * (a) is for pipeline code with ctx in scope — the skip is visible at
 * runtime. (b) is for utils without logger access — documentation in code.
 * (c) catches the rare cases where TS narrowing leaves a dead return behind.
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
  // a `// skip:` comment directly above the return is leading trivia on the
  // return statement itself — handled by describeSite via `commentsAbove`.
  return /\/\/\s*skip:/i.test(site.commentsAbove ?? "");
}

// ---------------------------------------------------------------------------
// Scanner + reporter
// ---------------------------------------------------------------------------

export const guard: AstGuard = {
  name: "Silent-Skip Guard",
  scan: SCAN,
  hint: "Nacktes `return;` braucht davor: Log-Call, `// skip: <grund>`-Kommentar, oder vorangehenden throw.",
  run(files) {
    const violations: Array<{ file: string; line: number; message: string }> = [];

    for (const sf of files) {
      const file = sf.getFilePath();
      if (EXCLUDE.test(file)) continue;

      const returns = sf.getDescendantsOfKind(SyntaxKind.ReturnStatement);
      for (const ret of returns) {
        if (ret.getExpression()) continue; // has a value, not "silent"
        const site = describeSite(ret, sf);
        if (isAllowed(site)) continue;
        violations.push({
          file: site.file,
          line: site.line,
          message: `[${site.enclosingKind}] in ${site.enclosingFunction}`,
        });
      }
    }

    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
