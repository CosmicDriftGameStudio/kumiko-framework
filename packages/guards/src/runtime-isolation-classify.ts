// Pure classification helpers for the runtime-isolation guard.
//
// Extracted from `check-runtime-isolation.ts` so the regex/path logic
// can be unit-tested in isolation. The orchestration (ts-morph,
// process.exit, file walks) stays in the script.
//
// Why: the path-pattern table has historically had quiet bugs
// (e.g. `\/scripts\/` did not match `scripts/foo.ts` at repo-root,
// silently misclassifying tooling files as `runtime`). The unit-tests
// in `__tests__/runtime-isolation-classify.test.ts` lock the
// classification rules down so future edits trip a test, not a
// production drift.

import { closeSync, existsSync, openSync, readFileSync, readSync } from "node:fs";
import * as path from "node:path";
import {
  type CompilerOptions,
  type ExportDeclaration,
  type ImportDeclaration,
  Project,
  type SourceFile,
  ts,
} from "ts-morph";

const RUNTIME_KINDS = ["runtime", "client", "prod", "dev", "tooling", "test"] as const;

export type Runtime = (typeof RUNTIME_KINDS)[number];

export const ALL_RUNTIMES: ReadonlySet<string> = new Set(RUNTIME_KINDS);

function isRuntime(value: unknown): value is Runtime {
  return typeof value === "string" && ALL_RUNTIMES.has(value);
}

export const COMPAT: Record<Runtime, ReadonlySet<Runtime>> = {
  runtime: new Set(["runtime", "client", "prod"]),
  client: new Set(["client"]),
  prod: new Set(["runtime", "client", "prod"]),
  dev: new Set(["runtime", "client", "prod", "dev", "tooling"]),
  tooling: new Set(["runtime", "client", "prod", "dev", "tooling", "test"]),
  test: new Set(["runtime", "client", "prod", "dev", "tooling", "test"]),
};

// First match wins, so the test rules stay ahead of the tooling and client carve-outs.
const PATH_RULES: readonly (readonly [RegExp, Runtime])[] = [
  [/\/(__tests__|testing)\//, "test"],
  [/\/testing\.tsx?$/, "test"],
  [/\.(test|integration|e2e|spec)\.[tj]sx?$/, "test"],
  // Playwright suites live in e2e/ at the repo root, next to a package or a
  // sample and import kumiko-testing/e2e; without this rule they read as
  // runtime code importing the test tier. Deliberately not any nested e2e/.
  [/^(?:e2e|packages\/[^/]+\/e2e|samples\/(?:.+\/)?e2e)\//, "test"],
  [/(?:^|\/)scripts\//, "tooling"],
  [/(?:^|\/)bin\//, "tooling"],
  [/\/drizzle\/[^/]+\.ts$/, "tooling"],
  [/\/drizzle\.config\.[tj]s$/, "tooling"],

  // Shared UI types are used by both client and runtime. In the kumiko isolation
  // model, "client" is the most permissive production category that "runtime"
  // can also import.
  [/(?:^|\/)ui-types\//, "client"],

  // Same reasoning, two more shapes: a `web.ts`/`web/` subpath is the
  // established convention (locale-de, locale-es, locale-fr, locale-it, bundled-features) for the
  // client-safe slice of an otherwise `"runtime"`-marked package — the
  // package.json marker classifies the whole package, this carves the
  // deliberately-named exception back out. Deliberately workspace-wide (any
  // repo, any depth), not framework-only: app repos' own `src/features/*/web/`
  // dirs follow the identical convention. `time`/`utils`/`engine/types`/`errors`/`auth`
  // are framework's other isomorphic exports (published as their own subpath
  // exports, empirically zero Node-only or cross-module value imports, same
  // shape as `ui-types`). Scoped to `packages/framework/src/` specifically —
  // `utils`/`errors` are common enough directory names elsewhere that a
  // repo-wide match risks misclassifying an unrelated server-only folder in
  // some other package.
  [/(?:^|\/)web\//, "client"],
  [/\/web\.tsx?$/, "client"],
  // After the web/ carve-out: client code under web/dev/ must stay client.
  [/(?:^|\/)dev\//, "dev"],
  [/^packages\/framework\/src\/(?:time|utils|engine\/types|errors|auth)\//, "client"],

  // More single-file carve-outs, same "package marker is coarser than the
  // file" shape, verified case by case rather than by a directory
  // convention:
  //  - locale-{de,es,fr,it}/src/strings.ts: pure string-constant data (zero
  //    imports), re-exported by the already-client `web.ts` sibling in the
  //    same package but shadowed by the package's own `"runtime"` marker.
  [/^packages\/locale-(?:de|es|fr|it)\/src\/strings\.ts$/, "client"],
  //  - dev-server/src/env-schema.ts: a zod-only schema, no dev-server-
  //    internal imports — safe to carve out on its own.
  [/^packages\/dev-server\/src\/env-schema\.ts$/, "client"],
];

/**
 * Classify a file by its path relative to the repo root. Returns null
 * if no path-pattern matched (caller falls back to workspace / default).
 *
 * Pure function — accepts a repo-relative path string, no I/O.
 */
export function classifyByPath(repoRelativePath: string): Runtime | null {
  const rel = repoRelativePath.replace(/\\/g, "/");
  for (const [pattern, runtime] of PATH_RULES) {
    if (pattern.test(rel)) return runtime;
  }
  return null;
}

/**
 * App-repo browser bundle entry, mirroring the naming convention apps use
 * for `kumiko-build` entries (`resolveClientEntries` in kumiko-framework's
 * `packages/server-runtime/src/build-prod-bundle.ts`): `src/client.tsx`/
 * `src/client.ts` (single-entry) or `src/client-<suffix>.tsx?` (declared via
 * package.json `kumiko.clientEntries`; no longer auto-discovered
 * by this filename alone). Framework/enterprise packages never match —
 * their sources live under `packages/*\/src/`, not a repo-root `src/`. Kept
 * independent of the framework's own regex (cross-package import would be a
 * build-vs-lint layering violation) — if apps stop following this naming
 * convention, this drifts and needs a matching update. Entries the app
 * declares itself (`readDeclaredClientEntries`) count in addition, so a
 * `./src/admin/index.tsx` entry is classified as browser code too.
 */
export function isClientEntryPath(
  repoRelativePath: string,
  declaredEntries: ReadonlySet<string> = new Set(),
): boolean {
  const rel = repoRelativePath.replace(/\\/g, "/");
  return declaredEntries.has(rel) || /^src\/client(-[a-z][a-z0-9-]*)?\.tsx?$/.test(rel);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Parses `kumiko.clientEntry` / `kumiko.clientEntries[].sourceFile` out of a
 * package.json value into repo-relative paths. Parsed locally instead of
 * importing the build's resolver (layering: lint must not depend on
 * server-runtime); anything malformed is ignored — `kumiko build` owns
 * rejecting it.
 */
export function parseDeclaredClientEntries(packageJson: unknown): ReadonlySet<string> {
  const entries = new Set<string>();
  const kumiko = isRecord(packageJson) ? packageJson["kumiko"] : undefined;
  if (!isRecord(kumiko)) return entries;
  const sources: unknown[] = [kumiko["clientEntry"]];
  const multi = kumiko["clientEntries"];
  if (Array.isArray(multi)) {
    for (const entry of multi) sources.push(isRecord(entry) ? entry["sourceFile"] : undefined);
  }
  for (const source of sources) {
    if (typeof source === "string") {
      entries.add(path.posix.normalize(source.replace(/\\/g, "/")));
    }
  }
  return entries;
}

export function readDeclaredClientEntries(repoAbsPath: string): ReadonlySet<string> {
  const file = path.join(repoAbsPath, "package.json");
  if (!existsSync(file)) return new Set();
  try {
    return parseDeclaredClientEntries(JSON.parse(readFileSync(file, "utf8")));
  } catch {
    return new Set();
  }
}

/**
 * An import declaration that survives `verbatimModuleSyntax` stripping and
 * therefore carries real runtime weight. Shared by the direct-edge check and
 * the client-reachability walk so both agree on what counts as an edge.
 */
export function isValueImport(decl: ImportDeclaration): boolean {
  if (decl.isTypeOnly()) return false;
  const named = decl.getNamedImports();
  if (
    named.length > 0 &&
    named.every((n) => n.isTypeOnly()) &&
    !decl.getDefaultImport() &&
    !decl.getNamespaceImport()
  ) {
    return false;
  }
  return true;
}

export type ValueModuleEdge = {
  readonly spec: string;
  readonly targetPath: string;
  readonly line: number;
  /** Imported or re-exported binding names; "default" and "*" for default and namespace/star forms. */
  readonly names: readonly string[];
};

function importedNames(decl: ImportDeclaration): string[] {
  const names = decl.getNamedImports().map((n) => n.getName());
  if (decl.getDefaultImport()) names.push("default");
  if (decl.getNamespaceImport()) names.push("*");
  return names;
}

function reExportedNames(decl: ExportDeclaration): string[] {
  const named = decl.getNamedExports();
  return named.length > 0 ? named.map((n) => n.getName()) : ["*"];
}

/**
 * Every runtime-weighted edge out of a file: value imports plus value
 * re-exports (`export { x } from`, `export * from`) — barrels are how most
 * client entries reach runtime code. Shared by the direct-edge check and the
 * reachability walk so both see the same edge set.
 */
export function valueModuleEdges(sf: SourceFile): ValueModuleEdge[] {
  const edges: ValueModuleEdge[] = [];
  for (const decl of sf.getImportDeclarations()) {
    if (!isValueImport(decl)) continue;
    const targetPath = resolveImportTargetPath(decl);
    if (!targetPath) continue;
    edges.push({
      spec: decl.getModuleSpecifierValue(),
      targetPath,
      line: decl.getStartLineNumber(),
      names: importedNames(decl),
    });
  }
  for (const decl of sf.getExportDeclarations()) {
    if (decl.isTypeOnly()) continue;
    const named = decl.getNamedExports();
    if (named.length > 0 && named.every((n) => n.isTypeOnly())) continue;
    const spec = decl.getModuleSpecifierValue();
    const targetPath = resolveImportTargetPath(decl);
    if (!targetPath || spec === undefined) continue;
    edges.push({ spec, targetPath, line: decl.getStartLineNumber(), names: reExportedNames(decl) });
  }
  return edges;
}

const moduleResolutionCaches = new WeakMap<Project, ts.ModuleResolutionCache>();
const javaScriptExtensions: ReadonlySet<string> = new Set([
  ts.Extension.Js,
  ts.Extension.Jsx,
  ts.Extension.Mjs,
  ts.Extension.Cjs,
]);

/**
 * Resolve an import or re-export to its target file path without touching the
 * type checker. ts-morph's `getModuleSpecifierSourceFile()` goes through
 * `getSymbol()`, which creates the full program and binds every file: on a
 * multi-repo scan that doubled the RSS past the CI runner's memory. Plain
 * `ts.resolveModuleName` yields the same real paths for workspace files. JS
 * targets are dropped unless `allowJs` is on, because the program never
 * contained them either.
 */
export function resolveImportTargetPath(
  decl: ImportDeclaration | ExportDeclaration,
): string | undefined {
  const spec = decl.getModuleSpecifierValue();
  if (spec === undefined) return undefined;
  const project = decl.getProject();
  const options = project.getCompilerOptions();
  const host = project.getModuleResolutionHost();
  let cache = moduleResolutionCaches.get(project);
  if (!cache) {
    cache = ts.createModuleResolutionCache(
      host.getCurrentDirectory?.() ?? process.cwd(),
      ts.sys.useCaseSensitiveFileNames
        ? (fileName) => fileName
        : (fileName) => fileName.toLowerCase(),
      options,
    );
    moduleResolutionCaches.set(project, cache);
  }
  const resolved = ts.resolveModuleName(
    spec,
    decl.getSourceFile().getFilePath(),
    options,
    host,
    cache,
  ).resolvedModule;
  if (!resolved) return undefined;
  if (!options.allowJs && javaScriptExtensions.has(resolved.extension)) return undefined;
  return resolved.resolvedFileName;
}

/**
 * Map dist declaration files back to src. Project References make ts-morph
 * resolve imports to `.d.ts` under `dist/`; classification and the reachable
 * set must use the same path.
 */
export function toEffectivePath(filePath: string): string {
  if (filePath.endsWith(".d.ts") && filePath.includes("/dist/")) {
    const base = filePath.replace("/dist/", "/src/").replace(/\.d\.ts$/, "");
    if (existsSync(`${base}.ts`)) return `${base}.ts`;
    if (existsSync(`${base}.tsx`)) return `${base}.tsx`;
  }
  return filePath;
}

/**
 * BFS over value-import edges starting at every file `isEntry` accepts.
 * Files reached this way are part of a browser bundle even when nothing in
 * their own path/directive/workspace marks them "client" — a plain helper
 * file, several hops from `src/client-*.tsx`, value-importing a server
 * subpath is exactly the drift this catches. Crossing into node_modules is
 * fine (ts-morph resolves workspace symlinks to the real package file);
 * only literal `node_modules/`/`dist/` targets are excluded, matching the
 * direct-edge check.
 */
export function computeClientReachablePaths(
  sourceFiles: readonly SourceFile[],
  isEntry: (sourceFile: SourceFile) => boolean,
  /** Filled with file -> the file it was first reached from, for `clientImportChain`. */
  reachedFrom?: Map<string, string>,
): ReadonlySet<string> {
  const reached = new Set<string>();
  const queue: SourceFile[] = sourceFiles.filter(isEntry);
  while (queue.length > 0) {
    const sf = queue.shift();
    if (!sf) break;
    const fp = toEffectivePath(sf.getFilePath());
    if (fp.includes("/node_modules/") || fp.includes("/dist/")) continue;
    if (reached.has(fp)) continue;
    reached.add(fp);
    const project = sf.getProject();
    for (const edge of valueModuleEdges(sf)) {
      const targetPath = toEffectivePath(edge.targetPath);
      if (targetPath.includes("/node_modules/") || targetPath.includes("/dist/")) continue;
      if (reached.has(targetPath)) continue;
      if (reachedFrom && !reachedFrom.has(targetPath)) reachedFrom.set(targetPath, fp);
      queue.push(project.getSourceFile(targetPath) ?? project.addSourceFileAtPath(targetPath));
    }
  }
  return reached;
}

/** Entry-first import chain to `file`, built from `computeClientReachablePaths`' `reachedFrom`. */
export function clientImportChain(
  file: string,
  reachedFrom: ReadonlyMap<string, string>,
): readonly string[] {
  const chain = [file];
  for (let prev = reachedFrom.get(file); prev !== undefined; prev = reachedFrom.get(prev)) {
    if (chain.includes(prev)) break;
    chain.unshift(prev);
  }
  return chain;
}

const DIRECTIVE_HEAD_BYTES = 600;
const DIRECTIVE_HEAD_LINES = 8;

export type HeadReader = (filePath: string) => string | null;

// Reads only the file head, so classifying a large source file does not pull
// it fully into memory.
export function readFileHead(filePath: string): string | null {
  let fd: number;
  try {
    fd = openSync(filePath, "r");
  } catch {
    return null;
  }
  try {
    const buffer = Buffer.alloc(DIRECTIVE_HEAD_BYTES);
    const bytesRead = readSync(fd, buffer, 0, DIRECTIVE_HEAD_BYTES, 0);
    return buffer.toString("utf8", 0, bytesRead);
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/**
 * Classify a file by its top-of-file `// @runtime <kind>` directive.
 * Reads the first 600 bytes only (cap blast radius on huge files).
 */
export function classifyByDirective(
  filePath: string,
  readHead: HeadReader = readFileHead,
): Runtime | null {
  const head = readHead(filePath);
  return head === null ? null : directiveInHead(head);
}

export function directiveInHead(head: string): Runtime | null {
  for (const line of head.split("\n").slice(0, DIRECTIVE_HEAD_LINES)) {
    const m = line.match(/\/\/\s*@runtime\s+(\w+)/);
    const declared = m?.[1];
    if (isRuntime(declared)) return declared;
  }
  return null;
}

export type DirectiveClassifier = (filePath: string) => Runtime | null;

/**
 * Per-run memo of `classifyByDirective`: the guard classifies each file in
 * several passes (client reachability, then violations), and each pass would
 * otherwise re-read the same head. Created per run, not module-global, so
 * tests stay isolated.
 */
export function createDirectiveClassifier(
  readHead: HeadReader = readFileHead,
): DirectiveClassifier {
  const cache = new Map<string, Runtime | null>();
  return (filePath) => {
    const cached = cache.get(filePath);
    if (cached !== undefined) return cached;
    const result = classifyByDirective(filePath, readHead);
    cache.set(filePath, result);
    return result;
  };
}

/**
 * Walk upward from `filePath` looking for the nearest package.json that
 * carries a `kumiko.runtime` marker. Stops at `repoRoot`. Caches per
 * directory in the supplied map so a long scan only reads each
 * package.json once.
 */
export function findWorkspaceRuntime(
  filePath: string,
  repoRoot: string,
  cache: Map<string, Runtime | null>,
): Runtime | null {
  let dir = path.dirname(filePath);
  // Includes repoRoot itself: a single-package consumer repo keeps its marker there.
  while (dir.startsWith(repoRoot)) {
    const r = readWorkspaceRuntime(dir, cache);
    if (r) return r;
    // Stop at the first package.json — don't fall through to a parent
    // workspace that happens to have a marker.
    try {
      readFileSync(path.join(dir, "package.json"), "utf8");
      return null;
    } catch {
      // No package.json here — keep climbing.
    }
    if (dir === repoRoot) break;
    dir = path.dirname(dir);
  }
  return null;
}

function readWorkspaceRuntime(dir: string, cache: Map<string, Runtime | null>): Runtime | null {
  const cached = cache.get(dir);
  if (cached !== undefined) return cached;
  const pkgPath = path.join(dir, "package.json");
  let result: Runtime | null = null;
  try {
    const pkg: unknown = JSON.parse(readFileSync(pkgPath, "utf8"));
    const kumiko = typeof pkg === "object" && pkg !== null && "kumiko" in pkg ? pkg.kumiko : null;
    const declared =
      typeof kumiko === "object" && kumiko !== null && "runtime" in kumiko ? kumiko.runtime : null;
    if (isRuntime(declared)) result = declared;
  } catch {
    // package.json missing or unreadable — unmarked
  }
  cache.set(dir, result);
  return result;
}

/**
 * Compose the classification layers (directive > path > workspace >
 * client-reachability > default) into one call. The cache is owned by the
 * caller so a single scan amortizes the workspace-lookup across files.
 *
 * `clientReachable` only ever promotes the *default* — a file with an
 * explicit directive, a matched path pattern, or a workspace marker keeps
 * that classification regardless of reachability. This is what lets a
 * framework file explicitly marked `"runtime"` (e.g. `engine/index.ts`) stay
 * "runtime" even when a client bundle reaches it — which is exactly the
 * violation this guard needs to see, not paper over.
 */
export function classify(
  filePath: string,
  repoRoot: string,
  workspaceCache: Map<string, Runtime | null>,
  clientReachable?: ReadonlySet<string>,
  directiveOf: DirectiveClassifier = (file) => classifyByDirective(file),
): Runtime {
  const effectivePath = toEffectivePath(filePath);

  const rel = path.relative(repoRoot, effectivePath);
  return (
    directiveOf(effectivePath) ??
    classifyByPath(rel) ??
    findWorkspaceRuntime(effectivePath, repoRoot, workspaceCache) ??
    (clientReachable?.has(effectivePath) ? "client" : undefined) ??
    "runtime"
  );
}

type KumikoPackage = {
  readonly root: string;
  readonly name: string;
  readonly runtime: Runtime;
  /** `repository.directory`: maps a package file onto the repo path the PATH_RULES are written against. */
  readonly repoDirectory: string;
  readonly exports: unknown;
};

function readKumikoPackage(dir: string): KumikoPackage | null {
  try {
    const pkg: unknown = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    if (!isRecord(pkg) || typeof pkg["name"] !== "string") return null;
    const kumiko = pkg["kumiko"];
    const runtime = isRecord(kumiko) ? kumiko["runtime"] : undefined;
    if (!isRuntime(runtime)) return null;
    const repository = pkg["repository"];
    const directory = isRecord(repository) ? repository["directory"] : undefined;
    return {
      root: dir,
      name: pkg["name"],
      runtime,
      repoDirectory: typeof directory === "string" ? directory : "",
      exports: pkg["exports"],
    };
  } catch {
    return null;
  }
}

export type ServerEntryImport = {
  readonly file: string;
  readonly line: number;
  readonly importedSpec: string;
  readonly importedRuntime: Runtime;
  /** Where to import from instead, or why no client-safe entry fits. */
  readonly replacement: string;
};

type ClientEntry = { readonly specifier: string; readonly file: string };

/**
 * Judges import targets inside installed (or symlinked) Kumiko packages, which
 * the in-repo classification never sees. The package's own markers decide:
 * directive, the PATH_RULES applied to the file's path in its source repo
 * (`repository.directory`), then `kumiko.runtime`. Its client-safe entry points
 * are the `exports` whose target classifies "client" by the same rules, so
 * there is no second list to keep in sync. Packages without a `kumiko.runtime`
 * marker (third-party code) are not judged.
 */
export function createKumikoPackageClassifier(
  compilerOptions: CompilerOptions,
  directiveOf: DirectiveClassifier,
) {
  const packageByDir = new Map<string, KumikoPackage | null>();
  const clientEntriesByRoot = new Map<string, readonly ClientEntry[]>();
  const exportNamesByFile = new Map<string, ReadonlySet<string>>();
  let exportProject: Project | undefined;

  function packageOf(filePath: string): KumikoPackage | null {
    for (let dir = path.dirname(filePath); ; dir = path.dirname(dir)) {
      const cached = packageByDir.get(dir);
      if (cached !== undefined) return cached;
      if (existsSync(path.join(dir, "package.json"))) {
        const pkg = readKumikoPackage(dir);
        packageByDir.set(dir, pkg);
        return pkg;
      }
      if (path.dirname(dir) === dir) return null;
    }
  }

  function classifyIn(pkg: KumikoPackage, filePath: string): Runtime {
    // The npm tarball ships only the compiled dist/; the rules are written against src/.
    const inPackage = path
      .relative(pkg.root, filePath)
      .split(path.sep)
      .join("/")
      .replace(/^dist\//, "src/")
      .replace(/\.(?:d\.ts|js)$/, ".ts");
    return (
      directiveOf(filePath) ??
      classifyByPath(path.posix.join(pkg.repoDirectory, inPackage)) ??
      pkg.runtime
    );
  }

  function clientEntriesOf(pkg: KumikoPackage): readonly ClientEntry[] {
    const cached = clientEntriesByRoot.get(pkg.root);
    if (cached) return cached;
    const entries: ClientEntry[] = [];
    if (isRecord(pkg.exports)) {
      for (const [subpath, target] of Object.entries(pkg.exports)) {
        const relFile = isRecord(target)
          ? (target["types"] ?? target["default"] ?? target["import"])
          : target;
        if (typeof relFile !== "string" || !/\.tsx?$/.test(relFile)) continue;
        const file = path.join(pkg.root, relFile);
        if (classifyIn(pkg, file) !== "client") continue;
        const specifier =
          subpath === "." ? pkg.name : `${pkg.name}/${subpath.replace(/^\.\//, "")}`;
        entries.push({ specifier, file });
      }
    }
    clientEntriesByRoot.set(pkg.root, entries);
    return entries;
  }

  // Own small project: only reached when a violation is already found, and
  // it binds just the client entry's closure, never the scanned repo.
  function exportNamesOf(file: string): ReadonlySet<string> {
    const cached = exportNamesByFile.get(file);
    if (cached) return cached;
    exportProject ??= new Project({ compilerOptions, skipAddingFilesFromTsConfig: true });
    let names: ReadonlySet<string> = new Set();
    try {
      const sf = exportProject.getSourceFile(file) ?? exportProject.addSourceFileAtPath(file);
      names = new Set(sf.getExportedDeclarations().keys());
    } catch {
      // Unreadable entry: it just cannot be suggested.
    }
    exportNamesByFile.set(file, names);
    return names;
  }

  function replacementFor(pkg: KumikoPackage, names: readonly string[]): string {
    const entries = clientEntriesOf(pkg);
    if (entries.length === 0) {
      return `${pkg.name} has no client-safe entry; keep this import in server-only code.`;
    }
    const nameable = names.length > 0 && !names.includes("*");
    const match = nameable
      ? entries.find((entry) => names.every((name) => exportNamesOf(entry.file).has(name)))
      : undefined;
    if (match) return `import ${names.join(", ")} from "${match.specifier}" instead.`;
    const what = nameable ? names.join(", ") : "this import";
    return `${what} is not exported by the client-safe entries of ${pkg.name}: ${entries.map((e) => e.specifier).join(", ")}; keep it in server-only code.`;
  }

  /** Non-client runtime plus replacement hint when `targetPath` is a server file of a Kumiko package. */
  return function judge(
    targetPath: string,
    names: readonly string[],
  ): { readonly runtime: Runtime; readonly replacement: string } | undefined {
    const pkg = packageOf(targetPath);
    if (!pkg) return undefined;
    const runtime = classifyIn(pkg, targetPath);
    if (COMPAT.client.has(runtime)) return undefined;
    return { runtime, replacement: replacementFor(pkg, names) };
  };
}

export type Violation = {
  readonly file: string;
  readonly line: number;
  readonly fileRuntime: Runtime;
  readonly importedSpec: string;
  readonly importedFile: string;
  readonly importedRuntime: Runtime;
};

/**
 * The direct-edge half of the guard: classify every scanned file, then flag
 * every value-import whose target runtime the source runtime isn't allowed
 * to depend on (`COMPAT`). `clientReachable` (from `computeClientReachablePaths`)
 * is threaded through so a file pulled into a browser bundle gets judged as
 * "client" even without its own directive/path/workspace marker.
 */
export function findRuntimeIsolationViolations(
  sourceFiles: readonly SourceFile[],
  repoRoot: string,
  workspaceCache: Map<string, Runtime | null>,
  clientReachable: ReadonlySet<string> = new Set(),
  directiveOf: DirectiveClassifier = createDirectiveClassifier(),
): {
  readonly violations: readonly Violation[];
  readonly stats: Record<Runtime, number>;
  /** Import targets (or scanned files) that resolved outside the repo root. */
  readonly outsideRoot: readonly string[];
  /** Client code importing a server entry point of an installed Kumiko package; never baselined. */
  readonly serverEntryImports: readonly ServerEntryImport[];
} {
  const violations: Violation[] = [];
  const serverEntryImports: ServerEntryImport[] = [];
  let judgeKumikoPackage: ReturnType<typeof createKumikoPackageClassifier> | undefined;
  const outsideRoot: string[] = [];
  const seenOutside = new Set<string>();
  const noteOutside = (fp: string) => {
    if (!seenOutside.has(fp)) {
      seenOutside.add(fp);
      outsideRoot.push(fp);
    }
  };
  const stats: Record<Runtime, number> = {
    runtime: 0,
    client: 0,
    prod: 0,
    dev: 0,
    tooling: 0,
    test: 0,
  };
  const withinRoot = (fp: string) => fp === repoRoot || fp.startsWith(`${repoRoot}/`);

  for (const sf of sourceFiles) {
    const fp = sf.getFilePath();
    if (fp.includes("/node_modules/") || fp.includes("/dist/")) continue;
    if (!withinRoot(fp)) {
      noteOutside(fp);
      continue;
    }
    const fileRt = classify(fp, repoRoot, workspaceCache, clientReachable, directiveOf);
    stats[fileRt]++;

    for (const { spec, targetPath, line, names } of valueModuleEdges(sf)) {
      const outsideRepoSource = targetPath.includes("/node_modules/") || !withinRoot(targetPath);
      if (fileRt === "client" && outsideRepoSource) {
        judgeKumikoPackage ??= createKumikoPackageClassifier(
          sf.getProject().getCompilerOptions(),
          directiveOf,
        );
        const serverEntry = judgeKumikoPackage(targetPath, names);
        if (serverEntry) {
          serverEntryImports.push({
            file: fp,
            line,
            importedSpec: spec,
            importedRuntime: serverEntry.runtime,
            replacement: serverEntry.replacement,
          });
        }
      }
      if (targetPath.includes("/node_modules/")) continue;
      if (!withinRoot(targetPath)) {
        noteOutside(targetPath);
        continue;
      }
      const targetRt = classify(targetPath, repoRoot, workspaceCache, clientReachable);

      if (!COMPAT[fileRt].has(targetRt)) {
        violations.push({
          file: fp,
          line,
          fileRuntime: fileRt,
          importedSpec: spec,
          importedFile: targetPath,
          importedRuntime: targetRt,
        });
      }
    }
  }

  return { violations, stats, outsideRoot, serverEntryImports };
}
