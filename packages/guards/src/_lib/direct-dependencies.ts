/**
 * Direct dependencies declared by one repo: its root package.json and every workspace member.
 */
import { join } from "node:path";
import { readPackageJson, workspaceMemberDirs } from "./installed-packages";

const DEP_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

export type DirectDependency = {
  readonly name: string;
  readonly version: string;
};

function isFirstParty(name: string, spec: string): boolean {
  return (
    name.startsWith("@cosmicdrift/") ||
    name.startsWith("@cosmicdriftgamestudio/") ||
    name.startsWith("@app/") ||
    spec.startsWith("workspace:")
  );
}

function stringEntries(section: unknown): [string, string][] {
  if (typeof section !== "object" || section === null) return [];
  return Object.entries(section).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
}

/** Every declared (name, spec) pair across the repo, duplicates kept so each differing range stays visible. */
export function collectDeclaredDependencies(repoRoot: string): DirectDependency[] {
  const deps: DirectDependency[] = [];
  for (const dir of [repoRoot, ...workspaceMemberDirs(repoRoot)]) {
    const pkg = readPackageJson(join(dir, "package.json"));
    if (!pkg) continue;
    for (const field of DEP_FIELDS) {
      for (const [name, version] of stringEntries(pkg[field])) {
        if (!isFirstParty(name, version)) deps.push({ name, version });
      }
    }
  }
  return deps;
}

/** Unique direct dependencies by name (first declaration wins), sorted. */
export function collectDirectDependencies(repoRoot: string): DirectDependency[] {
  const byName = new Map<string, DirectDependency>();
  for (const dep of collectDeclaredDependencies(repoRoot)) {
    if (!byName.has(dep.name)) byName.set(dep.name, dep);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Every declared spec per name, so an install satisfying any one of several differing ranges counts as direct. */
export function collectDeclaredSpecsByName(
  repoRoot: string,
): ReadonlyMap<string, readonly string[]> {
  const byName = new Map<string, string[]>();
  for (const dep of collectDeclaredDependencies(repoRoot)) {
    const specs = byName.get(dep.name);
    if (specs) specs.push(dep.version);
    else byName.set(dep.name, [dep.version]);
  }
  return byName;
}

/** Pins from the root package.json `overrides` / `resolutions` (string values only). */
export function collectRootOverrides(repoRoot: string): ReadonlyMap<string, string> {
  const pkg = readPackageJson(join(repoRoot, "package.json"));
  const overrides = new Map<string, string>();
  for (const field of ["overrides", "resolutions"] as const) {
    for (const [name, value] of stringEntries(pkg?.[field])) overrides.set(name, value);
  }
  return overrides;
}
