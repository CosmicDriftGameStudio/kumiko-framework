// Deprecated-dependency check over ONE repo.
//
// Default: fails on any installed direct dependency whose npm registry metadata marks the
// installed version `deprecated`. General outdated listing is Renovate's job; `--report`
// adds deprecated transitive packages and a major-lag warning list (never blocking).
// Single-repo by design: declared dependencies are the scanned repo's root and workspace
// members; installed packages come from node_modules of the repo, its members and ancestors.
import { parseDependencyCli } from "./_lib/dependency-cli";
import {
  collectDeclaredSpecsByName,
  collectDirectDependencies,
  collectRootOverrides,
} from "./_lib/direct-dependencies";
import { collectInstalledPackages, type InstalledPackage } from "./_lib/installed-packages";
import {
  createBunInfoClient,
  findMajorLagWarning,
  mapWithConcurrency,
  memoizeRegistryClient,
  type RegistryClient,
} from "./_lib/npm-registry";

const REGISTRY_CONCURRENCY = 10;

type NameAndVersion = { readonly name: string; readonly version: string };

export type DeprecatedPackage = NameAndVersion & { readonly message: string };

export async function findDeprecatedPackages(
  packages: readonly NameAndVersion[],
  registry: RegistryClient,
): Promise<DeprecatedPackage[]> {
  const unique = [...new Map(packages.map((pkg) => [`${pkg.name}@${pkg.version}`, pkg])).values()];
  const results = await mapWithConcurrency(unique, REGISTRY_CONCURRENCY, async (pkg) => {
    const message = await registry.deprecatedMessage(pkg.name, pkg.version);
    return message ? { name: pkg.name, version: pkg.version, message } : null;
  });
  return results.filter((r): r is DeprecatedPackage => r !== null);
}

// A spec that is not a plain semver range (workspace:, catalog:, a git URL, "latest") has nothing to compare against; matching it by name alone can only over-report, never hide a deprecated package.
function isComparableRange(spec: string): boolean {
  return /^[\d~^><=]/.test(spec.trim());
}

export function isDeclaredInstall(installedVersion: string, declaredSpec: string): boolean {
  if (!isComparableRange(declaredSpec)) return true;
  return Bun.semver.satisfies(installedVersion, declaredSpec);
}

export function selectDirectInstalledPackages<T extends NameAndVersion>(
  installed: readonly T[],
  declaredSpecs: ReadonlyMap<string, readonly string[]>,
  overrides: ReadonlyMap<string, string> = new Map(),
): T[] {
  const byName = new Map<string, T[]>();
  for (const pkg of installed) {
    if (!declaredSpecs.has(pkg.name)) continue;
    const group = byName.get(pkg.name);
    if (group) group.push(pkg);
    else byName.set(pkg.name, [pkg]);
  }

  const keep = new Set<T>();
  for (const [name, group] of byName) {
    const specs = declaredSpecs.get(name) ?? [];
    const matching = group.filter((pkg) =>
      specs.some((spec) => isDeclaredInstall(pkg.version, spec)),
    );
    if (matching.length > 0) {
      for (const pkg of matching) keep.add(pkg);
      continue;
    }
    // A root `overrides` block can pin a direct dependency outside its declared range; keep the instances matching the pin, or all of them (fail-safe) if there is no pin or nothing satisfies it.
    const override = overrides.get(name);
    const pinned =
      override === undefined ? [] : group.filter((pkg) => isDeclaredInstall(pkg.version, override));
    for (const pkg of pinned.length > 0 ? pinned : group) keep.add(pkg);
  }

  return installed.filter((pkg) => keep.has(pkg));
}

async function printMajorLagReport(
  repoRoot: string,
  registry: RegistryClient,
  nowMs: number,
): Promise<void> {
  const direct = collectDirectDependencies(repoRoot);
  console.log(`\n  Major-lag report (${direct.length} direct dependencies):`);

  const warnings = await mapWithConcurrency(direct, REGISTRY_CONCURRENCY, async (dep) => {
    const release = await registry.latestRelease(dep.name);
    if (!release) return null;
    const current = dep.version.replace(/^[\^~>=<]+/, "");
    return findMajorLagWarning(dep.name, current, release, 12, nowMs);
  });

  const hits = warnings.filter((w) => w !== null);
  if (hits.length === 0) {
    console.log("    No direct dependencies with major lag >12 months.");
  } else {
    console.log("\n  WARN: major version lag >12 months (not blocking):");
    for (const hit of hits) {
      console.log(
        `    ${hit.name}  ${hit.current} → latest ${hit.latest} (since ${hit.latestPublished})`,
      );
    }
  }
}

export async function runOutdatedCheck(options: {
  readonly repoRoot: string;
  readonly reportMode: boolean;
  readonly installed?: readonly InstalledPackage[];
  readonly registry?: RegistryClient;
  readonly nowMs?: number;
}): Promise<number> {
  const installed = options.installed ?? collectInstalledPackages(options.repoRoot);
  if (installed.length === 0) {
    console.error(
      `  outdated: nothing scanned — no installed packages found for ${options.repoRoot} (run \`bun install\`).`,
    );
    return 1;
  }
  const registry = memoizeRegistryClient(options.registry ?? createBunInfoClient(options.repoRoot));
  const directInstalled = selectDirectInstalledPackages(
    installed,
    collectDeclaredSpecsByName(options.repoRoot),
    collectRootOverrides(options.repoRoot),
  );

  console.log(
    `Outdated check: ${directInstalled.length} direct dependencies (${installed.length} installed total).`,
  );

  const deprecatedDirect = await findDeprecatedPackages(directInstalled, registry);
  if (deprecatedDirect.length > 0) {
    console.error("\n  DEPRECATED direct dependencies (blocking):\n");
    for (const dep of deprecatedDirect) {
      console.error(`    ${dep.name}@${dep.version}  — ${dep.message}`);
    }
  } else {
    console.log("  No deprecated direct dependencies found.");
  }

  if (options.reportMode) {
    const deprecatedAll = await findDeprecatedPackages(installed, registry);
    const transitive = deprecatedAll.filter(
      (dep) => !deprecatedDirect.some((d) => d.name === dep.name && d.version === dep.version),
    );
    if (transitive.length > 0) {
      console.log(`\n  WARN: ${transitive.length} deprecated transitive package(s) (Renovate):`);
      for (const dep of transitive.slice(0, 15)) {
        console.log(`    ${dep.name}@${dep.version}  — ${dep.message}`);
      }
      if (transitive.length > 15) console.log(`    … and ${transitive.length - 15} more`);
    }
    await printMajorLagReport(options.repoRoot, registry, options.nowMs ?? Date.now());
  }

  return deprecatedDirect.length > 0 ? 1 : 0;
}

export async function runOutdatedCli(
  argv: readonly string[],
  cwd: string = process.cwd(),
): Promise<number> {
  const invocation = parseDependencyCli("outdated", argv, cwd);
  if (!invocation.ok) return invocation.exitCode;
  // Unlike licenses/security, `--report` only adds sections: a deprecated direct dependency still exits 1.
  return runOutdatedCheck({ repoRoot: invocation.repoRoot, reportMode: invocation.reportOnly });
}
