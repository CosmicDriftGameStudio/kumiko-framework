// buildServerBundle — Production-Server-Bundle für Kumiko-Apps. Pendant zu
// buildProdBundle (Client). Convention-Driven Discovery liest bin/main.ts
// (+ optional <repo>/bin/kumiko.ts) und produziert ein runtime-self-contained
// dist-server/ aus dem ein Bun-Alpine-Container ohne Monorepo bootet.
//
// Convention:
//
//   bin/main.ts            →  dist-server/server.js   (App-Boot, ruft runProdApp)
//   <repo>/bin/kumiko.ts   →  dist-server/kumiko.js   (Migrate-CLI: `schema apply`,
//                             gefunden via walk-up bis bin/kumiko.ts)
//   dist-server/package.json → runtime-deps mit gepinnten Versionen
//
// Beide Entries werden in EINEM Bun.build-Call mit `splitting` gebaut: das
// Framework landet als geteilte chunk-*.js, server.js + kumiko.js sind schlanke
// Entries die sie importieren — statt das Framework pro Entry neu zu inlinen
// (vorher ~14 MB × N separate Bundles).
//
// Output:
//
//   dist-server/
//     server.js            ← App-Boot-Entry
//     kumiko.js            ← Migrate-CLI-Entry (wenn bin/kumiko.ts gefunden)
//     chunk-*.js           ← geteilte Framework-Chunks
//     package.json         ← runtime-deps mit gepinnten Versionen
//
// Externals — Pakete die NICHT ins Bundle gebakt werden, sondern via
// `bun install` im Runtime-Container nachgeholt werden:
//
//   RUNTIME_EXTERNALS — wird zur Laufzeit gebraucht (native bindings,
//                       worker-threads, dynamic-require). Landet in
//                       dist-server/package.json#dependencies.
//
//   BUILD_ONLY_EXTERNALS — referenziert nur transitiv im Framework, vom
//                          App-Code aber nie. Tree-Shake wirft sie aus dem
//                          Bundle, der external-Marker schaltet nur das
//                          resolution-during-build ab. NICHT in runtime-deps.

import { existsSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseJsonOrThrow, parseJsonSafe } from "@cosmicdrift/kumiko-framework/utils";

const hasBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

// Pakete die das Bundle zur Laufzeit weiter referenziert (`from "<pkg>"` nach
// Tree-Shake). Native bindings (argon2), worker-thread-Loader (bullmq,
// ioredis), dynamic-require (postgres, temporal-polyfill) — alles was unter
// Bun-bundling bricht. (drizzle-kit/drizzle-orm sind raus: der Migrate-Pfad
// nutzt jetzt den framework-eigenen runMigrationsFromDir, kein drizzle-kit.)
// meilisearch: bewusst hier, nicht in BUILD_ONLY_EXTERNALS unten — Apps die
// createMeilisearchAdapter (kumiko-framework/search/meilisearch) importieren,
// referenzieren das Paket zur Laufzeit (kein natives Binding, reiner
// HTTP-Client, aber echter Runtime-Import). Bug gefunden 2026-07-19: money-horse
// Prod-Crash "Cannot find package 'meilisearch'", weil es vorher fälschlich in
// BUILD_ONLY_EXTERNALS stand.
const RUNTIME_EXTERNALS = [
  "@node-rs/argon2",
  "bullmq",
  "ioredis",
  "postgres",
  "temporal-polyfill",
  "pino",
  "pino-pretty",
  "meilisearch",
] as const;

// Pakete die nur im Build-Stack erscheinen (transitive Imports im Framework),
// aber vom App-Code nicht referenziert werden. Ohne external-Markierung
// scheitert bun build an dynamic-imports. Tree-Shake wirft sie eh aus dem
// Bundle — der Marker schaltet nur das resolution-during-build ab. NICHT in
// runtime-deps.
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
  /** Output-Folder relativ zu cwd. Default: "dist-server". */
  readonly outDir?: string;
  /** Zusätzliche Pakete die zur Laufzeit installiert sein müssen
   *  (beyond RUNTIME_EXTERNALS). App-spezifisch — Default leer. */
  readonly extraRuntimeExternals?: readonly string[];
  /** Zusätzliche Build-only-Externals. App-spezifisch — Default leer. */
  readonly extraBuildOnlyExternals?: readonly string[];
};

export type BuildServerBundleEntry = {
  readonly file: string;
  readonly sizeBytes: number;
};

export type BuildServerBundleResult = {
  readonly outDir: string;
  /** Benannte Entry-Files (server.js, ggf. kumiko.js). */
  readonly entries: readonly BuildServerBundleEntry[];
  /** Geteilte Framework-Chunks (von splitting). */
  readonly chunks: readonly BuildServerBundleEntry[];
  /** Gesamt-Größe aller Outputs (entries + chunks) in Bytes. */
  readonly totalBytes: number;
  readonly runtimeDeps: Readonly<Record<string, string>>;
};

// Bun benennt Entries nach Source-Basename (bin/main.ts → main.js). server.js
// ist die Runtime-Convention; der Entry wird von nichts importiert (nur die
// chunks werden referenziert, per relativem Pfad), darum ist der Rename sicher.
const ENTRY_RENAMES: Readonly<Record<string, string>> = { "main.js": "server.js" };

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
      `[buildServerBundle] Kein bin/main.ts in ${cwd}.\n  Convention: bin/main.ts ist der Server-Bootstrap.`,
    );
  }

  const repoRoot = findRepoRoot(cwd);
  const kumikoCli = repoRoot ? join(repoRoot, "bin/kumiko.ts") : undefined;
  if (kumikoCli && !existsSync(kumikoCli)) {
    throw new Error(
      `[buildServerBundle] Repo-Root erkannt (${repoRoot}), aber bin/kumiko.ts fehlt — kann Migrate-CLI nicht bündeln.`,
    );
  }

  const externals = [
    ...RUNTIME_EXTERNALS,
    ...BUILD_ONLY_EXTERNALS,
    ...(options.extraRuntimeExternals ?? []),
    ...(options.extraBuildOnlyExternals ?? []),
  ];

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  // Ein Bun.build-Call mit allen Entries + splitting → das Framework wird
  // einmal als shared chunk abgelegt statt pro Entry inlined.
  const entrypoints = kumikoCli ? [serverEntry, kumikoCli] : [serverEntry];
  const result = await Bun.build({
    entrypoints,
    outdir: outDir,
    target: "bun",
    external: externals as string[],
    splitting: true,
    sourcemap: "none",
    naming: { entry: "[name].js", chunk: "chunk-[hash].js" },
    minify: false,
  });
  if (!result.success) {
    const logs = result.logs.map(String).join("\n");
    throw new Error(`[buildServerBundle] build FAILED:\n${logs}`);
  }

  // Größe von Disk lesen, nicht aus out.size — letzteres ist für gesplittete
  // Entry-Points unzuverlässig (meldet teils ~0 für den Entry-Stub).
  const entries: BuildServerBundleEntry[] = [];
  const chunks: BuildServerBundleEntry[] = [];
  for (const out of result.outputs) {
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

  const runtimeDeps = await resolveRuntimeDepsVersions(repoRoot, [
    ...RUNTIME_EXTERNALS,
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
  const tsEntry = join(cwd, "bin/main.ts");
  if (existsSync(tsEntry)) return tsEntry;
  const jsEntry = join(cwd, "bin/main.js");
  if (existsSync(jsEntry)) return jsEntry;
  return undefined;
}

// Walking up vom App-cwd bis ein Verzeichnis mit `bin/kumiko.ts` gefunden wird.
// Failsafe: nach 8 Levels aufgeben — nichts gefunden, kein Repo-Root, dann
// liefert die Funktion undefined und der Caller skippt das CLI-Bundle.
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

// Versionen für RUNTIME_EXTERNALS auflösen: erst aus framework + bundled-
// features package.json (Workspace-pinning), Fallback auf "*" wenn nichts
// gefunden. Ein Repo-Root muss existieren — sonst kann eh kein CLI-Bundle
// gemacht werden, also wird die Funktion gar nicht erst gerufen.
async function resolveRuntimeDepsVersions(
  repoRoot: string | undefined,
  packages: readonly string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!repoRoot) {
    for (const pkg of packages) out[pkg] = "*";
    return out;
  }

  const pinSources = [
    join(repoRoot, "packages/framework/package.json"),
    join(repoRoot, "packages/bundled-features/package.json"),
  ];
  const allDeps: Record<string, string> = {};
  for (const path of pinSources) {
    if (!existsSync(path)) continue;
    const raw = await readFile(path, "utf-8");
    const parsed = parseJsonOrThrow<{ dependencies?: Record<string, string> }>(raw, path);
    Object.assign(allDeps, parsed.dependencies ?? {});
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
