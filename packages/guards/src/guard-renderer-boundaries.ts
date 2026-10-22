#!/usr/bin/env bun
/**
 * Guard: prevents `@cosmicdrift/kumiko-renderer` (shared, platform-neutral)
 * from touching DOM- or platform-specific APIs. As soon as window/document/
 * EventSource/react-dom show up, the separation is broken and the code
 * belongs in `src/web` instead.
 *
 * `src/web/**` is the browser layer and not scanned at all: it may import
 * everything. `src/headless/**`, `src/flow-diagram/**` and `src/live/**` only get
 * the import rules: the apex page builder emits HTML strings, the flow diagram
 * emits SVG strings and the live dispatcher is a fetch client, so the symbol and JSX-tag rules would be noise there. They stay free
 * of react-dom, jsdom and any import of `src/web`.
 *
 * `headless` additionally may not import react, the renderer root or anything outside its own
 * folder (server/mail bundles import it); the shared layer may not import `live`.
 *
 * Deliberately simple: a regex scan over the source text. False positives
 * (e.g. "window" in a string literal) are possible but rare — the guard is a
 * maintenance alarm, not a semantic proof.
 *
 * Checked:
 *   - Imports:  react-dom/*, jsdom, `src/web` (relative or as
 *               @cosmicdrift/kumiko-renderer/web), and the deprecated renderer-web /
 *               headless / dispatcher-live shims (they depend on this package)
 *   - Symbols:  window., document., location., history., localStorage,
 *               sessionStorage, navigator., EventSource, fetch(
 *               (bare — unqualified), HTMLElement, createRoot
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
  /from ["']@cosmicdrift\/kumiko-renderer-web(?:\/.*)?["']/,
  /from ["']@cosmicdrift\/kumiko-renderer\/web(?:\/.*)?["']/,
  /from ["'](?:\.\.?\/)+web(?:\/.*)?["']/,
  /from ["']@cosmicdrift\/kumiko-headless(?:\/.*)?["']/,
  /from ["']@cosmicdrift\/kumiko-dispatcher-live["']/,
];

// `headless` is consumed server-side (prod bundle, mail HTML): it must stay free of React and of
// the shared layer, so it may only import itself and third-party packages other than react.
const HEADLESS_FORBIDDEN_IMPORTS = [
  /from ["']react(?:\/.*)?["']/,
  /from ["']@cosmicdrift\/kumiko-renderer(?:\/(?!headless(?:["'/]))[^"']*)?["']/,
];

// The fetch/document.cookie dispatcher client belongs to consumers of `live`, not the shared layer.
const SHARED_FORBIDDEN_IMPORTS = [
  /from ["'](?:\.\.?\/)+live(?:\/.*)?["']/,
  /from ["']@cosmicdrift\/kumiko-renderer\/live(?:\/.*)?["']/,
];

// dev-console.ts is a dependency-free console wrapper, safe in server bundles.
const HEADLESS_ALLOWED_LEAF = /(?:^|\/)dev-console(?:\.ts)?$/;

const RELATIVE_SPECIFIER = /from ["'](\.\.?\/[^"']*)["']/;

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
  /(?<![.\w])fetch\s*\(/,
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
const FORBIDDEN_JSX_TAG = /(^|\s|>|\()<([a-z][a-zA-Z0-9-]*)(?=[\s/>])/g;

// Subtrees of packages/renderer/src that carry only the import rules.
const IMPORT_RULES_ONLY_DIRS = ["headless", "flow-diagram", "live"] as const;

// The browser layer may import anything, so it is not scanned.
const UNSCANNED_TOP_LEVEL_DIRS = ["web"] as const;

type Violation = {
  readonly file: string;
  readonly line: number;
  readonly rule: string;
  readonly excerpt: string;
};

const RENDERER_SRC = `${path.sep}packages${path.sep}renderer${path.sep}src${path.sep}`;

// Absolute path of `packages/renderer/src/<dir>` containing `file`, or "" when it is elsewhere.
function rendererSrcSubdir(file: string, dir: string): string {
  const marker = `${RENDERER_SRC}${dir}${path.sep}`;
  const index = file.indexOf(marker);
  return index === -1 ? "" : file.slice(0, index + marker.length - 1);
}

function isInside(dir: string, target: string): boolean {
  return target === dir || target.startsWith(dir + path.sep);
}

function escapesHeadless(file: string, line: string): boolean {
  const headlessDir = rendererSrcSubdir(file, "headless");
  const specifier = RELATIVE_SPECIFIER.exec(line)?.[1];
  if (headlessDir === "" || specifier === undefined) return false;
  if (HEADLESS_ALLOWED_LEAF.test(specifier)) return false;
  return !isInside(headlessDir, path.resolve(path.dirname(file), specifier));
}

function isSharedLayer(file: string): boolean {
  return (
    file.includes(RENDERER_SRC) &&
    ["headless", "live", "web"].every((dir) => rendererSrcSubdir(file, dir) === "")
  );
}

function walk(dir: string, skippedDirs: readonly string[] = []): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      if (skippedDirs.includes(entry.name)) continue;
      out.push(...walk(full));
      continue;
    }
    if (entry.isFile() && /\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

export function findViolations(file: string, root: string, importRulesOnly = false): Violation[] {
  const text = fs.readFileSync(file, "utf-8");
  const lines = text.split("\n");
  const violations: Violation[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    // Skip comments. Pure heuristic — multi-line block comments aren't
    // caught. Good enough for source that doesn't jsdoc-block-paste 'window.*' as prose.
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;

    const importPatterns = [
      ...FORBIDDEN_IMPORTS,
      ...(rendererSrcSubdir(file, "headless") !== "" ? HEADLESS_FORBIDDEN_IMPORTS : []),
      ...(isSharedLayer(file) ? SHARED_FORBIDDEN_IMPORTS : []),
    ];
    if (importPatterns.some((pattern) => pattern.test(line)) || escapesHeadless(file, line)) {
      violations.push({
        file: path.relative(root, file),
        line: i + 1,
        rule: "forbidden-import",
        excerpt: trimmed,
      });
    }
    if (importRulesOnly) continue;
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
    for (const jsxMatch of line.matchAll(FORBIDDEN_JSX_TAG)) {
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

function isImportRulesOnly(file: string): boolean {
  return IMPORT_RULES_ONLY_DIRS.some((dir) =>
    file.includes(
      `${path.sep}packages${path.sep}renderer${path.sep}src${path.sep}${dir}${path.sep}`,
    ),
  );
}

export const check: RepoCheck = {
  name: "Renderer-Boundaries Guard",
  hint: "@cosmicdrift/kumiko-renderer must not use DOM/browser/platform APIs. Platform-specific code belongs in packages/renderer/src/web.",
  run(roots) {
    const frameworkRoots = roots.filter((r) => r.kind === "framework");
    const scanDirs = frameworkRoots
      .map((r) => path.join(r.absPath, "packages/renderer/src"))
      .filter((p) => fs.existsSync(p));
    if (scanDirs.length === 0) {
      return { violations: [], matchedFiles: 0, notApplicable: true };
    }
    const files: string[] = [];
    for (const dir of scanDirs) files.push(...walk(dir, UNSCANNED_TOP_LEVEL_DIRS));
    const root = frameworkRoots[0]?.absPath ?? process.cwd();
    const violations = files.flatMap((file) =>
      findViolations(file, root, isImportRulesOnly(file)).map((v) => ({
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
