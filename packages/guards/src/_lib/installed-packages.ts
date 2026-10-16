/**
 * Installed third-party packages of one repo, found the way Bun resolves them:
 * node_modules of the repo root, of its workspace members and of every
 * ancestor directory (a hoisted parent workspace or a `.wt/` worktree has no
 * node_modules of its own).
 */
import { type Dirent, existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";

export type InstalledPackage = {
  readonly name: string;
  readonly version: string;
  readonly license: string | null;
  readonly path: string;
};

const FIRST_PARTY_SCOPES = ["@cosmicdrift/", "@cosmicdriftgamestudio/", "@app/"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readPackageJson(file: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf-8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Workspace member directories declared by the repo's package.json `workspaces`. */
export function workspaceMemberDirs(repoRoot: string): string[] {
  const workspaces = readPackageJson(join(repoRoot, "package.json"))?.["workspaces"];
  const patterns = Array.isArray(workspaces)
    ? workspaces
    : isRecord(workspaces) && Array.isArray(workspaces["packages"])
      ? workspaces["packages"]
      : [];
  const dirs = new Set<string>();
  for (const pattern of patterns) {
    if (typeof pattern !== "string" || pattern.startsWith("!")) continue;
    for (const match of new Bun.Glob(pattern).scanSync({ cwd: repoRoot, onlyFiles: false })) {
      const dir = join(repoRoot, match);
      if (existsSync(join(dir, "package.json"))) dirs.add(dir);
    }
  }
  return [...dirs];
}

/** `node_modules` directories Bun would load from for this repo, nearest first. */
export function nodeModulesDirs(repoRoot: string): string[] {
  const dirs: string[] = [];
  const add = (dir: string): void => {
    const nodeModules = join(dir, "node_modules");
    if (!dirs.includes(nodeModules) && existsSync(nodeModules)) dirs.push(nodeModules);
  };
  add(repoRoot);
  for (const member of workspaceMemberDirs(repoRoot)) add(member);
  for (let dir = dirname(repoRoot); ; dir = dirname(dir)) {
    add(dir);
    if (dirname(dir) === dir) break;
  }
  return dirs;
}

/** Directories whose node_modules a scan of `repoRoot` reads — also where their exception files live. */
export function installationRoots(repoRoot: string): string[] {
  return [repoRoot, ...nodeModulesDirs(repoRoot).map((dir) => dirname(dir))];
}

export function collectInstalledPackages(repoRoot: string): InstalledPackage[] {
  const seen = new Map<string, InstalledPackage>();
  const visited = new Set<string>();
  for (const dir of nodeModulesDirs(repoRoot)) walkNodeModules(dir, seen, visited);
  return [...seen.values()].sort((a, b) =>
    `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`),
  );
}

function readUnvisitedDir(dir: string, visited: Set<string>): Dirent[] {
  try {
    const real = realpathSync(dir);
    if (visited.has(real)) return [];
    visited.add(real);
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function walkNodeModules(
  dir: string,
  seen: Map<string, InstalledPackage>,
  visited: Set<string>,
): void {
  const entries = readUnvisitedDir(dir, visited);
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.name.startsWith("@")) {
      walkNodeModules(full, seen, visited);
      continue;
    }
    const info = readPackageInfo(join(full, "package.json"));
    if (info && !seen.has(`${info.name}@${info.version}`)) {
      seen.set(`${info.name}@${info.version}`, info);
    }
    walkNodeModules(join(full, "node_modules"), seen, visited);
  }
}

function readPackageInfo(file: string): InstalledPackage | undefined {
  const pkg = readPackageJson(file);
  if (!pkg) return undefined;
  const { name, version } = pkg;
  if (typeof name !== "string" || typeof version !== "string") return undefined;
  // Workspace members and the repo's own scopes are first-party, not third-party licences.
  if (pkg["private"] === true || FIRST_PARTY_SCOPES.some((scope) => name.startsWith(scope))) {
    return undefined;
  }
  return {
    name,
    version,
    license: normalizeLicense(pkg["license"] ?? pkg["licenses"]),
    path: file,
  };
}

function licenseTypeOf(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry.trim() || undefined;
  if (isRecord(entry) && typeof entry["type"] === "string")
    return entry["type"].trim() || undefined;
  return undefined;
}

/** SPDX string from package.json `license` (string | {type}) or legacy `licenses` (array). */
export function normalizeLicense(raw: unknown): string | null {
  if (Array.isArray(raw)) {
    const parts = raw.map(licenseTypeOf).filter((part): part is string => part !== undefined);
    if (parts.length === 0) return null;
    return parts.length === 1 ? (parts[0] ?? null) : `(${parts.join(" OR ")})`;
  }
  return licenseTypeOf(raw) ?? null;
}
