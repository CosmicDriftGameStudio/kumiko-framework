// buildServerBundle — Production-Server-Bundle für Kumiko-Apps. Pendant
// zu buildProdBundle (Client). Convention-Driven Discovery liest
// bin/main.ts + optional drizzle/migration-hooks.ts und produziert ein
// runtime-self-contained dist-server/ aus dem ein Bun-Alpine-Container
// ohne Monorepo bootet.
//
// Convention:
//
//   bin/main.ts                      →  dist-server/server.js
//                                       (App-Boot, ruft runProdApp)
//   <repo>/bin/kumiko.ts             →  dist-server/kumiko.js
//                                       (Migrate-CLI für Pre-Deploy-Step,
//                                        gefunden durch walk-up bis bin/kumiko.ts)
//   drizzle/migration-hooks.ts       →  dist-server/migration-hooks.js
//                                       (optional — Projection-Rebuild-Marker-
//                                        Reader, wird via KUMIKO_MIGRATION_HOOKS
//                                        env-var von der CLI gefunden)
//   drizzle.config.ts                →  dist-server/drizzle.config.ts
//                                       (drizzle-kit lädt's per Convention.
//                                        kumikoDrizzleConfig-Helper-Imports
//                                        werden inlined damit der Container
//                                        kein @cosmicdrift/kumiko-dev-server-Paket
//                                        installiert haben muss.)
//   dist-server/package.json         →  generiert mit Versionen aus framework +
//                                       bundled-features package.json
//
// Output:
//
//   dist-server/
//     server.js                      ← App-Boot-Entry (~1 MB)
//     kumiko.js                      ← Migrate-CLI (~1 MB)
//     migration-hooks.js             ← Rebuild-Marker-Reader (optional, ~1 MB)
//     drizzle.config.ts              ← gebundelter drizzle-kit-Config (~10 KB)
//     package.json                   ← runtime-deps mit gepinnten Versionen
//
// Externals — Pakete die NICHT ins Bundle gebakt werden, sondern via
// `bun install` im Runtime-Container nachgeholt werden:
//
//   RUNTIME_EXTERNALS — wird zur Laufzeit gebraucht (native bindings,
//                       worker-threads, dynamic-require). Landet in
//                       dist-server/package.json#dependencies.
//
//   BUILD_ONLY_EXTERNALS — referenziert nur transitiv im Framework, vom
//                          App-Code aber nie. Tree-Shake wirft sie aus
//                          dem Bundle, der external-Marker schaltet nur
//                          das resolution-during-build ab. NICHT in
//                          runtime-deps.
//
// Beide Listen leben hier zentral statt pro-App. Wenn eine App ein neues
// natively-bound Paket nutzt, fällt es heute in die App-eigene Boilerplate
// (oder via opts.extraRuntimeExternals) — das wird sich mit
// auto-Detection entwickeln.

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const hasBun = typeof (globalThis as { Bun?: unknown }).Bun !== "undefined";

// Pakete die das Bundle zur Laufzeit weiter referenziert (`from "<pkg>"`
// nach Tree-Shake). Native bindings (argon2), worker-thread-Loader (bullmq,
// ioredis), dynamic-require (postgres, temporal-polyfill) — alles was
// unter Bun-bundling bricht.
//
// `drizzle-kit` + `drizzle-orm` sind im Bundle 0 Refs (drizzle-orm wird
// inline gebakt), liegen aber in runtime-deps damit der Pre-Deploy-
// Migrate-Step (`bun /app/kumiko.js migrate apply`) drizzle-kit als CLI
// findet. drizzle-kit prüft beim Start ob drizzle-orm separat installiert
// ist und exit'tet sonst mit "Please install latest version of drizzle-orm".
const RUNTIME_EXTERNALS = [
  "@node-rs/argon2",
  "bullmq",
  "drizzle-kit",
  "drizzle-orm",
  "ioredis",
  "postgres",
  "temporal-polyfill",
] as const;

// Pakete die nur im Build-Stack erscheinen (transitive Imports im
// Framework), aber vom App-Code nicht referenziert werden. Ohne external-
// Markierung scheitert bun build an dynamic-imports (z.B. drizzle-kit →
// @libsql/client). Tree-Shake wirft sie eh aus dem Bundle — der Marker
// schaltet nur das resolution-during-build ab. NICHT in runtime-deps.
const BUILD_ONLY_EXTERNALS = ["meilisearch", "pino", "pino-pretty", "@aws-sdk/*"] as const;

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
  readonly entries: readonly BuildServerBundleEntry[];
  readonly runtimeDeps: Readonly<Record<string, string>>;
  /** undefined wenn keine drizzle/migration-hooks.ts existiert. */
  readonly migrationHooks: BuildServerBundleEntry | undefined;
};

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
  const migrationHooks = discoverMigrationHooks(cwd);
  const drizzleConfig = discoverDrizzleConfig(cwd);

  const externals = [
    ...RUNTIME_EXTERNALS,
    ...BUILD_ONLY_EXTERNALS,
    ...(options.extraRuntimeExternals ?? []),
    ...(options.extraBuildOnlyExternals ?? []),
  ];

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const entries: BuildServerBundleEntry[] = [];
  entries.push(await bundleEntry(serverEntry, outDir, "server.js", externals));
  if (kumikoCli) {
    entries.push(await bundleEntry(kumikoCli, outDir, "kumiko.js", externals));
  }
  let migrationHooksEntry: BuildServerBundleEntry | undefined;
  if (migrationHooks) {
    migrationHooksEntry = await bundleEntry(
      migrationHooks,
      outDir,
      "migration-hooks.js",
      externals,
    );
    entries.push(migrationHooksEntry);
  }
  // drizzle.config.ts wird mit-bundelt damit drizzle-kit migrate im
  // Runtime-Container den kumikoDrizzleConfig-Helper nicht via
  // @cosmicdrift/kumiko-dev-server resolven muss (das Paket ist nicht installiert).
  // Output behält die .ts-Endung — drizzle-kit's TS-Loader akzeptiert
  // bundled JavaScript.
  if (drizzleConfig) {
    entries.push(await bundleEntry(drizzleConfig, outDir, "drizzle.config.ts", externals));
  }

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

  return { outDir, entries, runtimeDeps, migrationHooks: migrationHooksEntry };
}

async function bundleEntry(
  entry: string,
  outDir: string,
  naming: string,
  externals: readonly string[],
): Promise<BuildServerBundleEntry> {
  const result = await Bun.build({
    entrypoints: [entry],
    outdir: outDir,
    target: "bun",
    external: externals as string[],
    naming,
    minify: false,
  });
  if (!result.success) {
    const logs = result.logs.map(String).join("\n");
    throw new Error(`[buildServerBundle] Bundle ${naming} FAILED:\n${logs}`);
  }
  const out = result.outputs[0];
  if (!out) {
    throw new Error(`[buildServerBundle] Bundle ${naming}: no output produced.`);
  }
  return { file: naming, sizeBytes: out.size };
}

export function discoverServerEntry(cwd: string): string | undefined {
  const tsEntry = join(cwd, "bin/main.ts");
  if (existsSync(tsEntry)) return tsEntry;
  const jsEntry = join(cwd, "bin/main.js");
  if (existsSync(jsEntry)) return jsEntry;
  return undefined;
}

export function discoverDrizzleConfig(cwd: string): string | undefined {
  const path = join(cwd, "drizzle.config.ts");
  return existsSync(path) ? path : undefined;
}

export function discoverMigrationHooks(cwd: string): string | undefined {
  const path = join(cwd, "drizzle/migration-hooks.ts");
  return existsSync(path) ? path : undefined;
}

// Walking up vom App-cwd bis ein Verzeichnis mit `bin/kumiko.ts` und einer
// monorepo-package.json (workspaces[]) gefunden wird. Failsafe: nach 8
// Levels aufgeben — nichts gefunden, kein Repo-Root, dann liefert die
// Funktion undefined und der Caller skippt das CLI-Bundle.
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
    const parsed = JSON.parse(raw) as { dependencies?: Record<string, string> };
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
  try {
    const parsed = JSON.parse(readFileSync(pkgJson, "utf-8")) as { name?: string };
    return parsed.name ? `${parsed.name}-runtime` : "kumiko-app-runtime";
  } catch {
    return "kumiko-app-runtime";
  }
}

export function formatServerBuildResult(
  result: BuildServerBundleResult,
  durationMs: number,
): string {
  const cyan = "\x1b[36m";
  const dim = "\x1b[2m";
  const green = "\x1b[32m";
  const reset = "\x1b[0m";
  const lines: string[] = [];
  lines.push("");
  lines.push(`  ${green}✓${reset} server bundle ${dim}(${durationMs}ms)${reset}`);
  for (const entry of result.entries) {
    const sizeMb = (entry.sizeBytes / 1024 / 1024).toFixed(2);
    lines.push(`    ${cyan}→${reset} ${entry.file}  ${sizeMb} MB`);
  }
  const depCount = Object.keys(result.runtimeDeps).length;
  lines.push(`    ${dim}runtime-deps: ${depCount} packages${reset}`);
  return lines.join("\n");
}
