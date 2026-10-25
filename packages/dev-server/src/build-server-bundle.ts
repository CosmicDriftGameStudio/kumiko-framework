// buildServerBundle — Production server bundle for Kumiko apps. Counterpart to
// buildProdBundle (client). Convention-driven discovery reads bin/main.ts
// (+ optional <repo>/bin/kumiko.ts) and produces a runtime-self-contained
// dist-server/ from which a Bun-Alpine container can boot without the monorepo.
//
// Convention:
//
//   bin/main.ts            →  dist-server/server.js   (app boot, calls runProdApp)
//   <repo>/bin/kumiko.ts   →  dist-server/kumiko.js   (migration CLI: `schema apply`,
//                             found by walking up to bin/kumiko.ts)
//   bin/worker.ts          →  dist-server/worker.js   (optional, next to bin/main.ts:
//                             background worker as its own process from the same image)
//   bin/bootstrap.ts       →  dist-server/bootstrap.js (optional, next to bin/main.ts:
//                             one-shot runBootstrap provisioning, run as a k8s Job)
//   extraEntries[i]        →  dist-server/<basename>.js (opt-in, e.g. a probe script
//                             `bin/remote-probe.ts`; CLI: repeatable `--entry <path>`)
//   dist-server/package.json → runtime dependencies with pinned versions
//
// All entries are built in ONE Bun.build call with `splitting`: the framework
// lands once as shared chunk-*.js and server.js, kumiko.js, worker.js,
// bootstrap.js and the extra entries are thin entries importing it. Separate
// bundles would inline ~14 MB per entry.
//
// Output:
//
//   dist-server/
//     server.js            ← app boot entry
//     kumiko.js            ← migration CLI entry (if bin/kumiko.ts is found)
//     worker.js            ← worker entry (if bin/worker.ts sits next to main.ts)
//     bootstrap.js         ← provisioning entry (if bin/bootstrap.ts sits next to main.ts)
//     <basename>.js        ← one per extraEntries path
//     chunk-*.js           ← shared framework chunks
//     package.json         ← runtime dependencies with pinned versions
//     bun.lock             ← written by writeServerLockfile (kumiko-build), not by buildServerBundle
//
// Externals — packages that are NOT bundled, but installed via
// `bun install` in the runtime container:
//
//   RUNTIME_EXTERNALS — needed at runtime (native bindings,
//                       worker threads, dynamic require). Added to
//                       dist-server/package.json#dependencies.
//
//   OPTIONAL_RUNTIME_EXTERNALS — external in every build, but listed in
//                       dist-server/package.json#dependencies only when an
//                       emitted file imports them or the app declares them.
//
//   BUILD_ONLY_EXTERNALS — referenced only transitively in the framework,
//                          never by app code. Tree-shaking removes them from
//                          the bundle; the external marker only disables
//                          resolution during the build. NOT in runtime dependencies.

import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseJsonOrThrow, parseJsonSafe } from "@cosmicdrift/kumiko-framework/utils";

const hasBun = typeof Bun !== "undefined";

// Packages that the bundle still references at runtime (`from "<pkg>"` after
// tree-shaking). Native bindings (argon2), worker-thread loaders (bullmq,
// ioredis), and dynamic require (postgres, temporal-polyfill) — anything that
// breaks under Bun bundling. (drizzle-kit/drizzle-orm are excluded: the
// migration path now uses the framework's runMigrationsFromDir, not drizzle-kit.)
const RUNTIME_EXTERNALS = [
  "@node-rs/argon2",
  "sharp",
  "bullmq",
  "ioredis",
  "postgres",
  "temporal-polyfill",
  "pino",
  "pino-pretty",
] as const;

// An optional framework peer: apps that import createMeilisearchAdapter reference
// it at runtime, so it must stay external (as BUILD_ONLY_EXTERNALS it crashed
// money-horse with "Cannot find package 'meilisearch'"), but apps without search
// should not install it.
const OPTIONAL_RUNTIME_EXTERNALS = ["meilisearch"] as const;

// Packages that appear only in the build stack (transitive framework imports),
// but are not referenced by app code. Without the external marker,
// bun build fails on dynamic imports. Tree-shaking removes them from the
// bundle; the marker only disables resolution during the build. NOT in
// runtime dependencies.
const BUILD_ONLY_EXTERNALS = [
  "@planetscale/database",
  "@libsql/client",
  "better-sqlite3",
  "@neondatabase/serverless",
  "@vercel/postgres",
  "mysql2",
  // ink (kumiko-tui) hat react-devtools-core als dev-only transitive import.
  "react-devtools-core",
] as const;

export type BuildServerBundleOptions = {
  /** App-Root. Default: process.cwd(). */
  readonly cwd?: string;
  /** Output folder relative to cwd. Default: "dist-server". */
  readonly outDir?: string;
  /** Additional packages that must be installed at runtime
   *  (beyond RUNTIME_EXTERNALS). App-specific; defaults to empty. */
  readonly extraRuntimeExternals?: readonly string[];
  /** Additional build-only externals. App-specific; defaults to empty. */
  readonly extraBuildOnlyExternals?: readonly string[];
  /** Additional entry points (paths relative to cwd, e.g. "bin/remote-probe.ts"),
   *  each emitted as `<basename>.js` next to server.js and sharing its chunks.
   *  A missing file or a basename that collides with a built-in entry or another
   *  extra entry throws. */
  readonly extraEntries?: readonly string[];
};

export type BuildServerBundleEntry = {
  readonly file: string;
  readonly sizeBytes: number;
};

export type BuildServerBundleResult = {
  readonly outDir: string;
  /** Named entry files (server.js, plus kumiko.js, worker.js, bootstrap.js and extra entries when present). */
  readonly entries: readonly BuildServerBundleEntry[];
  /** Shared framework chunks (from splitting). */
  readonly chunks: readonly BuildServerBundleEntry[];
  /** Total size of all outputs (entries + chunks) in bytes. */
  readonly totalBytes: number;
  readonly runtimeDeps: Readonly<Record<string, string>>;
};

// Bun names entries after the source basename (bin/main.ts → main.js). server.js
// is the runtime convention; the entry is not imported by anything (only the
// chunks are referenced by relative path), so renaming it is safe.
const ENTRY_RENAMES: Readonly<Record<string, string>> = { "main.js": "server.js" };

const OPTIONAL_SIBLING_ENTRY_NAMES = ["worker", "bootstrap"] as const;

// Output names the built-in entries occupy ("main" is renamed to server.js).
const RESERVED_ENTRY_OUTPUT_NAMES: ReadonlySet<string> = new Set([
  "server.js",
  "main.js",
  "kumiko.js",
  ...OPTIONAL_SIBLING_ENTRY_NAMES.map((name) => `${name}.js`),
]);

function resolveExtraEntries(cwd: string, extraEntries: readonly string[]): string[] {
  const claimedOutputNames = new Map<string, string>();
  return extraEntries.map((entry) => {
    const absolute = resolve(cwd, entry);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      throw new Error(
        `[buildServerBundle] extra entry "${entry}" does not exist (resolved to ${absolute}).`,
      );
    }
    const outputName = `${basename(absolute, extname(absolute))}.js`;
    if (RESERVED_ENTRY_OUTPUT_NAMES.has(outputName)) {
      throw new Error(
        `[buildServerBundle] extra entry "${entry}" would emit ${outputName}, which a built-in entry already uses. Rename the file.`,
      );
    }
    const previous = claimedOutputNames.get(outputName);
    if (previous !== undefined) {
      throw new Error(
        `[buildServerBundle] extra entries "${previous}" and "${entry}" both emit ${outputName}. Rename one of the files.`,
      );
    }
    claimedOutputNames.set(outputName, entry);
    return absolute;
  });
}

export async function buildServerBundle(
  options: BuildServerBundleOptions = {},
): Promise<BuildServerBundleResult> {
  if (!hasBun) {
    throw new Error("buildServerBundle requires Bun runtime (Bun.build is missing).");
  }

  const cwd = options.cwd ?? process.cwd();
  const outDir = resolve(cwd, options.outDir ?? "dist-server");

  const serverEntry = discoverServerEntry(cwd);
  if (!serverEntry) {
    throw new Error(
      `[buildServerBundle] No bin/main.ts in ${cwd}.\n  Convention: bin/main.ts is the server bootstrap.`,
    );
  }

  const repoRoot = findRepoRoot(cwd);
  const kumikoCli = repoRoot ? join(repoRoot, "bin/kumiko.ts") : undefined;
  if (kumikoCli && !existsSync(kumikoCli)) {
    throw new Error(
      `[buildServerBundle] Found the repo root (${repoRoot}), but bin/kumiko.ts is missing, so the migrate CLI cannot be bundled.`,
    );
  }

  const extraEntryPaths = resolveExtraEntries(cwd, options.extraEntries ?? []);

  const externals = [
    ...RUNTIME_EXTERNALS,
    ...OPTIONAL_RUNTIME_EXTERNALS,
    ...BUILD_ONLY_EXTERNALS,
    ...(options.extraRuntimeExternals ?? []),
    ...(options.extraBuildOnlyExternals ?? []),
  ];

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  // One Bun.build call with all entries plus splitting stores the framework
  // once as a shared chunk instead of inlining it into every entry.
  const optionalSiblingEntries = OPTIONAL_SIBLING_ENTRY_NAMES.map((baseName) =>
    discoverSiblingEntry(dirname(serverEntry), baseName),
  ).filter((path): path is string => path !== undefined);
  const entrypoints = [
    serverEntry,
    ...(kumikoCli ? [kumikoCli] : []),
    ...optionalSiblingEntries,
    ...extraEntryPaths,
  ];
  const result = await Bun.build({
    entrypoints,
    outdir: outDir,
    target: "bun",
    external: [...externals],
    splitting: true,
    sourcemap: "none",
    naming: { entry: "[name].js", chunk: "chunk-[hash].js" },
    minify: false,
  });
  if (!result.success) {
    const logs = result.logs.map(String).join("\n");
    throw new Error(`[buildServerBundle] build FAILED:\n${logs}`);
  }

  // Read the size from disk rather than out.size — the latter is unreliable for
  // split entry points and sometimes reports ~0 for the entry stub.
  const entries: BuildServerBundleEntry[] = [];
  const chunks: BuildServerBundleEntry[] = [];
  const emittedCode: string[] = [];
  for (const out of result.outputs) {
    emittedCode.push(await out.text());
    const base = out.path.split("/").pop() ?? out.path;
    if (out.kind === "entry-point") {
      const desired = ENTRY_RENAMES[base] ?? base;
      if (desired !== base) {
        await rename(join(outDir, base), join(outDir, desired));
      }
      entries.push({ file: desired, sizeBytes: statSync(join(outDir, desired)).size });
    } else if (out.kind === "chunk") {
      chunks.push({ file: base, sizeBytes: statSync(join(outDir, base)).size });
    }
  }
  entries.sort((a, b) => a.file.localeCompare(b.file));
  const totalBytes = [...entries, ...chunks].reduce((sum, e) => sum + e.sizeBytes, 0);

  const declaredAppDependencies = readDeclaredAppDependencies(cwd);
  const neededOptionalExternals = OPTIONAL_RUNTIME_EXTERNALS.filter(
    (pkg) =>
      declaredAppDependencies.has(pkg) || emittedCode.some((code) => importsBarePackage(code, pkg)),
  );
  const runtimeDeps = await resolveRuntimeDepsVersions(cwd, repoRoot, [
    ...RUNTIME_EXTERNALS,
    ...neededOptionalExternals,
    ...(options.extraRuntimeExternals ?? []),
  ]);

  const runtimePkg = {
    name: derivePkgName(cwd),
    private: true,
    type: "module",
    scripts: { start: "bun run server.js" },
    dependencies: runtimeDeps,
  };
  await writeFile(join(outDir, "package.json"), `${JSON.stringify(runtimePkg, null, 2)}\n`);

  return { outDir, entries, chunks, totalBytes, runtimeDeps };
}

export function discoverServerEntry(cwd: string): string | undefined {
  return discoverSiblingEntry(join(cwd, "bin"), "main");
}

// `.ts` wins over `.js`, same precedence for the server entry and its siblings.
function discoverSiblingEntry(dir: string, baseName: string): string | undefined {
  for (const extension of [".ts", ".js"]) {
    const candidate = join(dir, `${baseName}${extension}`);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

// Walk up from the app cwd until a directory containing `bin/kumiko.ts` is found.
// Failsafe: stop after 8 levels. If nothing is found, there is no repo root,
// so the function returns undefined and the caller skips the CLI bundle.
function findRepoRoot(start: string): string | undefined {
  let cur = start;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(cur, "bin/kumiko.ts"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) return undefined;
    cur = parent;
  }
  return undefined;
}

export type KumikoBuildArgs = {
  readonly appDir: string | undefined;
  readonly extraEntries: readonly string[];
};

/** Parse `kumiko-build [app-dir] [--entry <path>]...` (also `--entry=<path>`).
 *  Unknown flags and a missing `--entry` value throw instead of being ignored. */
export function parseKumikoBuildArgs(args: readonly string[]): KumikoBuildArgs {
  let appDir: string | undefined;
  const extraEntries: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === undefined) break;
    if (arg === "--entry" || arg.startsWith("--entry=")) {
      const value = arg === "--entry" ? args[++i] : arg.slice("--entry=".length);
      if (value === undefined || value === "") {
        throw new Error("kumiko-build: --entry needs a path, e.g. --entry bin/remote-probe.ts");
      }
      extraEntries.push(value);
    } else if (arg.startsWith("-")) {
      throw new Error(`kumiko-build: unknown option ${arg}`);
    } else if (appDir === undefined) {
      appDir = arg;
    } else {
      throw new Error(`kumiko-build: unexpected argument ${arg}`);
    }
  }
  return { appDir, extraEntries };
}

/** Read `package.json#kumiko.extraRuntimeExternals` for kumiko-build.
 *  Invalid / missing shapes → empty list (CLI stays convention-driven). */
export function readExtraRuntimeExternals(cwd: string): readonly string[] {
  const pkgJson = join(cwd, "package.json");
  if (!existsSync(pkgJson)) return [];
  let raw: string;
  try {
    raw = readFileSync(pkgJson, "utf-8");
  } catch {
    return [];
  }
  const parsed = parseJsonSafe<{
    kumiko?: { extraRuntimeExternals?: unknown };
  }>(raw, {});
  const list = parsed.kumiko?.extraRuntimeExternals;
  if (!Array.isArray(list)) return [];
  return list.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

// Static, dynamic and CommonJS imports of an external survive bundling as a bare specifier
// (require becomes __require(...)).
function importsBarePackage(code: string, pkg: string): boolean {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:\\bfrom\\s*|\\bimport\\s*\\(?\\s*|\\w*[rR]equire\\w*\\s*\\(\\s*)["'\`]${escaped}["'\`]`,
  ).test(code);
}

function readDeclaredAppDependencies(cwd: string): ReadonlySet<string> {
  const appPkg = join(cwd, "package.json");
  if (!existsSync(appPkg)) return new Set();
  const parsed = parseJsonSafe<{
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  }>(readFileSync(appPkg, "utf-8"), {});
  return new Set([
    ...Object.keys(parsed.dependencies ?? {}),
    ...Object.keys(parsed.optionalDependencies ?? {}),
  ]);
}

// Resolve versions for the runtime externals: first from installed
// node_modules/@cosmicdrift/*-packages (relative to cwd, which works for
// any consumer app), then additionally from packages/framework + bundled-
// features (the framework's own workspace checkout). Fall back to "*"
// when no source knows the package name.
async function resolveRuntimeDepsVersions(
  cwd: string,
  repoRoot: string | undefined,
  packages: readonly string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};

  const pinSources = [
    ...(repoRoot
      ? [
          join(repoRoot, "packages/framework/package.json"),
          join(repoRoot, "packages/bundled-features/package.json"),
        ]
      : []),
    // node_modules applied last among framework sources so installed versions
    // win over the repo-root fallback.
    join(cwd, "node_modules/@cosmicdrift/kumiko-framework/package.json"),
    join(cwd, "node_modules/@cosmicdrift/kumiko-bundled-features/package.json"),
  ];
  const allDeps: Record<string, string> = {};
  for (const path of pinSources) {
    if (!existsSync(path)) continue;
    const raw = await readFile(path, "utf-8");
    const parsed = parseJsonOrThrow<{
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
    }>(raw, path);
    // Peers first: a real dependency of the same source overrides a peer range.
    Object.assign(
      allDeps,
      parsed.peerDependencies ?? {},
      parsed.dependencies ?? {},
      parsed.optionalDependencies ?? {},
    );
  }
  // App package.json fills gaps only — pins extraRuntimeExternals without
  // overriding framework-native pins the app may also list.
  const appPkg = join(cwd, "package.json");
  if (existsSync(appPkg)) {
    const raw = await readFile(appPkg, "utf-8");
    const parsed = parseJsonOrThrow<{
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    }>(raw, appPkg);
    for (const [name, ver] of Object.entries({
      ...(parsed.dependencies ?? {}),
      ...(parsed.optionalDependencies ?? {}),
    })) {
      if (allDeps[name] === undefined) allDeps[name] = ver;
    }
  }
  for (const pkg of packages) {
    out[pkg] = allDeps[pkg] ?? "*";
  }
  return out;
}

function derivePkgName(cwd: string): string {
  const pkgJson = join(cwd, "package.json");
  if (!existsSync(pkgJson)) return "kumiko-app-runtime";
  // existsSync/readFileSync race (deleted between the two calls) or a
  // permission error must fall back like a missing file, not crash the
  // build — read here too, not just the JSON.parse below.
  let raw: string;
  try {
    raw = readFileSync(pkgJson, "utf-8");
  } catch {
    return "kumiko-app-runtime";
  }
  const parsed = parseJsonSafe<{ name?: string }>(raw, {});
  return parsed.name ? `${parsed.name}-runtime` : "kumiko-app-runtime";
}

export function formatServerBuildResult(
  result: BuildServerBundleResult,
  durationMs: number,
): string {
  const cyan = "\x1b[36m";
  const dim = "\x1b[2m";
  const green = "\x1b[32m";
  const reset = "\x1b[0m";
  // @wrapper-known semantic-alias
  const mb = (bytes: number): string => (bytes / 1024 / 1024).toFixed(2);
  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${green}✓${reset} server bundle ${dim}(${durationMs}ms)${reset}`);
  for (const entry of result.entries) {
    lines.push(`    ${cyan}→${reset} ${entry.file}  ${mb(entry.sizeBytes)} MB`);
  }
  if (result.chunks.length > 0) {
    const chunkBytes = result.chunks.reduce((sum, c) => sum + c.sizeBytes, 0);
    lines.push(
      `    ${cyan}→${reset} ${result.chunks.length} shared chunk(s)  ${mb(chunkBytes)} MB`,
    );
  }
  const depCount = Object.keys(result.runtimeDeps).length;
  lines.push(
    `    ${dim}total: ${mb(result.totalBytes)} MB · runtime-deps: ${depCount} packages${reset}`,
  );
  return lines.join("\n");
}
