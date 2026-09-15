#!/usr/bin/env bun
/**
 * Guard: HTML-building template literals must escape every interpolation.
 *
 * XSS protection in this codebase is a callsite convention
 * (escapeHtml/escapeHtmlAttr from kumiko-headless) — this guard makes the
 * convention enforceable. A template literal counts as HTML-building when
 * its static text contains a known HTML/MJML/SVG tag. Every interpolation
 * inside it must then be recognizably safe:
 *
 *   - Call to escapeHtml / escapeHtmlAttr / escapeXml / raw
 *   - html`...` tagged template (the tag escapes itself)
 *   - Name ends in `Html` (convention: pre-rendered, already-escaped HTML)
 *   - UPPER_SNAKE constant (compile-time authored: CSS blocks, data URIs)
 *   - String-literal type or literal union (as-const copy tables, enums)
 *   - number/boolean type
 *   - Local variable whose initializer is itself safe; local function
 *     (its template literals are scanned independently)
 *   - `.join(...)` call (the joined fragments are their own template literals)
 *   - Ternary / ?? / || / && with uniformly safe branches
 *
 * Anything else — parameters, imports, property access on foreign data — is
 * a violation: potential stored/reflected XSS.
 *
 * Deliberate per-line exception: `// html-ok: <reason>` on the interpolation
 * line or the line above (e.g. error-message texts that only contain tag
 * snippets as text).
 *
 * Usage:
 *   bun guards/guard-html-escape.ts
 */

import * as path from "node:path";
import {
  type Identifier,
  Node,
  type SourceFile,
  SyntaxKind,
  type TemplateExpression,
  type Type,
} from "ts-morph";
import { type AstGuard, runStandalone, type ScanSpec } from "./_lib/guard-kit";

const ROOT = process.cwd();

const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts", "tsx"],
  frameworkWithin: ["packages/*/src/**"],
};

// tools/docgen: MDX/markdown codegen from its own sources, no runtime HTML.
const EXCLUDE =
  /(__tests__|__mocks__|\.test\.tsx?$|\.integration\.tsx?$|\.d\.ts$|\/escape\.ts$|\/html-template\.ts$|\/tools\/docgen\/)/;

// Only real HTML/MJML/SVG tags count — `<repo>` placeholders in CLI text or
// generics in strings should not fire.
const HTML_TAG =
  /<\/?(!doctype|html|head|body|title|meta|link|style|script|noscript|div|span|p|a|ul|ol|li|dl|dt|dd|table|thead|tbody|tfoot|tr|td|th|h[1-6]|br|hr|img|svg|path|rect|circle|text|g|strong|em|b|i|u|s|small|sub|sup|button|form|input|label|select|option|textarea|fieldset|legend|section|article|header|footer|nav|main|aside|figure|figcaption|blockquote|pre|code|iframe|video|audio|source|picture|details|summary|dialog|mj-[a-z-]+)[\s>/]/i;

// Guard boundary (deliberate, not a code fix): matches only the bare
// method/tag name, not the callee root — an arbitrary `obj.raw()`/
// `obj.escapeXml()` or a locally defined `raw()` without real escaping
// passes the gate. Likewise the guard does not distinguish text from
// attribute context: `escapeHtml()` in an attribute value
// (`href="${escapeHtml(url)}"`) counts as safe even though only
// `escapeHtmlAttr()` covers quote/attribute breakout.
const SAFE_CALL_NAMES = new Set(["escapeHtml", "escapeHtmlAttr", "escapeXml", "raw"]);

const SAFE_TEMPLATE_TAGS = new Set(["html", "raw"]);

const UPPER_SNAKE = /^[A-Z][A-Z0-9_]*$/;

const MAX_RESOLVE_DEPTH = 6;

function templateStaticText(tpl: Node): string {
  if (tpl.isKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    return tpl.getLiteralText();
  }
  const t = tpl as TemplateExpression;
  return [
    t.getHead().getLiteralText(),
    ...t.getTemplateSpans().map((s) => s.getLiteral().getLiteralText()),
  ].join("\n");
}

function isCompileTimeKnownType(type: Type): boolean {
  if (
    type.isNumber() ||
    type.isBoolean() ||
    type.isBooleanLiteral() ||
    type.isNumberLiteral() ||
    type.isStringLiteral() ||
    type.isEnumLiteral() ||
    type.isUndefined() ||
    type.isNull()
  ) {
    return true;
  }
  if (type.isUnion()) {
    return type.getUnionTypes().every(isCompileTimeKnownType);
  }
  return false;
}

function endsWithHtmlConvention(expr: Node): boolean {
  if (expr.isKind(SyntaxKind.Identifier)) return /Html$/.test(expr.getText());
  if (expr.isKind(SyntaxKind.PropertyAccessExpression)) {
    return /Html$/.test(expr.getNameNode().getText());
  }
  return false;
}

// Import declarations live in the same file AST-wise — but they don't count
// as local (the value comes from outside).
const IMPORT_DECL_KINDS = new Set<SyntaxKind>([
  SyntaxKind.ImportSpecifier,
  SyntaxKind.ImportClause,
  SyntaxKind.NamespaceImport,
  SyntaxKind.ImportEqualsDeclaration,
]);

function localDeclarations(ident: Identifier, sf: SourceFile): Node[] {
  const decls = ident.getSymbol()?.getDeclarations() ?? [];
  if (decls.length === 0) return [];
  const allLocal = decls.every(
    (d) =>
      d.getSourceFile() === sf &&
      !IMPORT_DECL_KINDS.has(d.getKind()) &&
      !d.isKind(SyntaxKind.Parameter),
  );
  return allLocal ? decls : [];
}

function isSafeLocalIdentifier(ident: Identifier, sf: SourceFile, depth: number): boolean {
  const decls = localDeclarations(ident, sf);
  if (decls.length === 0) return false;
  return decls.every((d) => {
    if (
      d.isKind(SyntaxKind.FunctionDeclaration) ||
      d.isKind(SyntaxKind.ClassDeclaration) ||
      d.isKind(SyntaxKind.EnumDeclaration)
    ) {
      return true;
    }
    if (d.isKind(SyntaxKind.VariableDeclaration)) {
      const init = d.getInitializer();
      if (!init) return false;
      if (init.isKind(SyntaxKind.ArrowFunction) || init.isKind(SyntaxKind.FunctionExpression)) {
        return true;
      }
      return isSafeExpression(init, sf, depth + 1);
    }
    return false;
  });
}

function calleeRootIdentifier(expr: Node): Identifier | undefined {
  let cur = expr;
  while (cur.isKind(SyntaxKind.PropertyAccessExpression)) {
    cur = cur.getExpression();
  }
  return cur.isKind(SyntaxKind.Identifier) ? (cur as Identifier) : undefined;
}

function isSafeExpression(expr: Node, sf: SourceFile, depth: number): boolean {
  if (depth > MAX_RESOLVE_DEPTH) return false;
  if (expr.isKind(SyntaxKind.ParenthesizedExpression)) {
    return isSafeExpression(expr.getExpression(), sf, depth + 1);
  }
  if (
    expr.isKind(SyntaxKind.StringLiteral) ||
    expr.isKind(SyntaxKind.NumericLiteral) ||
    expr.isKind(SyntaxKind.TrueKeyword) ||
    expr.isKind(SyntaxKind.FalseKeyword)
  ) {
    return true;
  }
  // Nested template literals are scanned as their own candidates.
  if (
    expr.isKind(SyntaxKind.TemplateExpression) ||
    expr.isKind(SyntaxKind.NoSubstitutionTemplateLiteral) ||
    expr.isKind(SyntaxKind.TaggedTemplateExpression)
  ) {
    return true;
  }
  if (expr.isKind(SyntaxKind.ConditionalExpression)) {
    return (
      isSafeExpression(expr.getWhenTrue(), sf, depth + 1) &&
      isSafeExpression(expr.getWhenFalse(), sf, depth + 1)
    );
  }
  if (expr.isKind(SyntaxKind.BinaryExpression)) {
    const op = expr.getOperatorToken().getKind();
    if (
      op === SyntaxKind.QuestionQuestionToken ||
      op === SyntaxKind.BarBarToken ||
      op === SyntaxKind.AmpersandAmpersandToken
    ) {
      return (
        isSafeExpression(expr.getLeft(), sf, depth + 1) &&
        isSafeExpression(expr.getRight(), sf, depth + 1)
      );
    }
    // Arithmetic (`${width / 2}`) is safe as long as the result type is number.
    return isCompileTimeKnownType(expr.getType());
  }
  if (endsWithHtmlConvention(expr)) return true;
  if (expr.isKind(SyntaxKind.CallExpression)) {
    const callee = expr.getExpression();
    const name = callee.isKind(SyntaxKind.PropertyAccessExpression)
      ? callee.getNameNode().getText()
      : callee.getText();
    if (SAFE_CALL_NAMES.has(name)) return true;
    // `.join(...)` is only safe when the joined array itself consists of
    // safe fragments (e.g. arr.map(x => escapeHtml(x)).join("")) — a raw
    // `stringArray.join("")` from foreign data (parameter/import) was
    // previously treated as unconditionally safe, a real bypass.
    if (name === "join" && callee.isKind(SyntaxKind.PropertyAccessExpression)) {
      const receiver = callee.getExpression();
      if (receiver.isKind(SyntaxKind.CallExpression)) {
        const receiverCallee = receiver.getExpression();
        const receiverName = receiverCallee.isKind(SyntaxKind.PropertyAccessExpression)
          ? receiverCallee.getNameNode().getText()
          : receiverCallee.getText();
        if (receiverName === "map") {
          const mapCallback = receiver.getArguments()[0];
          if (
            mapCallback &&
            (mapCallback.isKind(SyntaxKind.ArrowFunction) ||
              mapCallback.isKind(SyntaxKind.FunctionExpression))
          ) {
            const body = mapCallback.getBody();
            if (Node.isBlock(body)) {
              const stmts = body.getStatements();
              const only = stmts.length === 1 ? stmts[0] : undefined;
              const ret = only && Node.isReturnStatement(only) ? only.getExpression() : undefined;
              if (ret && isSafeExpression(ret, sf, depth + 1)) return true;
            } else if (isSafeExpression(body, sf, depth + 1)) {
              return true;
            }
          }
        }
      }
    }
    if (endsWithHtmlConvention(callee)) return true;
    const root = calleeRootIdentifier(callee);
    if (root && isSafeLocalIdentifier(root, sf, depth)) return true;
    return isCompileTimeKnownType(expr.getType());
  }
  if (expr.isKind(SyntaxKind.Identifier)) {
    const ident = expr as Identifier;
    if (UPPER_SNAKE.test(ident.getText())) return true;
    if (isSafeLocalIdentifier(ident, sf, depth)) return true;
    return isCompileTimeKnownType(expr.getType());
  }
  if (
    expr.isKind(SyntaxKind.PropertyAccessExpression) ||
    expr.isKind(SyntaxKind.ElementAccessExpression)
  ) {
    return isCompileTimeKnownType(expr.getType());
  }
  return false;
}

// Error messages contain HTML only as text (`<div id="${rootId}"> not
// found`) — they are never rendered.
function isInsideErrorConstruction(tpl: Node): boolean {
  let cur: Node | undefined = tpl.getParent();
  while (cur && !Node.isStatement(cur)) {
    if (cur.isKind(SyntaxKind.NewExpression)) {
      const name = cur.getExpression().getText();
      if (/Error$/.test(name)) return true;
    }
    cur = cur.getParent();
  }
  return cur?.isKind(SyntaxKind.ThrowStatement) ?? false;
}

function isInsideSafeTag(tpl: Node): boolean {
  const parent = tpl.getParent();
  if (!parent?.isKind(SyntaxKind.TaggedTemplateExpression)) return false;
  const tag = parent.getTag();
  const name = tag.isKind(SyntaxKind.PropertyAccessExpression)
    ? tag.getNameNode().getText()
    : tag.getText();
  return SAFE_TEMPLATE_TAGS.has(name);
}

function hasHtmlOkComment(lines: readonly string[], line: number): boolean {
  const current = lines[line - 1] ?? "";
  const previous = lines[line - 2] ?? "";
  return current.includes("html-ok:") || previous.includes("html-ok:");
}

interface UnsafeSite {
  file: string;
  line: number;
  snippet: string;
}

function scanFile(sf: SourceFile): UnsafeSite[] {
  const sites: UnsafeSite[] = [];
  let lines: string[] | undefined;
  for (const tpl of sf.getDescendantsOfKind(SyntaxKind.TemplateExpression)) {
    if (!HTML_TAG.test(templateStaticText(tpl))) continue;
    if (isInsideSafeTag(tpl)) continue;
    if (isInsideErrorConstruction(tpl)) continue;
    for (const span of tpl.getTemplateSpans()) {
      const expr = span.getExpression();
      if (isSafeExpression(expr, sf, 0)) continue;
      const line = expr.getStartLineNumber();
      lines ??= sf.getFullText().split("\n");
      if (hasHtmlOkComment(lines, line)) continue;
      sites.push({
        file: path.relative(ROOT, sf.getFilePath()),
        line,
        snippet: expr.getText().slice(0, 80),
      });
    }
  }
  return sites;
}

export const guard: AstGuard = {
  name: "HTML-Escape Guard",
  scan: SCAN,
  hint: "Interpolation in HTML-Template-Literal escapen: escapeHtml()/escapeHtmlAttr() aus @cosmicdrift/kumiko-headless. Vorgerendertes HTML per `*Html`-Namen kennzeichnen; statische Copy-Tabellen `as const` typen; bewusste Ausnahme mit `// html-ok: <warum>`.",
  run(files) {
    const violations: Array<{ file: string; line: number; message: string }> = [];
    for (const sf of files) {
      if (EXCLUDE.test(sf.getFilePath())) continue;
      for (const site of scanFile(sf)) {
        violations.push({
          file: site.file,
          line: site.line,
          message: `unescaped interpolation in HTML template — \${${site.snippet}}`,
        });
      }
    }
    return { violations };
  },
};

if (import.meta.main) runStandalone(guard);
