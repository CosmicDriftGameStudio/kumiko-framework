#!/usr/bin/env bun
// @runtime tooling
// check-app-tsc — runs `tsc --noEmit` per sample workspace.
//
// WHY this exists:
//
// The root `tsconfig.json#references` only points at framework packages
// (`packages/*`) and `app/`. Sample apps under `samples/` have their own
// per-app `tsconfig.json` files but aren't in the references chain — so
// `tsc -b` from the root never traverses into them. The IDE checks
// them individually (the language server picks the closest tsconfig per
// file), so developers see errors that `kumiko check` had reported as
// PASS. This script closes that gap.
//
// AUTO-DISCOVERY:
//
// Every directory under `samples/<category>/<app>/` with a `package.json`
// is included. Workspaces with their own `tsconfig.json` use it directly
// (codegen recipes with `@app/define`). Direct-import recipes without a
// per-app tsconfig share `samples/recipes/tsconfig.base.json` — they are
// the few-shot corpus source and must typecheck in CI too (#234).
//
// EXIT BEHAVIOUR:
//
// Exits non-zero if any sample workspace produces tsc diagnostics.
// Errors are printed per-workspace, plus a summary line with totals.

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { runCodegen } from "@cosmicdrift/kumiko-dev-server";

const REPO_ROOT = resolve(import.meta.dir, "..");

type SampleWorkspace = {
  readonly root: string;
  readonly tsconfig: string;
  readonly cwd: string;
  readonly ephemeralTsconfig?: string;
};

function recipeTsconfigTemplate(includeKumiko: boolean): Record<string, unknown> {
  return {
    extends: "../../../tsconfig.json",
    compilerOptions: {
      baseUrl: ".",
      paths: {
        "@cosmicdrift/kumiko-framework/*": ["../../../packages/framework/src/*/index.ts"],
        "@cosmicdrift/kumiko-bundled-features/*": [
          "../../../packages/bundled-features/src/*/index.ts",
        ],
        "@cosmicdrift/kumiko-dev-server": ["../../../packages/dev-server/src/index.ts"],
        "@cosmicdrift/kumiko-dev-server/*": ["../../../packages/dev-server/src/*"],
        ...(includeKumiko
          ? {
              "@app/define": ["./.kumiko/define.ts"],
              "@app/*": ["./.kumiko/*"],
            }
          : {}),
      },
      noEmit: true,
      rootDir: "../../..",
      lib: ["ESNext", "DOM", "DOM.Iterable"],
      types: ["bun-types"],
    },
    include: includeKumiko ? ["src", ".kumiko"] : ["src"],
  };
}

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
        out.push({ root: appPath, tsconfig: ownTsconfig, cwd: appPath });
        continue;
      }

      if (category === "recipes") {
        out.push({
          root: appPath,
          tsconfig: join(appPath, ".check-tsconfig.json"),
          cwd: appPath,
          ephemeralTsconfig: join(appPath, ".check-tsconfig.json"),
        });
      }
    }
  }
  return out.sort((a, b) => a.root.localeCompare(b.root));
}

function workspaceUsesAppDefine(appRoot: string): boolean {
  const srcDir = join(appRoot, "src");
  if (!existsSync(srcDir)) return false;
  const stack = [srcDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        stack.push(full);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const source = readFileSync(full, "utf8");
      if (source.includes("@app/define")) return true;
    }
  }
  return false;
}

type AppResult = {
  readonly name: string;
  readonly ok: boolean;
  readonly errorCount: number;
  readonly output: string;
};

function resolveTscBin(): { readonly command: string; readonly argsPrefix: readonly string[] } {
  const candidates = [
    join(REPO_ROOT, "node_modules", ".bin", "tsc"),
    join(REPO_ROOT, "..", "node_modules", ".bin", "tsc"),
  ];
  for (const bin of candidates) {
    if (existsSync(bin)) return { command: bin, argsPrefix: [] };
  }
  return { command: "bunx", argsPrefix: ["tsc"] };
}

function checkApp(workspace: SampleWorkspace): AppResult {
  const name = relative(REPO_ROOT, workspace.root);
  runCodegen({ appRoot: workspace.root });

  if (workspace.ephemeralTsconfig) {
    const includeKumiko = workspaceUsesAppDefine(workspace.root);
    Bun.write(
      workspace.ephemeralTsconfig,
      JSON.stringify(recipeTsconfigTemplate(includeKumiko), null, 2),
    );
  }

  const { command, argsPrefix } = resolveTscBin();
  const tscArgs = [...argsPrefix, "--noEmit", "-p", workspace.tsconfig];

  try {
    const result = spawnSync(command, tscArgs, {
      cwd: workspace.cwd,
      encoding: "utf8",
    });
    const combined = (result.stdout ?? "") + (result.stderr ?? "");
    const errorLines = combined.split("\n").filter((l) => / error TS\d+:/.test(l));
    return {
      name,
      ok: result.status === 0,
      errorCount: errorLines.length,
      output: errorLines.length > 0 ? errorLines.join("\n") : combined,
    };
  } finally {
    if (workspace.ephemeralTsconfig && existsSync(workspace.ephemeralTsconfig)) {
      unlinkSync(workspace.ephemeralTsconfig);
    }
  }
}

const apps = findSampleWorkspaces();
if (apps.length === 0) {
  console.log("check-app-tsc: no sample workspaces found — nothing to check.");
  process.exit(0);
}

console.log(`check-app-tsc: type-checking ${apps.length} sample workspace(s)`);

let totalErrors = 0;
const failedApps: { name: string; errorCount: number }[] = [];
for (const app of apps) {
  const r = checkApp(app);
  if (!r.ok) {
    totalErrors += r.errorCount;
    failedApps.push({ name: r.name, errorCount: r.errorCount });
    console.log(`\n--- ${r.name} (${r.errorCount} errors) ---`);
    console.log(r.output);
  } else {
    console.log(`  ✓ ${r.name}`);
  }
}

if (failedApps.length > 0) {
  console.log(`\n${totalErrors} errors across ${failedApps.length} workspace(s):`);
  for (const a of failedApps) console.log(`  - ${a.name}: ${a.errorCount}`);
  process.exit(1);
}

console.log(`\nAll ${apps.length} sample workspace(s) compile cleanly.`);
