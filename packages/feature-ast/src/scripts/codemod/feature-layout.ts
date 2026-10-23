#!/usr/bin/env bun
// feature-layout — the runtime of a feature file follows from its path: <feature>/web/** is client
// code, everything else is server or isomorphic. This moves every file marked as runtime client of a
// feature that lies outside web/ into <feature>/web/ (sub-structure kept), rewrites each relative
// import / re-export / import() / mock.module that points at it or out of it, rewrites package.json
// export targets, and drops the marker. A marker the path already implies (client in web/, test in
// __tests__/, dev in dev/, tooling in scripts/) is only removed. A target that already exists, or a
// marker no path rule covers, is reported as manual and left alone.
//
// Features are found as src/features/<feature>/ and bundled-features/src/<feature>/ below the target
// directories; --feature-dir <dir> names a directory that is itself one feature, --features-root <dir>
// a directory whose children are features.
//
// Usage:
//   bun scripts/codemod/feature-layout.ts <targetDir...> [--feature-dir <dir>] [--features-root <dir>]
//     [--check | --dry-run | --write] [--no-format]
// Without a mode flag it writes (kumiko-upgrade --apply calls it that way). --check exits 1 while
// any move, marker or manual site is left; --dry-run only reports.

import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Node, Project } from "ts-morph";
import {
  applyEdits,
  type CodemodSite,
  formatWithBiome,
  moduleSpecifierLiterals,
  SCRIPT_EXTENSION,
  type TextEdit,
} from "./codemod-support.ts";
import { collectSourceFiles } from "./collect-source-files.ts";

const MARKER_HEAD_LINES = 8;
const MARKER_LINE = /^\s*\/\/\s*@runtime(?:\s+(\w+))?\s*$/;
const WEB_DIR = "web";
const IMPLICIT_FEATURE_PATTERNS: readonly RegExp[] = [
  /^(.*\/src\/features\/[^/]+)\/(.+)$/,
  /^(.*\/bundled-features\/src\/[^/]+)\/(.+)$/,
];
const TEST_PATH = /(?:^|\/)__tests__\/|\.(?:test|integration|e2e|spec)\.[tj]sx?$/;

export interface FeatureLayoutOptions {
  readonly featureDirs?: readonly string[];
  readonly featuresRoots?: readonly string[];
}

export interface FeatureLayoutMove {
  readonly from: string;
  readonly to: string;
}

export interface FeatureLayoutResult {
  // New content per final path (moved files under their new path).
  readonly writes: ReadonlyMap<string, string>;
  // Old paths that no longer exist after the moves.
  readonly removals: readonly string[];
  readonly moves: readonly FeatureLayoutMove[];
  readonly markersRemoved: readonly string[];
  readonly importRewrites: readonly CodemodSite[];
  readonly manual: readonly CodemodSite[];
}

interface Marker {
  readonly line: number;
  readonly kind: string | undefined;
}

function findMarker(source: string): Marker | undefined {
  const lines = source.split("\n", MARKER_HEAD_LINES);
  for (const [index, text] of lines.entries()) {
    const match = MARKER_LINE.exec(text);
    if (match) return { line: index, kind: match[1] };
  }
  return undefined;
}

function removeMarkerLine(source: string, line: number): string {
  const lines = source.split("\n");
  lines.splice(line, 1);
  if (line === 0 && lines[0] === "") lines.shift();
  return lines.join("\n");
}

function splitFeaturePath(
  file: string,
  options: FeatureLayoutOptions,
): { readonly featureDir: string; readonly rel: string } | undefined {
  for (const dir of options.featureDirs ?? []) {
    if (file.startsWith(`${dir}/`)) return { featureDir: dir, rel: file.slice(dir.length + 1) };
  }
  for (const root of options.featuresRoots ?? []) {
    if (!file.startsWith(`${root}/`)) continue;
    const [feature, ...rest] = file.slice(root.length + 1).split("/");
    if (feature !== undefined && rest.length > 0) {
      return { featureDir: `${root}/${feature}`, rel: rest.join("/") };
    }
  }
  for (const pattern of IMPLICIT_FEATURE_PATTERNS) {
    const match = pattern.exec(file);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      return { featureDir: match[1], rel: match[2] };
    }
  }
  return undefined;
}

function pathImpliedKind(rel: string): string | undefined {
  if (TEST_PATH.test(rel)) return "test";
  if (rel === WEB_DIR || rel.startsWith(`${WEB_DIR}/`) || /^web\.tsx?$/.test(rel)) return "client";
  if (rel.startsWith("dev/")) return "dev";
  if (rel.startsWith("scripts/")) return "tooling";
  return undefined;
}

function stripScriptExtension(file: string): { readonly base: string; readonly extension: string } {
  const extension = SCRIPT_EXTENSION.exec(file)?.[0] ?? "";
  return { base: file.slice(0, file.length - extension.length), extension };
}

function movedTargetOf(
  absoluteSpecifier: string,
  moved: ReadonlyMap<string, string>,
): string | undefined {
  const { base, extension } = stripScriptExtension(absoluteSpecifier);
  const candidates: string[] =
    extension === ".js" || extension === ".ts" || extension === ".tsx" || extension === ""
      ? [absoluteSpecifier, `${base}.ts`, `${base}.tsx`]
      : [absoluteSpecifier];
  if (extension === "")
    candidates.push(`${absoluteSpecifier}/index.ts`, `${absoluteSpecifier}/index.tsx`);
  for (const candidate of candidates) {
    if (moved.has(candidate)) return candidate;
  }
  return undefined;
}

// A moved `<dir>/index.ts` is imported as `<dir>`, so the file name alone never appears in the importer.
function importableNameOf(file: string): string {
  const { base } = stripScriptExtension(baseName(file));
  return base === "index" ? baseName(dirname(file)) : base;
}

function relativeSpecifierFrom(fromDir: string, target: string): string {
  const path = relative(fromDir, target).split("\\").join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

function rewrittenSpecifier(
  specifier: string,
  oldFile: string,
  newFile: string,
  moved: ReadonlyMap<string, string>,
): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const absolute = resolve(dirname(oldFile), specifier);
  const oldTarget = movedTargetOf(absolute, moved);
  if (oldTarget === undefined && oldFile === newFile) return undefined;
  const newTarget = oldTarget === undefined ? absolute : moved.get(oldTarget);
  if (newTarget === undefined) return undefined;
  let next: string;
  if (oldTarget === undefined) {
    next = relativeSpecifierFrom(dirname(newFile), newTarget);
    if (specifier.endsWith("/")) next = `${next}/`;
  } else {
    const { extension } = stripScriptExtension(absolute);
    const { base } = stripScriptExtension(newTarget);
    const isDirectoryImport = extension === "" && base.endsWith("/index");
    const target = isDirectoryImport ? base.slice(0, -"/index".length) : `${base}${extension}`;
    next = relativeSpecifierFrom(dirname(newFile), target);
  }
  return next === specifier ? undefined : next;
}

function rewriteSpecifiers(
  source: string,
  oldFile: string,
  newFile: string,
  moved: ReadonlyMap<string, string>,
  sites: CodemodSite[],
): string {
  const project = new Project({
    useInMemoryFileSystem: true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
  const sourceFile = project.createSourceFile(oldFile, source);
  const edits: TextEdit[] = [];
  for (const literal of moduleSpecifierLiterals(sourceFile)) {
    if (!Node.isStringLiteral(literal)) continue;
    const current = literal.getLiteralValue();
    const next = rewrittenSpecifier(current, oldFile, newFile, moved);
    if (next === undefined) continue;
    sites.push({
      file: oldFile,
      line: literal.getStartLineNumber(),
      description: `${current} -> ${next}`,
    });
    edits.push({ start: literal.getStart() + 1, end: literal.getEnd() - 1, text: next });
  }
  return applyEdits(source, edits);
}

// package.json export targets: "./src/<rel>.ts" and the publishConfig mirror "./dist/<rel>.js|.d.ts".
function rewritePackageJson(
  source: string,
  packageJsonPath: string,
  moved: ReadonlyMap<string, string>,
  sites: CodemodSite[],
): string {
  const packageDir = dirname(packageJsonPath);
  return source.replace(/"(\.\/(?:src|dist)\/[^"]+)"/g, (whole, target: string) => {
    const isDist = target.startsWith("./dist/");
    const sourceTarget = isDist
      ? target.replace("./dist/", "./src/").replace(/(?:\.d\.ts|\.js)$/, "")
      : target;
    const { base } = stripScriptExtension(resolve(packageDir, sourceTarget));
    const candidates = isDist ? [`${base}.ts`, `${base}.tsx`] : [resolve(packageDir, sourceTarget)];
    const oldFile = candidates.find((candidate) => moved.has(candidate));
    const newFile = oldFile === undefined ? undefined : moved.get(oldFile);
    if (newFile === undefined) return whole;
    const newRel = relative(packageDir, newFile).split("\\").join("/");
    const next = isDist
      ? target.replace(/^\.\/dist\/.*?(\.d\.ts|\.js)$/, (_all, ext: string) => {
          return `./dist/${newRel.slice("src/".length).replace(/\.tsx?$/, "")}${ext}`;
        })
      : `./${newRel}`;
    sites.push({
      file: packageJsonPath,
      line: source.slice(0, source.indexOf(whole)).split("\n").length,
      description: `${target} -> ${next}`,
    });
    return `"${next}"`;
  });
}

type MarkerAction =
  | { readonly action: "strip" }
  | { readonly action: "move"; readonly target: string }
  | { readonly action: "manual"; readonly description: string };

function actionForMarker(
  marker: Marker,
  location: { readonly featureDir: string; readonly rel: string },
  isTaken: (target: string) => boolean,
): MarkerAction {
  if (marker.kind === undefined) {
    return { action: "manual", description: "bare @runtime marker without a kind" };
  }
  const implied = pathImpliedKind(location.rel);
  if (marker.kind === implied || (marker.kind === "client" && implied !== undefined)) {
    return { action: "strip" };
  }
  if (marker.kind !== "client") {
    return { action: "manual", description: `@runtime ${marker.kind} has no path rule here` };
  }
  const target = join(location.featureDir, WEB_DIR, location.rel);
  return isTaken(target)
    ? { action: "manual", description: `cannot move to ${WEB_DIR}/${location.rel}: target exists` }
    : { action: "move", target };
}

function buildWrites(
  files: ReadonlyMap<string, string>,
  stripped: ReadonlyMap<string, string>,
  moved: ReadonlyMap<string, string>,
  importRewrites: CodemodSite[],
): Map<string, string> {
  const writes = new Map<string, string>();
  const basenames = [...moved.keys()].map(importableNameOf);
  for (const [file, original] of files) {
    const content = stripped.get(file) ?? original;
    const newFile = moved.get(file) ?? file;
    if (file.endsWith("package.json")) {
      const next =
        moved.size > 0 ? rewritePackageJson(content, file, moved, importRewrites) : content;
      if (next !== original) writes.set(file, next);
      continue;
    }
    const mentionsMoved = moved.has(file) || basenames.some((name) => content.includes(name));
    const next = mentionsMoved
      ? rewriteSpecifiers(content, file, newFile, moved, importRewrites)
      : content;
    if (next !== original || newFile !== file) writes.set(newFile, next);
  }
  return writes;
}

export function applyFeatureLayout(
  files: ReadonlyMap<string, string>,
  options: FeatureLayoutOptions = {},
): FeatureLayoutResult {
  const manual: CodemodSite[] = [];
  const markersRemoved: string[] = [];
  const stripped = new Map<string, string>();
  const moved = new Map<string, string>();
  const claimedTargets = new Set<string>();
  const isTaken = (target: string): boolean => files.has(target) || claimedTargets.has(target);

  for (const [file, source] of files) {
    const location = splitFeaturePath(file, options);
    const marker = location === undefined ? undefined : findMarker(source);
    if (location === undefined || marker === undefined) continue;
    const decision = actionForMarker(marker, location, isTaken);
    if (decision.action === "manual") {
      manual.push({ file, line: marker.line + 1, description: decision.description });
      continue;
    }
    if (decision.action === "move") {
      claimedTargets.add(decision.target);
      moved.set(file, decision.target);
    }
    stripped.set(file, removeMarkerLine(source, marker.line));
    markersRemoved.push(file);
  }

  const importRewrites: CodemodSite[] = [];
  const writes = buildWrites(files, stripped, moved, importRewrites);

  return {
    writes,
    removals: [...moved.keys()],
    moves: [...moved].map(([from, to]) => ({ from, to })),
    markersRemoved,
    importRewrites,
    manual,
  };
}

function baseName(file: string): string {
  return file.slice(file.lastIndexOf("/") + 1);
}

type Mode = "write" | "dry-run" | "check";

interface CliOptions extends FeatureLayoutOptions {
  readonly mode: Mode;
  readonly format: boolean;
  readonly paths: readonly string[];
}

function parseArgs(argv: readonly string[]): CliOptions {
  let mode: Mode = "write";
  let format = true;
  const paths: string[] = [];
  const featureDirs: string[] = [];
  const featuresRoots: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--check") mode = "check";
    else if (arg === "--dry-run") mode = "dry-run";
    else if (arg === "--write") mode = "write";
    else if (arg === "--no-format") format = false;
    else if (arg === "--feature-dir" || arg === "--features-root") {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a directory`);
      (arg === "--feature-dir" ? featureDirs : featuresRoots).push(resolve(value));
    } else if (arg.startsWith("--")) throw new Error(`unknown flag: ${arg}`);
    else paths.push(arg);
  }
  if (paths.length === 0) throw new Error("at least one target directory is required");
  return { mode, format, paths, featureDirs, featuresRoots };
}

function readTargetFiles(paths: readonly string[]): Map<string, string> {
  const files = new Map<string, string>();
  const names = collectSourceFiles(paths, {
    isMigratableFile: (name) => /\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts"),
  });
  const packageJsons = collectSourceFiles(paths, {
    isMigratableFile: (name) => name === "package.json",
  });
  for (const file of [...names, ...packageJsons]) {
    if (file.includes("/__tests__/fixtures/")) continue;
    if (statSync(file).isFile()) files.set(file, readFileSync(file, "utf8"));
  }
  return files;
}

function display(file: string): string {
  const fromCwd = relative(process.cwd(), file);
  return fromCwd.startsWith("..") ? file : fromCwd;
}

function writeResult(result: FeatureLayoutResult): void {
  for (const old of result.removals) rmSync(old);
  for (const [file, content] of result.writes) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

async function main(argv: readonly string[]): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(argv);
  } catch (err) {
    console.error(`[feature-layout] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(2);
  }
  const files = readTargetFiles(options.paths);
  const result = applyFeatureLayout(files, options);
  for (const move of result.moves) {
    console.log(`${display(move.from)}  moved  -> ${display(move.to)}`);
  }
  for (const file of result.markersRemoved) console.log(`${display(file)}  marker removed`);
  for (const site of result.manual) {
    console.log(`${display(site.file)}:${site.line}  manual  ${site.description}`);
  }
  console.log(
    `\n[feature-layout] ${options.mode === "write" ? "moved" : "movable"}: ${result.moves.length} file(s); markers: ${result.markersRemoved.length}; import sites: ${result.importRewrites.length}; manual: ${result.manual.length}`,
  );
  if (options.mode === "write") {
    writeResult(result);
    if (options.format) {
      const changed = [...result.writes.keys()].filter((file) => /\.(ts|tsx)$/.test(file));
      if (changed.length > 0)
        await formatWithBiome("feature-layout", changed, resolve(options.paths[0] ?? "."));
    }
  }
  const pending = result.markersRemoved.length + result.manual.length;
  process.exit(options.mode === "check" && pending > 0 ? 1 : 0);
}

if (import.meta.main) await main(process.argv.slice(2));
