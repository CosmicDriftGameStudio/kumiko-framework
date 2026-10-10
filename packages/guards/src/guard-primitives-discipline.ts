#!/usr/bin/env bun
/**
 * Guard: enforces that app-/feature-web code uses UI building blocks from
 * the framework primitives, not hand-rolled Tailwind on raw HTML tags.
 *
 * Why: hand-rolled Tailwind in `web/` folders costs twice:
 *   1. Style drift — every renderer/theme update then has to be re-applied
 *      to each hand-tailwound screen individually.
 *   2. Multi-platform lock-out — native (renderer-native) has no
 *      `<table>`, `<form>`, `<button>`. Direct DOM tags bind the code to
 *      web. Framework primitives (`<DataTable>`, `<Form>`, `<Button>`) are
 *      contractually platform-neutral.
 *
 * Forbidden in app-/feature-web code:
 *
 *   <table>/<thead>/<tbody>/<tr>/<td>/<th>  →  <DataTable>
 *   <form>                                  →  <Form>
 *   <input>                                 →  <Input> (in <Field>)
 *   <button>                                →  <Button>
 *   <select>                                →  <ComboboxInput>
 *   <textarea>                              →  <Input kind="textarea">
 *   <dialog>                                →  <DefaultDialog>
 *   alert() / window.alert()               →  <DefaultDialog> from @cosmicdrift/kumiko-renderer-web
 *   className "bg-card" (hand-rolled card) →  <Card> (slots/options)
 *   className "mx-auto" + "max-w-*" (hand-rolled screen container)
 *                                           →  <PageSection maxWidth> (3xl/4xl/full)
 *
 * Allowed: containers and text — `<div>`, `<span>`, `<section>`,
 *   `<header>`, `<main>`, `<nav>`, `<aside>`, `<article>`,
 *   `<h1>`-`<h6>`, `<p>`, `<ul>`, `<ol>`, `<li>`, `<a>`, `<img>`,
 *   `<svg>`, `<label>`, `<small>`, `<strong>`, `<em>`, `<br>`, `<hr>`,
 *   `<pre>`, `<code>`.
 *
 * `__tests__` folders are excluded. Per-line override:
 *   `// kumiko-lint-ignore primitives-discipline <reason>`
 *   (on the same line or the line directly above).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { type RepoCheck, reportResults, runRepoChecks } from "./_lib/guard-kit";
import { lineHasIgnoreTag } from "./_lib/ignore-tag";
import { isFlatSrcLayout, type RepoRoot, sourceRootDirs } from "./_lib/roots";

const FORBIDDEN_TAGS: ReadonlyArray<{
  readonly tag: string;
  readonly counterpart: string;
}> = [
  { tag: "table", counterpart: "<DataTable>" },
  { tag: "thead", counterpart: "<DataTable>" },
  { tag: "tbody", counterpart: "<DataTable>" },
  { tag: "tr", counterpart: "<DataTable>" },
  { tag: "td", counterpart: "<DataTable>" },
  { tag: "th", counterpart: "<DataTable>" },
  { tag: "form", counterpart: "<Form>" },
  { tag: "input", counterpart: "<Input> (via <Field>)" },
  { tag: "button", counterpart: "<Button>" },
  { tag: "select", counterpart: "<ComboboxInput>" },
  { tag: "textarea", counterpart: '<Input kind="textarea">' },
  { tag: "dialog", counterpart: "<DefaultDialog>" },
];

const FORBIDDEN_CALLS: ReadonlyArray<{
  readonly call: string;
  readonly counterpart: string;
}> = [{ call: "alert", counterpart: "<DefaultDialog> from @cosmicdrift/kumiko-renderer-web" }];

// Forbidden className tokens: an allowed tag (`<div>`), but the class gives
// away hand-rolled primitive chrome. `bg-card` is the dedicated card-surface
// token — seeing it in a className means a hand-rebuilt card instead of
// `<Card>` (slots/options). Exactly the copy-paste drift the Card primitive
// is meant to eliminate. Real exceptions (foundation token swatches,
// navigation surfaces) carry `// kumiko-lint-ignore primitives-discipline`.
const FORBIDDEN_CLASSES: ReadonlyArray<{
  readonly token: string;
  readonly counterpart: string;
}> = [{ token: "bg-card", counterpart: "<Card>" }];

// Hand-rolled screen container: `mx-auto` and a `max-w-*` token in the same
// line. Screens get their width from `<PageSection maxWidth>`; a private
// container drifts from the shell (an ai-models screen rendered 896px wide).
const SCREEN_CONTAINER_LABEL = "mx-auto + max-w-*";
const SCREEN_CONTAINER_COUNTERPART = "<PageSection maxWidth> (3xl/4xl/full)";
const MX_AUTO_PATTERN = /(?<![\w-])mx-auto(?![\w-])/u;
// Arbitrary values (`max-w-[1100px]`) contain `[`/`]`/`.`, so the token body
// is any non-whitespace/non-quote run.
const MAX_W_PATTERN = /(?<![\w-])max-w-[^\s"'`}]+/u;

const IGNORE_TAG = "kumiko-lint-ignore primitives-discipline";

export type ScopeKind = "bundled-features" | "samples" | "app";

type ScanScope = {
  readonly kind: ScopeKind;
  readonly root: string;
  /** Repo root the reported file labels are relative to. */
  readonly repoRoot: string;
};

// Framework checkout enforces bundled-features + samples. App-repo checkout
// scans the app's web/ screens — primitives-discipline as a ratchet per app
// repo (infra#224). Every other resolved repo (enterprise, platform, ...)
// scans alongside the others in one run — flatMap all of them instead of
// cascading, which would silently skip every root after the first, exactly
// the silent-skip this guard fixes.
function resolveScopes(roots: readonly RepoRoot[]): ScanScope[] {
  const frameworkRoot = roots.find((r) => r.kind === "framework");
  if (frameworkRoot) {
    const repoRoot = frameworkRoot.absPath;
    return [
      {
        kind: "bundled-features",
        root: path.join(repoRoot, "packages/bundled-features/src"),
        repoRoot,
      },
      { kind: "samples", root: path.join(repoRoot, "samples"), repoRoot },
    ];
  }
  const appRoots = roots.filter((r) => r.kind === "app" && isFlatSrcLayout(r));
  if (appRoots.length > 0) {
    return appRoots.map((r) => ({
      kind: "app" as const,
      root: path.join(r.absPath, "src"),
      repoRoot: r.absPath,
    }));
  }
  return roots
    .filter((r) => r.kind !== "framework" && !isFlatSrcLayout(r))
    .flatMap((r) =>
      sourceRootDirs(r).map((root) => ({ kind: "app" as const, root, repoRoot: r.absPath })),
    );
}

type Violation = {
  readonly file: string;
  readonly line: number;
  readonly kind: "tag" | "call" | "class";
  readonly tag: string;
  readonly counterpart: string;
  readonly excerpt: string;
  readonly scope: ScopeKind;
};

function isWebFile(absPath: string, scopeRoot: string): boolean {
  // Only .tsx files under a `web/`, `client/` or `public/` path segment
  // (`client` = enterprise ai-foundation keeps its web code there; prevents
  // scanning random .tsx in screens/ or feature roots — those are schema
  // definitions, not web code).
  if (!absPath.endsWith(".tsx")) return false;
  const rel = path.relative(scopeRoot, absPath);
  const parts = rel.split(path.sep);
  return parts.includes("web") || parts.includes("client") || parts.includes("public");
}

function walk(dir: string, out: string[]): void {
  // skip: not every scope has every candidate directory
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      if (entry.name === "node_modules") continue;
      if (entry.name === "dist") continue;
      walk(full, out);
      continue;
    }
    if (entry.isFile()) out.push(full);
  }
}

function buildTagPattern(tag: string): RegExp {
  // Match `<tag` at the JSX opening: at line start or after a char that can't
  // end an identifier/member access (`cond?<input/>:<div/>` hits, `Array<input` doesn't).
  // Negative lookahead `[a-zA-Z0-9-]` so `<input` doesn't match `<inputfoo`.
  // Doesn't match the closing tag (`</tag>`) — that would be redundant.
  return new RegExp(`(^|[^\\w$.])<${tag}(?![a-zA-Z0-9-])`, "u");
}

const TAG_PATTERNS = FORBIDDEN_TAGS.map((t) => ({ ...t, pattern: buildTagPattern(t.tag) }));

// Match `alert(` and `window.alert(` — the native browser dialog is forbidden.
const CALL_PATTERNS = FORBIDDEN_CALLS.map((c) => ({
  ...c,
  // Lookbehind instead of \b: \b also matches after a dot — `toast.alert(`
  // would otherwise be a hit. window.alert( stays deliberately forbidden.
  pattern: new RegExp(`(?<![.\\w$])(?:window\\.)?${c.call}\\s*\\(`, "u"),
}));

// `\b` alone isn't enough: `-` is itself a non-word character, so
// `\bbg-card\b` also matches as a substring in a longer hyphen-prefixed
// token (e.g. a hypothetical `my-bg-card`). A lookaround against word
// characters AND `-` on both sides keeps `bg-card` exact, without losing
// `hover:bg-card`/`bg-card/40`.
const CLASS_PATTERNS = FORBIDDEN_CLASSES.map((c) => ({
  ...c,
  pattern: new RegExp(`(?<![\\w-])${c.token}(?![\\w-])`, "u"),
}));

function isPublicPage(file: string): boolean {
  // Public pages live outside the app shell; PublicShell is their container,
  // so a centered max-width there is not a screen container.
  return file.split(path.sep).includes("public");
}

function hasIgnore(currentLine: string, prevLine: string): boolean {
  return lineHasIgnoreTag(currentLine, IGNORE_TAG) || lineHasIgnoreTag(prevLine, IGNORE_TAG);
}

export function checkFile(
  file: string,
  scope: ScopeKind,
  root: string = process.cwd(),
): Violation[] {
  const text = fs.readFileSync(file, "utf-8");
  const lines = text.split("\n");
  const violations: Violation[] = [];
  const publicPage = isPublicPage(path.relative(root, file));
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();
    // Block-comment tracking (heuristic): `/* ... */` across multiple lines.
    // Single-line `//` and `*` (inside /* */) are skipped.
    if (inBlockComment) {
      if (trimmed.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
      inBlockComment = true;
      continue;
    }
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    // Strip trailing inline comments — `foo(); // alert() would be wrong`
    // must not match. (?<!:) leaves URLs (https://…) in strings alone;
    // string contents themselves stay an accepted heuristic gap.
    const codeOnly = line.replace(/(?<!:)\/\/.*$/u, "");

    const prev = i > 0 ? (lines[i - 1] ?? "") : "";
    if (hasIgnore(line, prev)) continue;

    for (const { tag, counterpart, pattern } of TAG_PATTERNS) {
      if (pattern.test(codeOnly)) {
        violations.push({
          file: path.relative(root, file),
          line: i + 1,
          kind: "tag",
          tag,
          counterpart,
          excerpt: trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed,
          scope,
        });
      }
    }
    for (const { call, counterpart, pattern } of CALL_PATTERNS) {
      if (pattern.test(codeOnly)) {
        violations.push({
          file: path.relative(root, file),
          line: i + 1,
          kind: "call",
          tag: call,
          counterpart,
          excerpt: trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed,
          scope,
        });
      }
    }
    for (const { token, counterpart, pattern } of CLASS_PATTERNS) {
      if (pattern.test(codeOnly)) {
        violations.push({
          file: path.relative(root, file),
          line: i + 1,
          kind: "class",
          tag: token,
          counterpart,
          excerpt: trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed,
          scope,
        });
      }
    }
    if (!publicPage && MX_AUTO_PATTERN.test(codeOnly) && MAX_W_PATTERN.test(codeOnly)) {
      violations.push({
        file: path.relative(root, file),
        line: i + 1,
        kind: "class",
        tag: SCREEN_CONTAINER_LABEL,
        counterpart: SCREEN_CONTAINER_COUNTERPART,
        excerpt: trimmed.length > 120 ? `${trimmed.slice(0, 117)}...` : trimmed,
        scope,
      });
    }
  }
  return violations;
}

function violationMessage(v: Violation): string {
  const label =
    v.kind === "call" ? `${v.tag}()` : v.kind === "class" ? `class "${v.tag}"` : `<${v.tag}>`;
  return `${label}  →  ${v.counterpart}  |  ${v.excerpt}`;
}

const HINT =
  "Migration: usePrimitives() in a custom screen component, or schema-driven via EntityListScreenDefinition / EntityEditScreenDefinition where possible. Per-line override: // kumiko-lint-ignore primitives-discipline <reason>";

export const check: RepoCheck = {
  name: "Primitives-Discipline Guard",
  hint: HINT,
  run(roots) {
    const scopes = resolveScopes(roots);
    if (scopes.length === 0) {
      // infra exits 1 here ("neither FRAMEWORK_ROOT, APP_ROOT nor any other
      // repo root resolved") — the vacuity floor below reproduces that.
      return { violations: [], matchedFiles: 0, notApplicable: false };
    }
    // Pre-filter count (every file walk() found, before the web/-segment
    // filter): an app repo whose screens are schema-driven with zero
    // web/*.tsx (phronexsis before its first screen) must not be flagged as
    // vacuous just because isWebFile() legitimately matched nothing.
    let walkedFiles = 0;
    const violations: { file: string; line: number; message: string }[] = [];
    const warnings: { file: string; line: number; message: string }[] = [];

    for (const scope of scopes) {
      const files: string[] = [];
      walk(scope.root, files);
      walkedFiles += files.length;
      const webFiles = files.filter((f) => isWebFile(f, scope.root));
      for (const file of webFiles) {
        const target = scope.kind === "samples" ? warnings : violations;
        for (const v of checkFile(file, scope.kind, scope.repoRoot)) {
          target.push({ file: v.file, line: v.line, message: violationMessage(v) });
        }
      }
    }

    return {
      violations,
      warnings: warnings.length > 0 ? warnings : undefined,
      matchedFiles: walkedFiles,
      notApplicable: false,
    };
  },
};

if (import.meta.main) {
  // --strict also blocks the samples scope (infra's `--strict` mode);
  // --strict-bundled is accepted for CLI compatibility — bundled-features is
  // already always-blocking here (what framework CI ran as --strict-bundled).
  const strict = process.argv.includes("--strict");
  const effectiveCheck: RepoCheck = strict
    ? {
        name: check.name,
        hint: check.hint,
        async run(roots) {
          const outcome = await check.run(roots);
          return {
            violations: [...outcome.violations, ...(outcome.warnings ?? [])],
            matchedFiles: outcome.matchedFiles,
            notApplicable: outcome.notApplicable,
          };
        },
      }
    : check;
  const failed = reportResults(await runRepoChecks([effectiveCheck]));
  process.exit(failed > 0 ? 1 : 0);
}
