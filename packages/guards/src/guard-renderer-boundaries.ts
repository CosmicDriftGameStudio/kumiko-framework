#!/usr/bin/env bun
/**
 * Guard: prevents `@cosmicdrift/kumiko-renderer` (shared, platform-neutral)
 * from touching DOM- or platform-specific APIs. As soon as window/document/
 * EventSource/react-dom show up, the separation is broken and the code
 * belongs in `@cosmicdrift/kumiko-renderer-web` (or renderer-native) instead.
 *
 * Deliberately simple: a regex scan over the source text. False positives
 * (e.g. "window" in a string literal) are possible but rare — the guard is a
 * maintenance alarm, not a semantic proof.
 *
 * Checked:
 *   - Imports:  react-dom/*, jsdom, @cosmicdrift/kumiko-renderer-web, @cosmicdrift/kumiko-renderer-native
 *   - Symbols:  window., document., location., history., localStorage,
 *               sessionStorage, navigator., EventSource, fetch
 *               (bare — unqualified)
 *
 * __tests__ folders are excluded — tests mount in jsdom, that's expected.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { type RepoCheck, reportResults, runRepoChecks } from "./_lib/guard-kit";

// Imports that are taboo in the shared layer.
const FORBIDDEN_IMPORTS = [
  /from ["']react-dom(?:\/.*)?["']/,
  /from ["']jsdom["']/,
  /from ["']@cosmicdrift\/kumiko-renderer-web["']/,
  /from ["']@cosmicdrift\/kumiko-renderer-native["']/,
  /from ["']@cosmicdrift\/kumiko-dispatcher-live["']/,
];

// Runtime symbols that mean DOM/browser. `\b` prevents substring matches
// (e.g. "origin" not matched as "origin.foo"). This is a coarse guard — a
// ts-morph-based check would be more precise, but not worth the effort here.
const FORBIDDEN_SYMBOLS = [
  /\bwindow\s*\./,
  /\bdocument\s*\./,
  /\blocation\s*\./,
  /\bhistory\s*\./,
  /\blocalStorage\b/,
  /\bsessionStorage\b/,
  /\bnavigator\s*\./,
  /\bEventSource\b/,
  /\bHTMLElement\b/,
  /\bcreateRoot\b/,
];

// JSX elements with a lowercase name = HTML tags (React convention:
// lowercase = intrinsic DOM element, Capitalized = component). The shared
// renderer must not emit DOM tags — everything goes through primitives,
// which are platform-bound.
//
// Match: `<tagname` at the start of a JSX opening, with a lowercase letter.
// Ignored: fragment `<>`, components `<Capitalized`, attribute values like
// `<string>` in a type-annotation context (the regex only matches right
// after whitespace/newline/>, not after an identifier character).
const FORBIDDEN_JSX_TAG = /(^|\s|>|\()<([a-z][a-zA-Z0-9-]*)[\s/>]/;

type Violation = {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly excerpt: string;
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      out.push(...walk(full));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

export function findViolations(file: string, root: string): Violation[] {
  const text = fs.readFileSync(file, "utf-8");
  const lines = text.split("\n");
  const violations: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Skip comments. Pure heuristic — multi-line block comments aren't
    // caught. Good enough for source that doesn't jsdoc-block-paste 'window.*' as prose.
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    for (const pattern of FORBIDDEN_IMPORTS) {
      if (pattern.test(line)) {
        violations.push({
          file: path.relative(root, file),
          line: i + 1,
          rule: "forbidden-import",
          excerpt: trimmed,
        });
      }
    }
    for (const pattern of FORBIDDEN_SYMBOLS) {
      if (pattern.test(line)) {
        violations.push({
          file: path.relative(root, file),
          line: i + 1,
          rule: "forbidden-symbol",
          excerpt: trimmed,
        });
      }
    }
    const jsxMatch = line.match(FORBIDDEN_JSX_TAG);
    if (jsxMatch !== null) {
      violations.push({
        file: path.relative(root, file),
        line: i + 1,
        rule: `forbidden-jsx-tag (<${jsxMatch[2]}>)`,
        excerpt: trimmed,
      });
    }
  }
  return violations;
}

export const check: RepoCheck = {
  name: "Renderer-Boundaries Guard",
  hint: "@cosmicdrift/kumiko-renderer must not use DOM/browser/platform APIs. Platform-specific code belongs in @cosmicdrift/kumiko-renderer-web (or renderer-native).",
  run(roots) {
    const frameworkRoots = roots.filter((r) => r.kind === "framework");
    const scanDirs = frameworkRoots
      .map((r) => path.join(r.absPath, "packages/renderer/src"))
      .filter((p) => fs.existsSync(p));
    if (scanDirs.length === 0) {
      return { violations: [], matchedFiles: 0, notApplicable: true };
    }
    const files: string[] = [];
    for (const dir of scanDirs) files.push(...walk(dir));
    const root = frameworkRoots[0]?.absPath ?? process.cwd();
    const violations = files.flatMap((file) =>
      findViolations(file, root).map((v) => ({
        file: v.file,
        line: v.line,
        message: `[${v.rule}] ${v.excerpt}`,
      })),
    );
    return { violations, matchedFiles: files.length, notApplicable: false };
  },
};

if (import.meta.main) {
  const failed = reportResults(await runRepoChecks([check]));
  process.exit(failed > 0 ? 1 : 0);
}
