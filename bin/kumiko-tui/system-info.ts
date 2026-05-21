// System-Infos für die Sidebar — Versionen, Git, Workspace-Detection.
// Async wo nötig (git), sync sonst (process.versions, package.json).

import { existsSync, readFileSync } from "node:fs";
import { join, resolve as resolvePath } from "node:path";
import { spawnSync } from "node:child_process";

export type SystemInfo = {
  readonly kumiko: string;
  readonly bun: string | undefined;
  readonly node: string;
  readonly gitBranch: string | undefined;
  readonly gitDirty: boolean;
  readonly featureCount: number;
};

// Liest die kumiko-framework Version aus dem TOP-LEVEL package.json.
// Das script lebt in `bin/kumiko.ts`, also bin/ → ".." = repo-root.
const FRAMEWORK_ROOT = resolvePath(import.meta.dir, "..", "..");

export function collectSystemInfo(): SystemInfo {
  return {
    kumiko: readPkgVersion(FRAMEWORK_ROOT),
    bun: process.versions["bun"],
    node: process.versions.node,
    gitBranch: gitBranch(),
    gitDirty: gitDirty(),
    featureCount: countBundledFeatures(),
  };
}

function readPkgVersion(dir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "?";
  }
}

function gitBranch(): string | undefined {
  const r = spawnSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: process.cwd(),
    encoding: "utf-8",
  });
  if (r.status !== 0) return undefined;
  return r.stdout.trim() || undefined;
}

function gitDirty(): boolean {
  const r = spawnSync("git", ["status", "--porcelain"], {
    cwd: process.cwd(),
    encoding: "utf-8",
  });
  if (r.status !== 0) return false;
  return r.stdout.trim().length > 0;
}

function countBundledFeatures(): number {
  // Sprint A heuristic: zählt die direct subdirectories unter
  // packages/bundled-features/src. Sprint B liest aus der Registry.
  const bf = join(FRAMEWORK_ROOT, "packages/bundled-features/src");
  if (!existsSync(bf)) return 0;
  try {
    const { readdirSync } = require("node:fs") as { readdirSync: typeof import("node:fs").readdirSync };
    const entries = readdirSync(bf, { withFileTypes: true });
    return entries.filter((e: { isDirectory: () => boolean; name: string }) => e.isDirectory() && !e.name.startsWith("_")).length;
  } catch {
    return 0;
  }
}
