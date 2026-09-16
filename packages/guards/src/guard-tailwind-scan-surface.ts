#!/usr/bin/env bun
/**
 * Guard: `className` string-literal tokens under kumiko-framework's
 * `packages/bundled-features/src/**` must already be reachable through the
 * real Tailwind `@source` scan surface (`packages/renderer-web/src` +
 * `packages/renderer/src` + `samples/**\/src`, see
 * `packages/renderer-web/src/styles.css`). bundled-features itself is NOT
 * part of that scan surface (infra#654, follow-up to
 * kumiko-framework#2498/#2496): expanding `@source` there was verified to
 * work in the monorepo build but makes the standalone npm-consumer case
 * (no monorepo-relative scan path — #359) falsely green. A class used only
 * in bundled-features silently drops out of the compiled CSS at runtime,
 * with no build/lint error.
 *
 * V1 scope (per issue decision, deliberately not a Tailwind-CLI CSS
 * regen): only plain string-literal `className="..."` JSX attributes are
 * extracted on the bundled-features side — no `cn(...)`, no template
 * literals, no dynamic class maps. The allow-set (the real scan surface)
 * is read generously instead — every string/template-literal in those
 * files, not just `className` attributes — because Tailwind's own scanner
 * is a text scan, not JSX-attribute-aware; under-approximating the allow
 * side would turn into false positives on a guard that blocks CI. Tokens
 * compare WITH their modifier prefixes intact (`hover:mb-2` is its own
 * Tailwind candidate, distinct from `mb-2`).
 *
 * Baseline-regression guard like guard-pii-annotations.ts: pins the
 * currently-known violation count per file. Reductions are allowed but
 * don't auto-update the baseline. Without a baseline file the guard stays
 * warning-only (bootstrap: run `--write-baseline` once).
 *
 * Usage:
 *   bun guards/guard-tailwind-scan-surface.ts                  # compare against baseline
 *   bun guards/guard-tailwind-scan-surface.ts --write-baseline # (re)write the baseline
 *   bun guards/guard-tailwind-scan-surface.ts --no-baseline    # skip the comparison
 */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import * as path from "node:path";
import { Glob } from "bun";
import { type SourceFile, SyntaxKind } from "ts-morph";
import {
  type AstGuard,
  baselineRatchet,
  buildSharedProject,
  filesForGuard,
  type GuardOutcome,
  type GuardViolation,
  relFromRepoRoot,
  runStandalone,
  type ScanSpec,
} from "./_lib/guard-kit";
import { hasIgnoreTag } from "./_lib/ignore-tag";
import { findLocalRepo, isFlatSrcLayout, type RepoRoot, resolveRepoRoots } from "./_lib/roots";

const ROOT = process.cwd();
// Baselines are committed at the repo root, not wherever the guard happens
// to run from — resolve against the local repo, falling back to cwd only
// when no repo root could be resolved at all (e.g. a bare in-memory test).
const BASELINE_ROOT = findLocalRepo()?.absPath ?? ROOT;

const TARGET_DIR = "packages/bundled-features/src/";
const SCAN: ScanSpec = {
  scope: "source",
  extensions: ["ts", "tsx"],
  kinds: ["framework"],
  frameworkWithin: [
    "packages/bundled-features/src/**/*.tsx",
    "packages/renderer-web/src/**",
    "packages/renderer/src/**",
    "samples/**/src/**",
  ],
};
const EXCLUDE = /(__tests__|\.test\.tsx?$|\.integration\.tsx?$|\.d\.tsx?$)/;
const IGNORE_TAG = "kumiko-lint-ignore tailwind-scan-surface";

// The allow-set mirrors what Tailwind's own scanner sees over the real
// @source surface: every string/template-literal text in the file, not
// just JSX className attributes — cn(...) calls, variant maps and shared
// class constants in renderer-web/renderer/samples legitimately emit
// classes too. No EXCLUDE filter here on purpose: the @source globs
// themselves scan __tests__/*.test.tsx just the same, so excluding them
// from the allow-set would manufacture false positives.
function allStringLikeTokens(sf: SourceFile): Set<string> {
  const tokens = new Set<string>();
  const add = (text: string): void => {
    for (const t of text.split(/\s+/)) if (t.length > 0) tokens.add(t);
  };
  for (const s of sf.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
    add(s.getLiteralText());
  }
  for (const s of sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral)) {
    add(s.getLiteralText());
  }
  for (const kind of [
    SyntaxKind.TemplateHead,
    SyntaxKind.TemplateMiddle,
    SyntaxKind.TemplateTail,
  ]) {
    for (const s of sf.getDescendantsOfKind(kind)) {
      add(s.getText().replace(/^[`}]|[`$]{?$/g, ""));
    }
  }
  return tokens;
}

export interface Finding {
  readonly file: string;
  readonly line: number;
  readonly token: string;
}

function isTargetFile(sf: SourceFile): boolean {
  return relFromRepoRoot(sf.getFilePath()).startsWith(TARGET_DIR);
}

function scan(files: readonly SourceFile[]): {
  findings: Finding[];
  scanned: number;
} {
  const allowed = new Set<string>();
  const targets: SourceFile[] = [];
  let scanned = 0;

  for (const sf of files) {
    if (isTargetFile(sf)) {
      if (EXCLUDE.test(sf.getFilePath())) continue;
      targets.push(sf);
      scanned++;
      continue;
    }
    for (const t of allStringLikeTokens(sf)) allowed.add(t);
    scanned++;
  }

  const findings: Finding[] = [];
  for (const sf of targets) {
    const file = path.relative(ROOT, sf.getFilePath());
    for (const attr of sf.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
      if (attr.getNameNode().getText() !== "className") continue;
      if (hasIgnoreTag(attr, IGNORE_TAG)) continue;
      const init = attr.getInitializer();
      if (init === undefined || init.getKind() !== SyntaxKind.StringLiteral) continue;
      const text = init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralText();
      const line = init.getStartLineNumber();
      for (const token of text.split(/\s+/)) {
        if (token.length === 0 || allowed.has(token)) continue;
        findings.push({ file, line, token });
        console.warn(
          `  [tailwind-scan-surface WARN] ${file}:${line}  class "${token}" is outside the Tailwind scan surface (renderer-web/src, renderer/src, samples/**/src)`,
        );
      }
    }
  }
  return { findings, scanned };
}

function countByFile(findings: readonly Finding[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.file] = (counts[f.file] ?? 0) + 1;
  return counts;
}

const BASELINE_FILE = ".kumiko-tailwind-scan-surface-baseline.json";
const tailwindScanSurfaceBaseline = baselineRatchet({
  file: path.join(BASELINE_ROOT, BASELINE_FILE),
  formatVersion: 1,
  unit: "class token(s)",
});

// Second, independent rule: a consuming app repo (studio,
// publicstatus, …) imports Framework AND Enterprise packages by npm name
// (@cosmicdrift/* resp. @cosmicdriftgamestudio/*). Every one of them that
// ships .tsx with `className` under its own scan surface (renderer-web +
// renderer + samples/**/src) needs its own `@source` entry in the app's
// styles.css — nothing else scans it. Missed cases so far: kumiko-designer
// in studio (studio#289), kumiko-ai-agent in publicstatus (publicstatus#442)
// — both fixed by hand, both silent (no build/lint error) until noticed
// visually. This does not need ts-morph: it reads package.json + styles.css
// + a plain text scan of the dependency's shipped .tsx files directly off
// disk, independent of the scan-selected SourceFile list above.
const APP_STYLES_REL = "src/styles.css";
const PACKAGE_SCOPE = /^@cosmicdrift(?:gamestudio)?\//;
const CLASSNAME_ATTR = /\bclassName\s*=/;
// Hoisting depths a workspace/npm install can put node_modules at, relative
// to the app root: flat (own node_modules), one level up (bun workspace
// hoist to the parent), two levels up (worktree parked under .wt/<app>/).
const NODE_MODULES_HOPS = ["", "..", "../.."];

export interface SourceCoverageFinding {
  readonly file: string;
  readonly line: number;
  readonly packageName: string;
  readonly example: string;
}

function readJsonSafe(absPath: string): Record<string, unknown> | undefined {
  if (!existsSync(absPath)) return undefined;
  try {
    return JSON.parse(readFileSync(absPath, "utf-8"));
  } catch {
    return undefined;
  }
}

function dependencyNames(pkg: Record<string, unknown>): string[] {
  const names = new Set<string>();
  for (const field of ["dependencies", "devDependencies"]) {
    const deps = pkg[field];
    if (typeof deps !== "object" || deps === null) continue;
    for (const name of Object.keys(deps)) names.add(name);
  }
  return [...names].filter((name) => PACKAGE_SCOPE.test(name));
}

function resolvePackageDir(appRoot: string, pkgName: string): string | undefined {
  for (const hop of NODE_MODULES_HOPS) {
    const candidate = path.join(appRoot, hop, "node_modules", pkgName);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

// Proof the package actually needs a scan entry: at least one shipped .tsx
// under src/ with a `className=` attribute. A type-only or headless package
// (no JSX styling) legitimately needs no @source entry.
function classNameExampleIn(pkgDir: string): string | undefined {
  const srcDir = path.join(pkgDir, "src");
  if (!existsSync(srcDir)) return undefined;
  for (const rel of new Glob("**/*.tsx").scanSync({ cwd: srcDir })) {
    if (/__tests__|\.test\.tsx$/.test(rel)) continue;
    const abs = path.join(srcDir, rel);
    let content: string;
    try {
      content = readFileSync(abs, "utf-8");
    } catch {
      continue;
    }
    if (CLASSNAME_ATTR.test(content)) return path.join("src", rel);
  }
  return undefined;
}

// Resolves `@import "spec";` specifiers in a CSS file to the imported file's
// absolute path — a bare/package specifier (`@cosmicdrift/kumiko-renderer-
// web/styles.css`) resolves through the SAME node_modules hop search as a
// package dependency (it IS one); a relative specifier (`./x.css`) resolves
// against the importing file's own directory. Unresolvable imports (e.g.
// Tailwind's own `"tailwindcss"`) are dropped, not thrown on.
function resolveCssImports(cssAbsPath: string, css: string, appRoot: string): string[] {
  const specifiers = [...css.matchAll(/@import\s+["']([^"']+)["']/g)].map((m) => m[1]);
  const resolved: string[] = [];
  for (const spec of specifiers) {
    if (spec === undefined) continue;
    if (spec.startsWith(".")) {
      const candidate = path.resolve(path.dirname(cssAbsPath), spec);
      if (existsSync(candidate)) resolved.push(candidate);
      continue;
    }
    // Package-style specifier including its subpath (e.g. "@scope/name/
    // styles.css") — resolvePackageDir's node_modules hop search works
    // unchanged since it only checks existence, file or directory alike.
    const candidate = resolvePackageDir(appRoot, spec);
    if (candidate !== undefined) resolved.push(candidate);
  }
  return resolved;
}

// The static (non-glob) directory an `@source` entry names, resolved
// relative to the CSS FILE THAT DECLARES IT (Tailwind's own resolution
// rule) — not the app's styles.css. A path that doesn't exist in this
// install layout (e.g. the monorepo-only entry inside a standalone npm
// consumer) is dropped: it names nothing here, so it covers nothing here.
function sourceStaticDirsFromCss(cssAbsPath: string): string[] {
  if (!existsSync(cssAbsPath)) return [];
  const css = readFileSync(cssAbsPath, "utf-8");
  const dir = path.dirname(cssAbsPath);
  const dirs: string[] = [];
  for (const m of css.matchAll(/@source\s+["']([^"']+)["']/g)) {
    const raw = m[1];
    if (raw === undefined) continue;
    const starIdx = raw.indexOf("*");
    const staticPart = (starIdx === -1 ? raw : raw.slice(0, starIdx)).replace(/\/$/, "");
    const abs = path.resolve(dir, staticPart || ".");
    if (existsSync(abs)) dirs.push(abs);
  }
  return dirs;
}

function realpathOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

// A package is covered if an `@source` entry — in the app's own styles.css
// OR in a CSS file it `@import`s (e.g. renderer-web's, which ships its own
// @source lines for the framework's scan surface) — resolves, in THIS
// install layout, to a directory on the same branch as the package's own
// directory (either one nested inside the other: the entry could scan the
// package's full dir or just its `src/` subtree, and a package could in
// principle sit inside a broader scanned tree). Compared via realpath
// because node_modules resolution (symlinked workspace package) and an
// @source path resolved from inside another package's own source tree
// (monorepo-relative) can reach the same directory through different routes.
function isCoveredByImportChain(
  stylesAbs: string,
  css: string,
  appRoot: string,
  pkgDir: string,
): boolean {
  const realPkgDir = realpathOrSelf(pkgDir);
  for (const imported of resolveCssImports(stylesAbs, css, appRoot)) {
    for (const staticDir of sourceStaticDirsFromCss(imported)) {
      const realStaticDir = realpathOrSelf(staticDir);
      if (
        realPkgDir === realStaticDir ||
        realPkgDir.startsWith(`${realStaticDir}${path.sep}`) ||
        realStaticDir.startsWith(`${realPkgDir}${path.sep}`)
      ) {
        return true;
      }
    }
  }
  return false;
}

export function scanSourceCoverage(roots: readonly RepoRoot[]): SourceCoverageFinding[] {
  const findings: SourceCoverageFinding[] = [];
  for (const root of roots) {
    if (!isFlatSrcLayout(root)) continue;
    const stylesAbs = path.join(root.absPath, APP_STYLES_REL);
    if (!existsSync(stylesAbs)) continue;
    const css = readFileSync(stylesAbs, "utf-8");
    // Only apps on the renderer-web @source convention are in scope — an
    // app without that @import never had a scan surface to extend.
    if (!css.includes("kumiko-renderer-web/styles.css")) continue;
    const pkg = readJsonSafe(path.join(root.absPath, "package.json"));
    if (!pkg) continue;
    const file = path.relative(ROOT, stylesAbs);
    for (const name of dependencyNames(pkg)) {
      if (css.includes(name)) continue; // already @source'd (or @import'd, e.g. renderer-web itself)
      const dir = resolvePackageDir(root.absPath, name);
      if (dir === undefined) continue;
      const example = classNameExampleIn(dir);
      if (example === undefined) continue;
      if (isCoveredByImportChain(stylesAbs, css, root.absPath, dir)) continue;
      findings.push({ file, line: 1, packageName: name, example });
    }
  }
  return findings;
}

// Third, independent rule: an `@source` glob that is already present and
// resolves on disk (studio#289's own fix) can still match nothing once the
// referenced package is installed from a registry instead of a workspace
// symlink — the symlink exposes the package's full source checkout (`src/`
// included), a registry tarball only ships what its `package.json` `files`
// allowlists. This is exactly the bug that got past the guard the first
// time, so it's a hard violation, not a warning: no baseline/ratchet, every
// finding fails the run directly (still only under baseline comparison —
// `--no-baseline` reports it like the other rules but doesn't fail).
const NODE_MODULES_PKG_SEGMENT = /node_modules\/((?:@[^/]+\/)?[^/]+)\/([^/]+)/;

export interface PublishedScanSurfaceFinding {
  readonly file: string;
  readonly line: number;
  readonly glob: string;
  readonly packageName: string;
  readonly segment: string;
  readonly filesField: readonly string[];
}

interface NodeModulesSourceEntry {
  readonly raw: string;
  readonly line: number;
  readonly packageName: string;
  readonly segment: string;
  readonly packageDir: string;
}

// The segment is covered if `files` names it exactly or names a path that
// starts with it (`"src"` or `"src/web"` both cover the `src` segment) —
// mirrors how npm itself matches `files` entries against publish candidates.
function filesFieldCoversSegment(filesField: readonly string[], segment: string): boolean {
  return filesField.some((entry) => {
    const normalized = entry.replace(/^\.\//, "").replace(/\/+$/, "");
    return normalized === segment || normalized.startsWith(`${segment}/`);
  });
}

// Resolved relative to the CSS file's own directory, same rule as
// sourceStaticDirsFromCss — only entries whose node_modules/<pkg> segment
// exists in THIS install layout are considered (a dead hop for a different
// layout names nothing here, same tolerance as the rest of the guard).
function nodeModulesSourceEntries(cssAbsPath: string, css: string): NodeModulesSourceEntry[] {
  const dir = path.dirname(cssAbsPath);
  const entries: NodeModulesSourceEntry[] = [];
  for (const m of css.matchAll(/@source\s+["']([^"']+)["']/g)) {
    const raw = m[1];
    if (raw === undefined || m.index === undefined) continue;
    const nm = NODE_MODULES_PKG_SEGMENT.exec(raw);
    if (nm === null) continue;
    const packageName = nm[1];
    const segment = nm[2];
    if (packageName === undefined || segment === undefined) continue;
    const nmIndex = raw.indexOf("node_modules/");
    const packagePathPrefix = `${raw.slice(0, nmIndex)}node_modules/${packageName}`;
    const packageDir = path.resolve(dir, packagePathPrefix);
    if (!existsSync(packageDir)) continue;
    const line = css.slice(0, m.index).split("\n").length;
    entries.push({ raw, line, packageName, segment, packageDir });
  }
  return entries;
}

export function scanPublishedScanSurface(
  roots: readonly RepoRoot[],
): PublishedScanSurfaceFinding[] {
  const findings: PublishedScanSurfaceFinding[] = [];
  for (const root of roots) {
    if (!isFlatSrcLayout(root)) continue;
    const stylesAbs = path.join(root.absPath, APP_STYLES_REL);
    if (!existsSync(stylesAbs)) continue;
    const css = readFileSync(stylesAbs, "utf-8");
    const file = path.relative(ROOT, stylesAbs);

    const byPackage = new Map<string, NodeModulesSourceEntry[]>();
    for (const entry of nodeModulesSourceEntries(stylesAbs, css)) {
      const list = byPackage.get(entry.packageName) ?? [];
      list.push(entry);
      byPackage.set(entry.packageName, list);
    }

    for (const [packageName, entries] of byPackage) {
      const pkg = readJsonSafe(path.join(entries[0]?.packageDir ?? "", "package.json"));
      if (pkg === undefined) continue;
      const filesField = pkg["files"];
      if (!Array.isArray(filesField)) continue;
      const filesList = filesField.filter((f): f is string => typeof f === "string");
      // Legit second glob: another @source of the same package already
      // hits a published path (e.g. dist/**/*.js) — the dead one is only
      // a harmless workspace-flow convenience, not a coverage gap.
      const coveredElsewhere = entries.some((e) => filesFieldCoversSegment(filesList, e.segment));
      if (coveredElsewhere) continue;
      for (const e of entries) {
        findings.push({
          file,
          line: e.line,
          glob: e.raw,
          packageName,
          segment: e.segment,
          filesField: filesList,
        });
      }
    }
  }
  return findings;
}

function formatPublishedScanSurfaceMessage(f: PublishedScanSurfaceFinding): string {
  const filesText = f.filesField.join(", ");
  return `@source "${f.glob}" targets '${f.segment}/' but ${f.packageName} only publishes [${filesText}] — matches nothing in a registry install`;
}

// No baseline: every finding is a violation, unconditionally — see the
// comment above NODE_MODULES_PKG_SEGMENT for why this one doesn't ratchet.
function publishedScanSurfaceViolations(
  findings: readonly PublishedScanSurfaceFinding[],
): GuardViolation[] {
  return findings.map((f) => ({
    file: f.file,
    line: f.line,
    message: formatPublishedScanSurfaceMessage(f),
  }));
}

function reportPublishedScanSurfaceFindings(
  findings: readonly PublishedScanSurfaceFinding[],
): void {
  for (const f of findings) {
    console.warn(
      `  [tailwind-scan-surface WARN] ${f.file}:${f.line}  ${formatPublishedScanSurfaceMessage(f)}`,
    );
  }
}

const SOURCE_COVERAGE_BASELINE_FILE = ".kumiko-tailwind-source-coverage-baseline.json";
const sourceCoverageBaseline = baselineRatchet({
  file: path.join(BASELINE_ROOT, SOURCE_COVERAGE_BASELINE_FILE),
  formatVersion: 1,
  unit: "missing @source entry/entries",
});

export function sourceCoverageBaselineCounts(
  findings: readonly SourceCoverageFinding[],
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const f of findings) counts[f.file] = (counts[f.file] ?? 0) + 1;
  return counts;
}

function checkSourceCoverageBaseline(findings: readonly SourceCoverageFinding[]): GuardViolation[] {
  const resolveLine = (file: string): number => findings.find((f) => f.file === file)?.line ?? 1;
  return sourceCoverageBaseline.check(
    sourceCoverageBaselineCounts(findings),
    "Package delivers Tailwind classes without @source coverage in this app — add an @source entry for both install layouts (pattern: existing bundled-features entries).",
    {
      formatDriftRemediation:
        "Run `bun guards/guard-tailwind-scan-surface.ts --write-baseline` once.",
      resolveLine,
    },
  );
}

// One place for "what goes into the baseline", used by both the compare and
// the write path.
export function baselineCounts(findings: readonly Finding[]): Record<string, number> {
  return countByFile(findings);
}

function checkBaseline(findings: readonly Finding[]): GuardViolation[] {
  const resolveLine = (file: string): number => findings.find((f) => f.file === file)?.line ?? 1;
  return tailwindScanSurfaceBaseline.check(
    baselineCounts(findings),
    "Class outside the @source scan surface (renderer-web/src, renderer/src, samples/**/src) — reuse a class already emitted there, or move the styling into renderer-web.",
    {
      formatDriftRemediation:
        "Run `bun guards/guard-tailwind-scan-surface.ts --write-baseline` once.",
      resolveLine,
    },
  );
}

export function analyse(
  files: readonly SourceFile[],
  compareBaseline: boolean,
  roots: readonly RepoRoot[] = resolveRepoRoots(),
): GuardOutcome {
  const { findings } = scan(files);
  const coverageFindings = scanSourceCoverage(roots);
  const publishedSurfaceFindings = scanPublishedScanSurface(roots);
  reportPublishedScanSurfaceFindings(publishedSurfaceFindings);
  if (!compareBaseline) {
    console.log("  Baseline comparison skipped (--no-baseline).");
    return { violations: [] };
  }
  return {
    violations: [
      ...checkBaseline(findings),
      ...checkSourceCoverageBaseline(coverageFindings),
      ...publishedScanSurfaceViolations(publishedSurfaceFindings),
    ],
  };
}

export const guard: AstGuard = {
  name: "Tailwind-Scan-Surface Guard",
  scan: SCAN,
  hint:
    "Tailwind class in bundled-features outside the @source scan surface (renderer-web/src, renderer/src, samples/**/src) " +
    `— reuse a class already emitted there, or move the styling into renderer-web. Justified exception: // ${IGNORE_TAG} <reason>. ` +
    "Package without @source coverage in an app: add an @source entry for both install layouts. " +
    "@source with a node_modules/<pkg>/<segment> path: check whether <pkg> even publishes that segment (package.json files).",
  run: (files) => analyse(files, true),
};

// Flags are read ONLY here, not in run() — the shared runner
// (run-ui-guards.ts) runs every guard with the same argv, a
// --write-baseline there must not silently rewrite the baseline.
if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.includes("--write-baseline")) {
    const project = buildSharedProject([guard]);
    const { findings } = scan(filesForGuard(project, guard));
    tailwindScanSurfaceBaseline.write(baselineCounts(findings));
    sourceCoverageBaseline.write(
      sourceCoverageBaselineCounts(scanSourceCoverage(resolveRepoRoots())),
    );
    process.exit(0);
  }
  if (args.includes("--no-baseline")) {
    const project = buildSharedProject([guard]);
    analyse(filesForGuard(project, guard), false);
    process.exit(0);
  }
  runStandalone(guard);
}
