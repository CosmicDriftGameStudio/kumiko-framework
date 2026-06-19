#!/usr/bin/env bun
// @runtime tooling
// check-app-tsc — type-checks every sample workspace in ONE `tsc -b` pass.
//
// WHY this exists:
//
// Sample apps under `samples/` have per-app `tsconfig.json` files but aren't in
// the root references chain, so `tsc -b` from the root never traverses them.
// This script closes that gap — the few-shot corpus must typecheck in CI (#234).
//
// WHY one `tsc -b` (not N× `tsc --noEmit`):
//
// Each sample previously ran its own `tsc --noEmit`, re-parsing the full
// framework type graph (~586 .d.ts) per sample → ~52× redundant cold work
// (~80s serial). Samples are now generated as composite projects that
// reference the framework packages; a single `tsc -b` over the generated
// solution loads each package's .d.ts once and checks all samples
// incrementally (~5s cold / ~0.1s warm via the cached *.tsbuildinfo).
//
// Samples verify the framework's BUILT public surface (.d.ts) — exactly what
// real consumers get. Framework source is checked by `tsc -b` building the
// referenced packages first (so a source error surfaces there).
//
// AUTO-DISCOVERY:
//
// Every `samples/<category>/<app>/` with a `package.json` is included.
// Workspaces with their own `tsconfig.json` use it as the template base
// (preserving app-specific options like jsx/strict); direct-import recipes
// without one share `samples/recipes/tsconfig.base.json`.
//
// EXIT BEHAVIOUR:
//
// Exits non-zero if any sample produces tsc diagnostics; errors are grouped
// per-workspace with a totals summary.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { runCodegen } from "@cosmicdrift/kumiko-dev-server";

const REPO_ROOT = resolve(import.meta.dir, "..");
const OUT_ROOT = join(REPO_ROOT, ".check-app-tsc-out");
const SOLUTION = join(REPO_ROOT, ".check-app-tsc-solution.json");
const RECIPE_TSCONFIG_BASE = resolve(REPO_ROOT, "samples/recipes/tsconfig.base.json");

// Composite packages every sample consumes as built .d.ts. tsc -b builds these
// once and redirects each sample's `src` imports to the emitted declarations.
const PACKAGE_REFS = [
  "framework",
  "bundled-features",
  "dev-server",
  "renderer",
  "renderer-web",
  "headless",
  "dispatcher-live",
] as const;

const PACKAGE_PATH_PREFIXES = PACKAGE_REFS.map((p) => `@cosmicdrift/kumiko-${p}`);

type SampleWorkspace = {
  readonly root: string;
  readonly category: string;
  readonly name: string;
  // Own tsconfig.json (apps) or null → recipe base template.
  readonly ownTsconfig: string | null;
};

type TsconfigShape = {
  extends?: string;
  compilerOptions?: { paths?: Record<string, unknown>; [k: string]: unknown };
  include?: string[];
  [k: string]: unknown;
};

function findSampleWorkspaces(): SampleWorkspace[] {
  const samplesDir = join(REPO_ROOT, "samples");
  if (!existsSync(samplesDir)) return [];

  const out: SampleWorkspace[] = [];
  for (const category of readdirSync(samplesDir)) {
    const catPath = join(samplesDir, category);
    if (!statSync(catPath).isDirectory()) continue;
    for (const app of readdirSync(catPath)) {
      const appPath = join(catPath, app);
      if (!statSync(appPath).isDirectory()) continue;
      if (!existsSync(join(appPath, "package.json"))) continue;

      const ownTsconfig = join(appPath, "tsconfig.json");
      if (existsSync(ownTsconfig)) {
        out.push({ root: appPath, category, name: app, ownTsconfig });
      } else if (category === "recipes") {
        out.push({ root: appPath, category, name: app, ownTsconfig: null });
      }
    }
  }
  return out.sort((a, b) => a.root.localeCompare(b.root));
}

function isPackagePath(key: string): boolean {
  return PACKAGE_PATH_PREFIXES.some((p) => key === p || key.startsWith(`${p}/`));
}

// Generates the sample's composite check-tsconfig (gitignored) and returns its
// path. Package `paths` that point at `src` are dropped so resolution falls to
// package exports and tsc redirects to the referenced projects' .d.ts.
function writeSampleTsconfig(ws: SampleWorkspace): string {
  const base = JSON.parse(
    readFileSync(ws.ownTsconfig ?? RECIPE_TSCONFIG_BASE, "utf8"),
  ) as TsconfigShape;
  const baseOptions = base.compilerOptions ?? {};

  const paths: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(baseOptions.paths ?? {})) {
    if (!isPackagePath(key)) paths[key] = value;
  }

  // Keep the committed config's `include` scope (so generated/tooling dirs the
  // sample never type-checked stay out). composite forbids auto-including
  // imported files, so `.kumiko` codegen — a dotfile dir that `**/*` globs skip
  // — must be listed explicitly.
  const include = [...(base.include ?? ["src"])];
  if (existsSync(join(ws.root, ".kumiko"))) {
    paths["@app/define"] = ["./.kumiko/define.ts"];
    paths["@app/*"] = ["./.kumiko/*"];
    if (!include.includes(".kumiko/**/*.ts")) include.push(".kumiko/**/*.ts");
  }

  const outDir = join(OUT_ROOT, `${ws.category}__${ws.name}`);
  const config = {
    extends: base.extends ?? "../../../tsconfig.json",
    compilerOptions: {
      ...baseOptions,
      paths,
      composite: true,
      noEmit: false,
      declaration: true,
      emitDeclarationOnly: true,
      outDir,
      tsBuildInfoFile: join(outDir, "tsconfig.tsbuildinfo"),
    },
    references: PACKAGE_REFS.map((p) => ({
      path: relative(ws.root, join(REPO_ROOT, "packages", p)),
    })),
    include,
    exclude: ["node_modules", "**/*.d.ts"],
  };

  const target = join(ws.root, ".check-tsconfig.json");
  writeFileSync(target, JSON.stringify(config, null, 2));
  return target;
}

function resolveTscBin(): { readonly command: string; readonly argsPrefix: readonly string[] } {
  for (const bin of [
    join(REPO_ROOT, "node_modules", ".bin", "tsc"),
    join(REPO_ROOT, "..", "node_modules", ".bin", "tsc"),
  ]) {
    if (existsSync(bin)) return { command: bin, argsPrefix: [] };
  }
  return { command: "bunx", argsPrefix: ["tsc"] };
}

// tsc -b kann mit exit≠0 enden OHNE eine Zeile die auf `/ error TS\d+:/` matcht
// (Spawn-Fehler, Config-Load-Fehler, `error TS6053:` ohne führendes Space).
// Ohne expliziten Hinweis druckt der Runner sonst "0 error(s) across 0
// workspace(s)" und exitet 1 → CI rot, Ursache unsichtbar (#386/1).
export function describeUnparseableTscFailure(
  result: { readonly status: number | null; readonly error?: Error },
  combined: string,
): string {
  const lines = [
    "check-app-tsc: tsc -b exited non-zero but produced no parseable `error TSxxxx:` diagnostics.",
  ];
  if (result.error) lines.push(`  spawn error: ${result.error.message}`);
  lines.push(`  exit status: ${String(result.status)}`);
  const raw = combined.trim();
  lines.push(raw.length > 0 ? `  raw tsc output:\n${combined}` : "  (no stdout/stderr captured)");
  return lines.join("\n");
}

if (import.meta.main) {
  const samples = findSampleWorkspaces();
  if (samples.length === 0) {
    console.log("check-app-tsc: no sample workspaces found — nothing to check.");
    process.exit(0);
  }

  console.log(`check-app-tsc: type-checking ${samples.length} sample workspace(s) via tsc -b`);

  mkdirSync(OUT_ROOT, { recursive: true });
  for (const ws of samples) runCodegen({ appRoot: ws.root });
  const projectPaths = samples.map((ws) => writeSampleTsconfig(ws));
  // .check-tsconfig.json is ephemeral per-sample scratch — remove it on any exit path so a run leaves no litter behind.
  process.on("exit", () => {
    for (const p of projectPaths) rmSync(p, { force: true });
  });

  writeFileSync(
    SOLUTION,
    JSON.stringify(
      { files: [], references: projectPaths.map((p) => ({ path: relative(REPO_ROOT, p) })) },
      null,
      2,
    ),
  );

  const { command, argsPrefix } = resolveTscBin();
  const result = spawnSync(command, [...argsPrefix, "-b", relative(REPO_ROOT, SOLUTION)], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  const combined = (result.stdout ?? "") + (result.stderr ?? "");
  const errorLines = combined.split("\n").filter((l) => / error TS\d+:/.test(l));

  if (errorLines.length === 0 && result.status === 0) {
    console.log(`\nAll ${samples.length} sample workspace(s) compile cleanly.`);
    process.exit(0);
  }

  // tsc failed but nothing matched the diagnostic shape — surface the raw output
  // instead of the misleading "0 error(s)" message (#386/1).
  if (errorLines.length === 0) {
    console.error(`\n${describeUnparseableTscFailure(result, combined)}`);
    process.exit(1);
  }

  // Group diagnostics by the sample whose path prefixes the error file.
  const byWorkspace = new Map<string, string[]>();
  const other: string[] = [];
  for (const line of errorLines) {
    const ws = samples.find((s) => line.startsWith(`${relative(REPO_ROOT, s.root)}/`));
    if (ws) {
      const key = relative(REPO_ROOT, ws.root);
      (byWorkspace.get(key) ?? byWorkspace.set(key, []).get(key)!).push(line);
    } else {
      other.push(line);
    }
  }

  for (const [name, lines] of [...byWorkspace.entries()].sort()) {
    console.log(`\n--- ${name} (${lines.length} errors) ---`);
    console.log(lines.join("\n"));
  }
  if (other.length > 0) {
    console.log(`\n--- other / package build (${other.length} errors) ---`);
    console.log(other.join("\n"));
  }

  console.log(`\n${errorLines.length} error(s) across ${byWorkspace.size} workspace(s).`);
  process.exit(1);
}
