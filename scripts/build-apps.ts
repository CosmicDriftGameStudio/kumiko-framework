#!/usr/bin/env bun
// build-apps — Wrapper-Skript, das `bun run build` in allen Workspaces
// aufruft die ein `build`-Script haben. Wir enumerieren manuell statt
// `--filter`, weil wir nur Workspaces mit vorhandenem build-Script wollen.
//
// Workspace-Discovery liest package.json#workspaces und expandiert
// single-level globs (`samples/apps/*`). Damit gibt's keine Drift wenn
// du das Repo-Layout umorganisierst.
//
// CI: `bun build:apps` ruft das hier; lokal genauso.

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const dim = "\x1b[2m";
const green = "\x1b[32m";
const red = "\x1b[31m";
const reset = "\x1b[0m";

type Workspace = { readonly name: string; readonly path: string };

type RootPackageJson = {
  workspaces?: readonly string[] | { packages?: readonly string[] };
};

async function readWorkspacePatterns(): Promise<readonly string[]> {
  const pkg = JSON.parse(await readFile("package.json", "utf8")) as RootPackageJson;
  const ws = pkg.workspaces;
  if (Array.isArray(ws)) return ws;
  if (ws && typeof ws === "object" && Array.isArray(ws.packages)) return ws.packages;
  return [];
}

// Expandiert eine Workspace-Spec zu konkreten Pfaden:
//   "packages/framework"   → ["packages/framework"]
//   "samples/apps/*"       → ["samples/apps/showcase", "samples/apps/ui-walkthrough", …]
async function expandWorkspaceSpec(spec: string): Promise<readonly string[]> {
  if (!spec.includes("*")) {
    return existsSync(spec) ? [spec] : [];
  }
  // Single-level glob: "<parent>/*" — andere Patterns würden Bun.glob
  // brauchen, kommen hier aber im Repo nicht vor.
  if (!spec.endsWith("/*")) {
    throw new Error(
      `[build-apps] unsupported workspace pattern: ${spec} — only "<dir>/*" is supported`,
    );
  }
  const parent = spec.slice(0, -2);
  if (!existsSync(parent)) return [];
  const entries = await readdir(parent, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => join(parent, e.name));
}

async function findBuildableWorkspaces(): Promise<Workspace[]> {
  const patterns = await readWorkspacePatterns();
  const result: Workspace[] = [];
  for (const pattern of patterns) {
    const paths = await expandWorkspaceSpec(pattern);
    for (const path of paths) {
      const pkgPath = join(path, "package.json");
      if (!existsSync(pkgPath)) continue;
      const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
        name?: string;
        scripts?: Record<string, string>;
      };
      if (pkg.scripts?.["build"]) {
        result.push({ name: pkg.name ?? path, path });
      }
    }
  }
  return result;
}

const workspaces = await findBuildableWorkspaces();

if (workspaces.length === 0) {
  // biome-ignore lint/suspicious/noConsole: CLI-Output
  console.log(`${dim}no workspaces with a build-script found${reset}`);
  process.exit(0);
}

// biome-ignore lint/suspicious/noConsole: CLI-Output
console.log(
  `\n  building ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}:\n`,
);
for (const ws of workspaces) {
  // biome-ignore lint/suspicious/noConsole: CLI-Output
  console.log(`    ${dim}-${reset} ${ws.name}  ${dim}(${ws.path})${reset}`);
}
// biome-ignore lint/suspicious/noConsole: CLI-Output
console.log();

let failed = 0;
for (const ws of workspaces) {
  // biome-ignore lint/suspicious/noConsole: CLI-Output
  console.log(`\n${dim}=== ${ws.name} ===${reset}`);
  const proc = Bun.spawn(["bun", "run", "build"], {
    cwd: ws.path,
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) {
    failed += 1;
    // biome-ignore lint/suspicious/noConsole: CLI-Output
    console.error(`\n  ${red}✗${reset} ${ws.name} failed (exit ${code})\n`);
  }
}

if (failed > 0) {
  // biome-ignore lint/suspicious/noConsole: CLI-Output
  console.error(`\n  ${red}✗${reset} ${failed}/${workspaces.length} workspace(s) failed\n`);
  process.exit(1);
}

// biome-ignore lint/suspicious/noConsole: CLI-Output
console.log(`\n  ${green}✓${reset} all ${workspaces.length} workspace(s) built\n`);
